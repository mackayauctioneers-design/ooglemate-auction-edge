import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Target, 
  Play, 
  Pause, 
  Clock, 
  AlertCircle,
  ChevronRight
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { KitingIndicatorCompact } from "@/components/kiting";
import { deriveHuntKitingState } from "@/hooks/useKitingState";

interface Hunt {
  id: string;
  dealer_id: string;
  status: string;
  priority: number;
  year: number;
  make: string;
  model: string;
  variant_family: string | null;
  km: number | null;
  km_band: string | null;
  created_at: string;
  expires_at: string | null;
  last_scan_at: string | null;
  scan_interval_minutes: number;
  sources_enabled: string[];
  include_private: boolean;
}

interface HuntWithStats extends Hunt {
  matches_24h: number;
  alerts_24h: number;
  last_alert_at: string | null;
  last_match_at: string | null;
  latest_scan_status: string | null;
}

export default function HuntsPage() {
  const { dealerProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'done'>('active');

  const dealerId = (dealerProfile as { id?: string })?.id;

  const { data: hunts, isLoading } = useQuery({
    queryKey: ['sale-hunts', dealerId, filter],
    queryFn: async () => {
      if (!dealerId) return [];

      let query = (supabase as any)
        .from('sale_hunts')
        .select('*')
        .eq('dealer_id', dealerId)
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Get match/alert counts and latest timestamps for each hunt
      const huntsWithStats: HuntWithStats[] = await Promise.all(
        (data || []).map(async (hunt: Hunt) => {
          const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          
          const [matchesRes, alertsRes, latestAlertRes, latestMatchRes, latestScanRes] = await Promise.all([
            (supabase as any)
              .from('hunt_matches')
              .select('id', { count: 'exact', head: true })
              .eq('hunt_id', hunt.id)
              .gte('matched_at', since24h),
            (supabase as any)
              .from('hunt_alerts')
              .select('id', { count: 'exact', head: true })
              .eq('hunt_id', hunt.id)
              .gte('created_at', since24h),
            // Get latest alert timestamp
            (supabase as any)
              .from('hunt_alerts')
              .select('created_at')
              .eq('hunt_id', hunt.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .single(),
            // Get latest match timestamp
            (supabase as any)
              .from('hunt_matches')
              .select('matched_at')
              .eq('hunt_id', hunt.id)
              .order('matched_at', { ascending: false })
              .limit(1)
              .single(),
            // Get latest scan status
            (supabase as any)
              .from('hunt_scans')
              .select('status')
              .eq('hunt_id', hunt.id)
              .order('started_at', { ascending: false })
              .limit(1)
              .single()
          ]);

          return {
            ...hunt,
            matches_24h: matchesRes.count || 0,
            alerts_24h: alertsRes.count || 0,
            last_alert_at: latestAlertRes.data?.created_at || null,
            last_match_at: latestMatchRes.data?.matched_at || null,
            latest_scan_status: latestScanRes.data?.status || null,
          };
        })
      );

      return huntsWithStats;
    },
    enabled: !!dealerId
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ huntId, status }: { huntId: string; status: string }) => {
      const { error } = await (supabase as any)
        .from('sale_hunts')
        .update({ status })
        .eq('id', huntId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale-hunts'] });
      toast.success('Hunt status updated');
    }
  });

  const runScanMutation = useMutation({
    mutationFn: async (huntId: string) => {
      const { data, error } = await supabase.functions.invoke('run-hunt-scan', {
        body: { hunt_id: huntId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sale-hunts'] });
      toast.success(`Scan complete: ${data.results?.[0]?.matches || 0} matches, ${data.results?.[0]?.alerts || 0} alerts`);
    },
    onError: (err) => {
      toast.error(`Scan failed: ${err.message}`);
    }
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'paused': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'done': return 'bg-muted text-muted-foreground';
      case 'expired': return 'bg-destructive/10 text-destructive border-destructive/20';
      default: return 'bg-muted';
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Target className="h-6 w-6 text-primary" />
              Active Hunts
            </h1>
            <p className="text-muted-foreground">
              Automatic searches based on your sales
            </p>
          </div>
          
          <div className="flex gap-2">
            {(['all', 'active', 'paused', 'done'] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : !hunts?.length ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <Target className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No hunts found</h3>
              <p className="text-muted-foreground max-w-md mt-1">
                Hunts are automatically created when you upload sales. 
                Go to Log Sale to create your first hunt.
              </p>
              <Button className="mt-4" onClick={() => navigate('/log-sale')}>
                Log a Sale
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {hunts.map((hunt) => (
              <Card 
                key={hunt.id} 
                className="hover:bg-accent/50 transition-colors cursor-pointer"
                onClick={() => navigate(`/hunts/${hunt.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        {/* Kiting state indicator */}
                        <KitingIndicatorCompact 
                          state={deriveHuntKitingState(
                            hunt.status,
                            hunt.last_scan_at,
                            hunt.last_alert_at,
                            hunt.last_match_at,
                            hunt.latest_scan_status
                          )}
                          showText={false}
                        />
                        <Badge className={getStatusColor(hunt.status)}>
                          {hunt.status}
                        </Badge>
                        <h3 className="font-semibold">
                          {hunt.year} {hunt.make} {hunt.model}
                        </h3>
                        {hunt.variant_family && (
                          <span className="text-sm text-muted-foreground">
                            {hunt.variant_family}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        {hunt.km && (
                          <span>{(hunt.km / 1000).toFixed(0)}k km</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Every {hunt.scan_interval_minutes}m
                        </span>
                        {hunt.last_scan_at && (
                          <span className="text-xs">
                            Last scan: {formatDistanceToNow(new Date(hunt.last_scan_at), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <div className="text-lg font-semibold">{hunt.matches_24h}</div>
                        <div className="text-xs text-muted-foreground">Matches 24h</div>
                      </div>
                      
                      <div className="text-center">
                        <div className="text-lg font-semibold flex items-center gap-1">
                          {hunt.alerts_24h > 0 && <AlertCircle className="h-4 w-4 text-primary" />}
                          {hunt.alerts_24h}
                        </div>
                        <div className="text-xs text-muted-foreground">Alerts 24h</div>
                      </div>

                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        {hunt.status === 'active' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runScanMutation.mutate(hunt.id)}
                            disabled={runScanMutation.isPending}
                          >
                            <Play className="h-3 w-3 mr-1" />
                            Scan Now
                          </Button>
                        )}
                        
                        {hunt.status === 'active' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateStatusMutation.mutate({ huntId: hunt.id, status: 'paused' })}
                          >
                            <Pause className="h-3 w-3" />
                          </Button>
                        )}
                        
                        {hunt.status === 'paused' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatusMutation.mutate({ huntId: hunt.id, status: 'active' })}
                          >
                            <Play className="h-3 w-3 mr-1" />
                            Resume
                          </Button>
                        )}
                      </div>

                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>

                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
