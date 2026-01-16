import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Bell,
  CheckCircle,
  ExternalLink,
  TrendingDown,
  Target,
  Filter
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

interface HuntAlert {
  id: string;
  hunt_id: string;
  listing_id: string;
  alert_type: string;
  created_at: string;
  acknowledged_at: string | null;
  payload: Record<string, unknown>;
  hunt?: {
    year: number;
    make: string;
    model: string;
  };
}

export default function HuntAlertsPage() {
  const { dealerProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'BUY' | 'WATCH'>('all');
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  const dealerId = (dealerProfile as { id?: string })?.id;

  const { data: alerts, isLoading } = useQuery({
    queryKey: ['all-hunt-alerts', dealerId, filter, showAcknowledged],
    queryFn: async () => {
      if (!dealerId) return [];

      // First get all hunts for this dealer
      const { data: hunts } = await (supabase as any)
        .from('sale_hunts')
        .select('id, year, make, model')
        .eq('dealer_id', dealerId);

      if (!hunts?.length) return [];

      const huntIds = hunts.map((h: any) => h.id);
      const huntMap = Object.fromEntries(hunts.map((h: any) => [h.id, h]));

      let query = (supabase as any)
        .from('hunt_alerts')
        .select('*')
        .in('hunt_id', huntIds)
        .order('created_at', { ascending: false })
        .limit(100);

      if (filter !== 'all') {
        query = query.eq('alert_type', filter);
      }

      if (!showAcknowledged) {
        query = query.is('acknowledged_at', null);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((alert: any) => ({
        ...alert,
        hunt: huntMap[alert.hunt_id]
      })) as HuntAlert[];
    },
    enabled: !!dealerId
  });

  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await (supabase as any)
        .from('hunt_alerts')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-hunt-alerts'] });
    }
  });

  const acknowledgeAllMutation = useMutation({
    mutationFn: async () => {
      if (!alerts?.length) return;
      const unacked = alerts.filter(a => !a.acknowledged_at);
      for (const alert of unacked) {
        await (supabase as any)
          .from('hunt_alerts')
          .update({ acknowledged_at: new Date().toISOString() })
          .eq('id', alert.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-hunt-alerts'] });
    }
  });

  const unackedCount = alerts?.filter(a => !a.acknowledged_at).length || 0;
  const buyCount = alerts?.filter(a => a.alert_type === 'BUY' && !a.acknowledged_at).length || 0;
  const watchCount = alerts?.filter(a => a.alert_type === 'WATCH' && !a.acknowledged_at).length || 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="h-6 w-6 text-primary" />
              Hunt Alerts
              {unackedCount > 0 && (
                <Badge className="bg-primary text-primary-foreground">
                  {unackedCount} new
                </Badge>
              )}
            </h1>
            <p className="text-muted-foreground">
              BUY and WATCH opportunities from your active hunts
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAcknowledged(!showAcknowledged)}
            >
              <Filter className="h-4 w-4 mr-1" />
              {showAcknowledged ? 'Hide' : 'Show'} Acknowledged
            </Button>
            
            {unackedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => acknowledgeAllMutation.mutate()}
                disabled={acknowledgeAllMutation.isPending}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Acknowledge All
              </Button>
            )}
          </div>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList>
            <TabsTrigger value="all">
              All ({alerts?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="BUY" className="text-emerald-500">
              BUY ({buyCount})
            </TabsTrigger>
            <TabsTrigger value="WATCH" className="text-amber-500">
              WATCH ({watchCount})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={filter} className="mt-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : !alerts?.length ? (
              <Card className="py-12">
                <CardContent className="text-center">
                  <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium">No alerts</h3>
                  <p className="text-muted-foreground mt-1">
                    {filter === 'all' 
                      ? "Your hunts haven't found any matches yet."
                      : `No ${filter} alerts found.`}
                  </p>
                  <Button className="mt-4" onClick={() => navigate('/hunts')}>
                    View Hunts
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {alerts.map((alert) => {
                  const payload = alert.payload;
                  return (
                    <Card 
                      key={alert.id} 
                      className={`transition-all ${
                        alert.acknowledged_at ? 'opacity-60' : ''
                      } hover:bg-accent/50`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <Badge className={
                              alert.alert_type === 'BUY' 
                                ? 'bg-emerald-500 text-white text-lg px-3 py-1' 
                                : 'bg-amber-500 text-white text-lg px-3 py-1'
                            }>
                              {alert.alert_type}
                            </Badge>
                            
                            <div>
                              <div className="font-semibold text-lg">
                                {payload.year} {payload.make} {payload.model}
                                {payload.variant && (
                                  <span className="text-muted-foreground ml-2">
                                    {payload.variant as string}
                                  </span>
                                )}
                              </div>
                              
                              <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                                {payload.km && (
                                  <span>{((payload.km as number) / 1000).toFixed(0)}k km</span>
                                )}
                                <span className="font-medium text-foreground">
                                  ${(payload.asking_price as number)?.toLocaleString()}
                                </span>
                                {payload.gap_dollars && (
                                  <span className="flex items-center text-emerald-500">
                                    <TrendingDown className="h-4 w-4 mr-1" />
                                    ${(payload.gap_dollars as number)?.toLocaleString()} below 
                                    ({(payload.gap_pct as number)?.toFixed(1)}%)
                                  </span>
                                )}
                                <span>Score: {(payload.match_score as number)?.toFixed(1)}/10</span>
                                {payload.source && (
                                  <Badge variant="outline" className="text-xs">
                                    {payload.source as string}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs text-muted-foreground"
                                onClick={() => navigate(`/hunts/${alert.hunt_id}`)}
                              >
                                <Target className="h-3 w-3 mr-1" />
                                {alert.hunt?.year} {alert.hunt?.make} {alert.hunt?.model}
                              </Button>
                              <div className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                              </div>
                            </div>

                            <div className="flex gap-2">
                              {payload.listing_url && (
                                <Button
                                  size="sm"
                                  onClick={() => window.open(payload.listing_url as string, '_blank')}
                                >
                                  <ExternalLink className="h-4 w-4 mr-1" />
                                  View
                                </Button>
                              )}

                              {!alert.acknowledged_at && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => acknowledgeAlertMutation.mutate(alert.id)}
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
