import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Globe, Link2, Rocket, Building2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface DealerOnboardingProps {
  onComplete?: () => void;
}

interface DealerProfile {
  id: string;
  dealer_name: string;
  org_id: string | null;
  region_id: string;
}

const REGIONS = [
  { id: 'CENTRAL_COAST_NSW', label: 'Central Coast NSW' },
  { id: 'NSW_SYDNEY', label: 'Sydney' },
  { id: 'NSW_HUNTER', label: 'Hunter Region' },
  { id: 'NSW_ILLAWARRA', label: 'Illawarra' },
  { id: 'NSW_WESTERN', label: 'Western NSW' },
  { id: 'NSW_OTHER', label: 'Other NSW' },
  { id: 'VIC_MELBOURNE', label: 'Melbourne' },
  { id: 'VIC_REGIONAL', label: 'Regional VIC' },
  { id: 'QLD_BRISBANE', label: 'Brisbane' },
  { id: 'QLD_REGIONAL', label: 'Regional QLD' },
  { id: 'MACKAY_QLD', label: 'Mackay QLD' },
  { id: 'SA_ADELAIDE', label: 'Adelaide' },
  { id: 'WA_PERTH', label: 'Perth' },
  { id: 'TAS', label: 'Tasmania' },
  { id: 'NT', label: 'Northern Territory' },
  { id: 'ACT', label: 'ACT' },
];

const ROLES = [
  { id: 'dealer', label: 'Dealer' },
  { id: 'admin', label: 'Admin' },
  { id: 'internal', label: 'Internal' },
];

export function DealerOnboarding({ onComplete }: DealerOnboardingProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [dealerProfiles, setDealerProfiles] = useState<DealerProfile[]>([]);
  
  // Add dealer form — just name + URL
  const [dealerName, setDealerName] = useState('');
  const [dealerWebsite, setDealerWebsite] = useState('');
  const [regionId, setRegionId] = useState('');
  
  // Link user form
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [authUserId, setAuthUserId] = useState('');
  const [role, setRole] = useState<'dealer' | 'admin' | 'internal'>('dealer');

  useEffect(() => {
    loadDealerProfiles();
  }, []);

  const loadDealerProfiles = async () => {
    const { data, error } = await supabase
      .from('dealer_profiles')
      .select('id, dealer_name, org_id, region_id')
      .order('dealer_name');
    if (!error && data) setDealerProfiles(data);
  };

  const dispatchCaroogleProfiling = async (profileId: string, name: string, website: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('dealer-onboard-dispatch', {
        body: { dealer_profile_id: profileId, dealer_name: name, dealer_website: website },
      });
      if (error) {
        console.error('[DealerOnboarding] CaroogleAI dispatch error:', error);
        toast.info('Dealer created — auto-profiling failed to dispatch');
        return;
      }
      toast.success('🤖 CaroogleAI dispatched — fingerprint incoming');
      console.log('[DealerOnboarding] CaroogleAI dispatch response:', data);
    } catch (err) {
      console.error('[DealerOnboarding] CaroogleAI dispatch exception:', err);
    }
  };

  const handleAddDealer = async () => {
    if (!dealerName.trim() || !dealerWebsite.trim()) {
      toast.error('Dealer name and website are required');
      return;
    }

    // Ensure URL has protocol
    let website = dealerWebsite.trim();
    if (!website.startsWith('http://') && !website.startsWith('https://')) {
      website = `https://${website}`;
    }

    setIsLoading(true);
    try {
      const profileId = crypto.randomUUID();
      const { error } = await supabase
        .from('dealer_profiles')
        .insert({
          id: profileId,
          dealer_name: dealerName.trim(),
          region_id: regionId || 'UNKNOWN',
          dealer_website: website,
        } as any);

      if (error) throw error;

      toast.success(`Created: ${dealerName}`);

      // Dispatch Lindy to crawl & build fingerprints
      await dispatchLindyProfiling(profileId, dealerName.trim(), website);

      setDealerName('');
      setDealerWebsite('');
      setRegionId('');
      loadDealerProfiles();
      onComplete?.();
    } catch (error) {
      toast.error('Failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLinkUser = async () => {
    if (!selectedProfileId || !authUserId.trim()) {
      toast.error('Select a dealer and enter the user ID');
      return;
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(authUserId.trim())) {
      toast.error('Invalid user ID format (must be UUID)');
      return;
    }

    setIsLoading(true);
    try {
      const { error: linkError } = await supabase
        .from('dealer_profile_user_links')
        .insert({ dealer_profile_id: selectedProfileId, user_id: authUserId.trim(), linked_by: 'admin' });

      if (linkError) {
        if (linkError.code === '23503') throw new Error('User ID not found — user must sign up first');
        if (linkError.code === '23505') throw new Error('Already linked');
        throw linkError;
      }

      const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({ user_id: authUserId.trim(), role }, { onConflict: 'user_id' });
      if (roleError) throw roleError;

      const profile = dealerProfiles.find(p => p.id === selectedProfileId);
      toast.success(`Linked ${profile?.dealer_name || 'dealer'} → ${role}`);
      setSelectedProfileId('');
      setAuthUserId('');
      setRole('dealer');
      onComplete?.();
    } catch (error) {
      toast.error('Failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Rocket className="h-5 w-5 text-primary" />
          Dealer Onboarding
        </CardTitle>
        <CardDescription>
          Paste a dealer's website — Lindy does the rest
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="add" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="add" className="gap-2">
              <Globe className="h-4 w-4" />
              Add Dealer
            </TabsTrigger>
            <TabsTrigger value="link" className="gap-2">
              <Link2 className="h-4 w-4" />
              Link User
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Add dealer — name + website, Lindy does the rest */}
          <TabsContent value="add" className="space-y-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-sm text-primary font-medium">How it works</p>
              <p className="text-xs text-muted-foreground mt-1">
                Enter name + website → Lindy crawls inventory → auto-creates fingerprints (makes, models, price bands, segments)
              </p>
            </div>

            <div>
              <Label htmlFor="dealerName">Dealer Name *</Label>
              <Input
                id="dealerName"
                placeholder="e.g. Central Coast Motors"
                value={dealerName}
                onChange={(e) => setDealerName(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="dealerWebsite">Website URL *</Label>
              <Input
                id="dealerWebsite"
                placeholder="e.g. centralcoastmotors.com.au"
                value={dealerWebsite}
                onChange={(e) => setDealerWebsite(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="region">Region (optional — Lindy will detect)</Label>
              <Select value={regionId} onValueChange={setRegionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto-detect from website" />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleAddDealer}
              className="w-full gap-2"
              disabled={isLoading || !dealerName.trim() || !dealerWebsite.trim()}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Add Dealer & Profile
            </Button>
          </TabsContent>

          {/* TAB 2: Link existing profile to auth user */}
          <TabsContent value="link" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Link an existing dealer to an authenticated user.
            </p>

            <div>
              <Label>Dealer Profile *</Label>
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger><SelectValue placeholder="Select dealer..." /></SelectTrigger>
                <SelectContent>
                  {dealerProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.dealer_name} ({p.region_id})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Auth User ID *</Label>
              <Input
                placeholder="UUID from auth"
                value={authUserId}
                onChange={(e) => setAuthUserId(e.target.value)}
              />
            </div>

            <div>
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleLinkUser} className="w-full gap-2" disabled={isLoading || !selectedProfileId || !authUserId.trim()}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Link User
            </Button>
          </TabsContent>
        </Tabs>

        {dealerProfiles.length > 0 && (
          <div className="mt-6 pt-4 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-2">Existing dealers ({dealerProfiles.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {dealerProfiles.map(p => (
                <span key={p.id} className="text-xs bg-muted px-2 py-0.5 rounded-full">{p.dealer_name}</span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
