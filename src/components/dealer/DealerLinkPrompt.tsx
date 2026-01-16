import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Building2, Link2, AlertTriangle, Loader2 } from 'lucide-react';

interface DealerProfile {
  id: string;
  dealer_name: string;
  region_id: string;
}

interface DealerLinkPromptProps {
  onLinked?: () => void;
}

/**
 * Self-service component for users to link their account to a dealer profile.
 * Shown when dealerProfile is null but user is authenticated.
 */
export function DealerLinkPrompt({ onLinked }: DealerLinkPromptProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dealerProfiles, setDealerProfiles] = useState<DealerProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLinking, setIsLinking] = useState(false);

  useEffect(() => {
    loadDealerProfiles();
  }, []);

  const loadDealerProfiles = async () => {
    setIsLoading(true);
    try {
      // Fetch profiles that are NOT already linked to a user
      const { data: allProfiles, error: profileError } = await supabase
        .from('dealer_profiles')
        .select('id, dealer_name, region_id')
        .order('dealer_name');

      if (profileError) throw profileError;

      // Fetch already linked profile IDs
      const { data: linkedProfiles, error: linkError } = await supabase
        .from('dealer_profile_user_links')
        .select('dealer_profile_id');

      if (linkError) throw linkError;

      const linkedIds = new Set(linkedProfiles?.map(l => l.dealer_profile_id) || []);
      
      // Filter to unlinked profiles only
      const availableProfiles = (allProfiles || []).filter(p => !linkedIds.has(p.id));
      setDealerProfiles(availableProfiles);
    } catch (err) {
      console.error('Error loading dealer profiles:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLink = async () => {
    if (!selectedProfileId || !user?.id) return;

    setIsLinking(true);
    try {
      const { error } = await supabase
        .from('dealer_profile_user_links')
        .insert({
          dealer_profile_id: selectedProfileId,
          user_id: user.id,
          linked_by: 'self-service',
        });

      if (error) {
        if (error.code === '23505') {
          throw new Error('This dealer profile is already linked to another user.');
        }
        throw error;
      }

      toast({
        title: "✅ Dealer profile linked!",
        description: "You can now log sales and activate Kiting Mode. Refreshing...",
      });

      // Force page reload to refresh auth context
      setTimeout(() => {
        window.location.reload();
      }, 1500);

      onLinked?.();
    } catch (err) {
      console.error('Error linking profile:', err);
      toast({
        title: "Link failed",
        description: err instanceof Error ? err.message : 'Failed to link dealer profile.',
        variant: "destructive",
      });
    } finally {
      setIsLinking(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-yellow-500/50 bg-yellow-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
          <CardTitle className="text-base">Dealer Profile Required</CardTitle>
        </div>
        <CardDescription>
          Link your account to a dealership to activate Kiting Mode™
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Building2 className="h-4 w-4" />
          <AlertDescription>
            Kiting Mode needs to know which dealership you represent so it can scope alerts, 
            hunts, and opportunities to your business.
          </AlertDescription>
        </Alert>

        {dealerProfiles.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-2">
              No available dealer profiles found.
            </p>
            <p className="text-xs text-muted-foreground">
              Contact your administrator to create a dealer profile for you.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Select your dealership</label>
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a dealer profile..." />
                </SelectTrigger>
                <SelectContent>
                  {dealerProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span>{profile.dealer_name}</span>
                        <span className="text-xs text-muted-foreground">({profile.region_id})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button 
              onClick={handleLink} 
              disabled={!selectedProfileId || isLinking}
              className="w-full gap-2"
            >
              {isLinking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Linking...
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4" />
                  Link Dealer Profile
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              This is a one-time setup. You can only link to one dealership.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
