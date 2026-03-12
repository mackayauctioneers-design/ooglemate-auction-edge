import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, UserPlus, Link2, Building2, Globe } from 'lucide-react';
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
  
  // Seed new profile form
  const [dealerName, setDealerName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [regionId, setRegionId] = useState('CENTRAL_COAST_NSW');
  const [dealerWebsite, setDealerWebsite] = useState('');
  const [dealerEmail, setDealerEmail] = useState('');
  const [dealerPhone, setDealerPhone] = useState('');
  
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
    
    if (!error && data) {
      setDealerProfiles(data);
    }
  };

  // Dispatch to Lindy for auto-profiling
  const dispatchLindyProfiling = async (profileId: string, name: string, website: string, email: string, phone: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('dealer-onboard-dispatch', {
        body: {
          dealer_profile_id: profileId,
          dealer_name: name,
          dealer_website: website,
          dealer_email: email,
          dealer_phone: phone,
        },
      });

      if (error) {
        console.error('[DealerOnboarding] Lindy dispatch error:', error);
        toast.info('Dealer created but auto-profiling failed to dispatch');
        return;
      }

      toast.success('🤖 Lindy profiling dispatched — fingerprint incoming');
      console.log('[DealerOnboarding] Lindy dispatch response:', data);
    } catch (err) {
      console.error('[DealerOnboarding] Lindy dispatch exception:', err);
    }
  };

  const handleSeedProfile = async () => {
    if (!dealerName.trim()) {
      toast.error('Dealer name is required');
      return;
    }

    setIsLoading(true);

    try {
      const profileId = crypto.randomUUID();
      const { error } = await supabase
        .from('dealer_profiles')
        .insert({
          id: profileId,
          dealer_name: dealerName.trim(),
          org_id: orgId.trim() || null,
          region_id: regionId,
          dealer_website: dealerWebsite.trim() || null,
          dealer_email: dealerEmail.trim() || null,
          dealer_phone: dealerPhone.trim() || null,
        } as any);

      if (error) throw error;

      toast.success(`Created dealer profile: ${dealerName}`);

      // Auto-dispatch Lindy if website provided
      if (dealerWebsite.trim()) {
        await dispatchLindyProfiling(profileId, dealerName.trim(), dealerWebsite.trim(), dealerEmail.trim(), dealerPhone.trim());
      }
      
      // Reset and reload
      setDealerName('');
      setOrgId('');
      setRegionId('CENTRAL_COAST_NSW');
      setDealerWebsite('');
      setDealerEmail('');
      setDealerPhone('');
      loadDealerProfiles();
      onComplete?.();

    } catch (error) {
      toast.error('Failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLinkUser = async () => {
    if (!selectedProfileId) {
      toast.error('Please select a dealer profile');
      return;
    }
    if (!authUserId.trim()) {
      toast.error('Please enter the auth user ID');
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
        .insert({
          dealer_profile_id: selectedProfileId,
          user_id: authUserId.trim(),
          linked_by: 'admin',
        });

      if (linkError) {
        if (linkError.code === '23503') throw new Error('User ID not found — user must sign up first');
        if (linkError.code === '23505') throw new Error('This user or profile is already linked');
        throw linkError;
      }

      const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({ user_id: authUserId.trim(), role: role }, { onConflict: 'user_id' });

      if (roleError) throw roleError;

      const profile = dealerProfiles.find(p => p.id === selectedProfileId);
      toast.success(`Linked ${profile?.dealer_name || 'dealer'} to user with role ${role}`);
      
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

  const handleQuickSeed = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('dealer_profiles')
        .insert({
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          dealer_name: 'Brian Hilton Toyota',
          org_id: 'brian-hilton-group',
          region_id: 'CENTRAL_COAST_NSW',
          dealer_website: 'https://www.brianhilton.com.au',
        } as any);

      if (error && error.code !== '23505') throw error;

      toast.success('Seeded Brian Hilton Toyota (ready for linking)');
      loadDealerProfiles();
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
          <UserPlus className="h-5 w-5 text-primary" />
          Dealer Onboarding
        </CardTitle>
        <CardDescription>
          Seed dealer profiles, auto-profile via Lindy, and link to auth users
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="seed" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="seed" className="gap-2">
              <Building2 className="h-4 w-4" />
              Seed Profile
            </TabsTrigger>
            <TabsTrigger value="link" className="gap-2">
              <Link2 className="h-4 w-4" />
              Link User
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Seed new dealer profile */}
          <TabsContent value="seed" className="space-y-4">
            <Button 
              onClick={handleQuickSeed}
              variant="outline"
              className="w-full gap-2 border-primary/50"
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
              Quick Seed: Brian Hilton Toyota
            </Button>

            <div className="border-t pt-4 space-y-4">
              <p className="text-sm text-muted-foreground">Or create a new dealer profile:</p>

              <div>
                <Label htmlFor="dealerName">Dealer Name *</Label>
                <Input id="dealerName" placeholder="e.g. Central Coast Motors" value={dealerName} onChange={(e) => setDealerName(e.target.value)} />
              </div>

              <div>
                <Label htmlFor="dealerWebsite">Website</Label>
                <Input id="dealerWebsite" placeholder="https://www.example.com.au" value={dealerWebsite} onChange={(e) => setDealerWebsite(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  Providing a website triggers automatic Lindy profiling
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="dealerEmail">Email</Label>
                  <Input id="dealerEmail" type="email" placeholder="info@dealer.com.au" value={dealerEmail} onChange={(e) => setDealerEmail(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="dealerPhone">Phone</Label>
                  <Input id="dealerPhone" type="tel" placeholder="02 1234 5678" value={dealerPhone} onChange={(e) => setDealerPhone(e.target.value)} />
                </div>
              </div>

              <div>
                <Label htmlFor="orgId">Org ID (optional)</Label>
                <Input id="orgId" placeholder="e.g. cc-motors-group" value={orgId} onChange={(e) => setOrgId(e.target.value)} />
              </div>

              <div>
                <Label htmlFor="region">Region</Label>
                <Select value={regionId} onValueChange={setRegionId}>
                  <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleSeedProfile} className="w-full gap-2" disabled={isLoading || !dealerName.trim()}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                Create Dealer Profile
              </Button>
            </div>
          </TabsContent>

          {/* TAB 2: Link existing profile to auth user */}
          <TabsContent value="link" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Link an existing dealer profile to an authenticated user. The user must have signed up first.
            </p>

            <div>
              <Label htmlFor="selectProfile">Dealer Profile *</Label>
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
              <Label htmlFor="authUserId">Auth User ID *</Label>
              <Input id="authUserId" placeholder="e.g. 12345678-1234-1234-1234-123456789012" value={authUserId} onChange={(e) => setAuthUserId(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Get this from the user's profile or auth logs</p>
            </div>

            <div>
              <Label htmlFor="role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleLinkUser} className="w-full gap-2" disabled={isLoading || !selectedProfileId || !authUserId.trim()}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Link User to Profile
            </Button>
          </TabsContent>
        </Tabs>

        {dealerProfiles.length > 0 && (
          <div className="mt-6 pt-4 border-t">
            <p className="text-xs text-muted-foreground mb-2">
              Existing profiles: {dealerProfiles.map(p => p.dealer_name).join(', ')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
