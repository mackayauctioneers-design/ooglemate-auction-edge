import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Globe, Link2, Rocket, Upload } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface DealerOnboardingProps {
  onComplete?: () => void;
}

interface DealerProfile {
  id: string;
  dealer_name: string;
  org_id: string | null;
  region_id: string;
  account_id: string | null;
}

interface UnlinkedUser {
  user_id: string;
  email: string;
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
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [dealerProfiles, setDealerProfiles] = useState<DealerProfile[]>([]);
  const [unlinkedUsers, setUnlinkedUsers] = useState<UnlinkedUser[]>([]);
  
  // Add dealer form
  const [dealerName, setDealerName] = useState('');
  const [dealerWebsite, setDealerWebsite] = useState('');
  const [regionId, setRegionId] = useState('');
  
  // Link user form
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [role, setRole] = useState<'dealer' | 'admin' | 'internal'>('dealer');

  useEffect(() => {
    loadDealerProfiles();
    loadUnlinkedUsers();
  }, []);

  const loadDealerProfiles = async () => {
    const { data, error } = await supabase
      .from('dealer_profiles')
      .select('id, dealer_name, org_id, region_id, account_id')
      .order('dealer_name');
    if (!error && data) setDealerProfiles(data);
  };

  const loadUnlinkedUsers = async () => {
    try {
      // Get all linked user IDs
      const { data: links } = await supabase
        .from('dealer_profile_user_links')
        .select('user_id');
      const linkedIds = new Set(links?.map(l => l.user_id) || []);

      // Get all profiles (which have user_id + email-like info)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, email')
        .order('email');

      if (profiles) {
        const unlinked = profiles
          .filter(p => !linkedIds.has(p.id))
          .map(p => ({
            user_id: p.id,
            email: p.email || p.display_name || p.id.slice(0, 8),
          }));
        setUnlinkedUsers(unlinked);
      }
    } catch (err) {
      console.error('Error loading unlinked users:', err);
    }
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
      await dispatchCaroogleProfiling(profileId, dealerName.trim(), website);

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
    if (!selectedProfileId || !selectedUserId) {
      toast.error('Select a dealer and a user');
      return;
    }

    setIsLoading(true);
    try {
      const { error: linkError } = await supabase
        .from('dealer_profile_user_links')
        .insert({ dealer_profile_id: selectedProfileId, user_id: selectedUserId, linked_by: 'admin' });

      if (linkError) {
        if (linkError.code === '23503') throw new Error('User not found');
        if (linkError.code === '23505') throw new Error('Already linked');
        throw linkError;
      }

      const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({ user_id: selectedUserId, role }, { onConflict: 'user_id' });
      if (roleError) throw roleError;

      const profile = dealerProfiles.find(p => p.id === selectedProfileId);
      const user = unlinkedUsers.find(u => u.user_id === selectedUserId);
      toast.success(`Linked ${user?.email} → ${profile?.dealer_name} (${role})`);
      setSelectedProfileId('');
      setSelectedUserId('');
      setRole('dealer');
      loadUnlinkedUsers();
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
          Paste a dealer's website — CaroogleAI does the rest
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

          <TabsContent value="add" className="space-y-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-sm text-primary font-medium">How it works</p>
              <p className="text-xs text-muted-foreground mt-1">
                Enter name + website → CaroogleAI crawls inventory → auto-creates fingerprints (makes, models, price bands, segments)
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
              <Label htmlFor="region">Region (optional — CaroogleAI will detect)</Label>
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

          <TabsContent value="link" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Link a signed-up user to a dealer profile by selecting their email.
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
              <Label>User *</Label>
              {unlinkedUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No unlinked users — waiting for someone to sign up via your invite link.</p>
              ) : (
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger><SelectValue placeholder="Select user by email..." /></SelectTrigger>
                  <SelectContent>
                    {unlinkedUsers.map((u) => (
                      <SelectItem key={u.user_id} value={u.user_id}>{u.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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

            <Button onClick={handleLinkUser} className="w-full gap-2" disabled={isLoading || !selectedProfileId || !selectedUserId}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Link User
            </Button>
          </TabsContent>
        </Tabs>

        {dealerProfiles.length > 0 && (
          <div className="mt-6 pt-4 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-2">Existing dealers ({dealerProfiles.length})</p>
            <div className="space-y-1.5">
              {dealerProfiles.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded-md bg-muted px-3 py-1.5">
                  <span className="text-sm font-medium">{p.dealer_name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => {
                      if (p.account_id) {
                        navigate(`/operator/dealer-upload?account=${p.account_id}`);
                      } else {
                        toast.error(`${p.dealer_name} has no linked account yet — link one first`);
                      }
                    }}
                  >
                    <Upload className="h-3 w-3" />
                    Upload Sales
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
