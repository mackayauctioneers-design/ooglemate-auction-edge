import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, UserPlus, Search } from 'lucide-react';

// ============================================================================
// DEALER ONBOARDING - Admin tool to link users to dealer profiles
// ============================================================================

interface DealerOnboardingProps {
  onComplete?: () => void;
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
  const [isSearching, setIsSearching] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [foundUser, setFoundUser] = useState<{ id: string; email: string } | null>(null);
  const [dealerName, setDealerName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [regionId, setRegionId] = useState('CENTRAL_COAST_NSW');
  const [role, setRole] = useState<'dealer' | 'admin' | 'internal'>('dealer');

  // Search for user by email
  const handleSearchUser = async () => {
    if (!userEmail.trim()) {
      toast.error('Please enter an email address');
      return;
    }

    setIsSearching(true);
    setFoundUser(null);

    try {
      // Note: This requires admin access to auth.users
      // For now, we'll check if a profile already exists
      const { data: existingProfile, error: profileError } = await supabase
        .from('dealer_profiles')
        .select('user_id, dealer_name')
        .limit(1);

      // Since we can't directly query auth.users from client, 
      // we'll need the user to provide their user_id or use an edge function
      // For demo purposes, show a message
      toast.info('Enter the user ID directly (from Supabase Auth) or ask the user to sign up first');
      
    } catch (error) {
      toast.error('Failed to search: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsSearching(false);
    }
  };

  // Create dealer profile and link to user
  const handleCreateProfile = async () => {
    if (!dealerName.trim()) {
      toast.error('Dealer name is required');
      return;
    }

    setIsLoading(true);

    try {
      // Step 1: Create dealer profile (seedable, no FK to auth.users)
      // Note: user_id is legacy field, we use link table now but types still require it
      const profileId = crypto.randomUUID();
      const { error: profileError } = await supabase
        .from('dealer_profiles')
        .insert({
          id: profileId,
          user_id: crypto.randomUUID(), // Legacy field, not used for auth - link table handles this
          dealer_name: dealerName.trim(),
          org_id: orgId.trim() || null,
          region_id: regionId,
        });

      if (profileError) throw profileError;

      // Step 2: If we have a real user_id (from search), create the link
      if (foundUser?.id) {
        const { error: linkError } = await supabase
          .from('dealer_profile_user_links')
          .upsert({
            dealer_profile_id: profileId,
            user_id: foundUser.id,
            linked_by: 'admin',
          }, { onConflict: 'user_id' });

        if (linkError) throw linkError;

        // Step 3: Create user role (requires valid auth.users FK)
        const { error: roleError } = await supabase
          .from('user_roles')
          .upsert({
            user_id: foundUser.id,
            role: role,
          }, { onConflict: 'user_id,role' });

        if (roleError) throw roleError;

        toast.success(`Linked ${dealerName} to user with role ${role}`);
      } else {
        toast.success(`Created dealer profile: ${dealerName} (not linked to user yet)`);
      }
      
      // Reset form
      setUserEmail('');
      setFoundUser(null);
      setDealerName('');
      setOrgId('');
      setRegionId('CENTRAL_COAST_NSW');
      setRole('dealer');
      
      onComplete?.();

    } catch (error) {
      toast.error('Failed to create profile: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  // Seed Brian Hilton test data (profile only, no user link)
  const handleSeedBrianHilton = async () => {
    setIsLoading(true);

    try {
      // Create dealer profile (seedable without auth user)
      // Note: user_id is legacy field, we use link table now
      const { error: profileError } = await supabase
        .from('dealer_profiles')
        .insert({
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          user_id: crypto.randomUUID(), // Legacy field, not used for auth
          dealer_name: 'Brian Hilton Toyota',
          org_id: 'brian-hilton-group',
          region_id: 'CENTRAL_COAST_NSW',
        });

      if (profileError) throw profileError;

      toast.success('Seeded Brian Hilton Toyota profile (ready for user linking)');
      onComplete?.();

    } catch (error) {
      toast.error('Failed to seed: ' + (error instanceof Error ? error.message : 'Unknown error'));
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
          Link user accounts to dealer profiles and set permissions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick seed button */}
        <Button 
          onClick={handleSeedBrianHilton}
          variant="outline"
          className="w-full gap-2 border-primary/50"
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Seed Brian Hilton Toyota (Test)
        </Button>

        <div className="border-t pt-4 space-y-4">
          <p className="text-sm text-muted-foreground">Or create a new dealer profile:</p>

          {/* User search (placeholder for now) */}
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="userEmail" className="sr-only">User Email</Label>
              <Input
                id="userEmail"
                placeholder="User email or ID..."
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
              />
            </div>
            <Button 
              variant="outline" 
              size="icon"
              onClick={handleSearchUser}
              disabled={isSearching}
            >
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {/* Dealer name */}
          <div>
            <Label htmlFor="dealerName">Dealer Name *</Label>
            <Input
              id="dealerName"
              placeholder="e.g. Brian Hilton Toyota"
              value={dealerName}
              onChange={(e) => setDealerName(e.target.value)}
            />
          </div>

          {/* Org ID */}
          <div>
            <Label htmlFor="orgId">Org ID (optional)</Label>
            <Input
              id="orgId"
              placeholder="e.g. brian-hilton-group"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
            />
          </div>

          {/* Region */}
          <div>
            <Label htmlFor="region">Region</Label>
            <Select value={regionId} onValueChange={setRegionId}>
              <SelectTrigger>
                <SelectValue placeholder="Select region" />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Role */}
          <div>
            <Label htmlFor="role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Create button */}
          <Button 
            onClick={handleCreateProfile}
            className="w-full gap-2"
            disabled={isLoading || !dealerName.trim()}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Create Dealer Profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
