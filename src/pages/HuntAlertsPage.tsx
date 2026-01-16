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
  Filter
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { HuntAlertCard } from "@/components/hunts/HuntAlertCard";
import type { HuntAlert, AlertType } from "@/types/hunts";

interface HuntAlertWithHunt extends HuntAlert {
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
  const [filter, setFilter] = useState<'all' | AlertType>('all');
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
      })) as HuntAlertWithHunt[];
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
                {alerts.map((alert) => (
                  <HuntAlertCard
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={(id) => acknowledgeAlertMutation.mutate(id)}
                    isAcknowledging={acknowledgeAlertMutation.isPending}
                    showHuntLink={true}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
