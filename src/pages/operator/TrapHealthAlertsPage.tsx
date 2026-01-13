import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';

interface TrapHealthAlert {
  id: string;
  trap_slug: string;
  alert_type: string;
  alert_date: string;
  sent_at: string;
  payload: Record<string, unknown>;
}

interface FailingTrap {
  trap_slug: string;
  dealer_name: string;
  consecutive_failures: number;
  last_fail_at: string | null;
  last_fail_reason: string | null;
}

export default function TrapHealthAlertsPage() {
  const [alerts, setAlerts] = useState<TrapHealthAlert[]>([]);
  const [failingTraps, setFailingTraps] = useState<FailingTrap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Trap Health Alerts | Operator';
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [alertsRes, trapsRes] = await Promise.all([
        supabase
          .from('trap_health_alerts')
          .select('*')
          .order('sent_at', { ascending: false })
          .limit(50),
        supabase
          .from('dealer_traps')
          .select('trap_slug, dealer_name, consecutive_failures, last_fail_at, last_fail_reason')
          .gt('consecutive_failures', 0)
          .order('consecutive_failures', { ascending: false })
          .limit(30)
      ]);

      if (alertsRes.error) throw alertsRes.error;
      if (trapsRes.error) throw trapsRes.error;

      setAlerts((alertsRes.data as TrapHealthAlert[]) || []);
      setFailingTraps((trapsRes.data as FailingTrap[]) || []);
    } catch (err) {
      console.error('Failed to fetch trap health data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Trap Health Alerts</h1>
            <p className="text-muted-foreground">Monitor trap failures and issues</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Failing Traps
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-amber-500">{failingTraps.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Recent Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{alerts.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                Healthy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-500">
                {failingTraps.length === 0 ? 'All Clear' : '—'}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Failing Traps */}
        <Card>
          <CardHeader>
            <CardTitle>Currently Failing Traps</CardTitle>
          </CardHeader>
          <CardContent>
            {failingTraps.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                🎉 No failing traps right now!
              </div>
            ) : (
              <div className="space-y-3">
                {failingTraps.map((trap) => (
                  <div key={trap.trap_slug} className="flex items-start justify-between p-3 rounded-lg border border-border bg-muted/30">
                    <div>
                      <div className="font-medium">{trap.dealer_name}</div>
                      <div className="text-sm text-muted-foreground">{trap.trap_slug}</div>
                      {trap.last_fail_reason && (
                        <div className="text-xs text-red-500 mt-1">{trap.last_fail_reason}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <Badge variant="destructive">{trap.consecutive_failures} failures</Badge>
                      {trap.last_fail_at && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(parseISO(trap.last_fail_at), { addSuffix: true })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alerts History */}
        <Card>
          <CardHeader>
            <CardTitle>Alert History</CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No alerts recorded</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b">
                    <tr>
                      <th className="text-left py-2 pr-4">Trap</th>
                      <th className="text-left py-2 pr-4">Type</th>
                      <th className="text-left py-2 pr-4">Date</th>
                      <th className="text-left py-2">Sent At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((alert) => (
                      <tr key={alert.id} className="border-b last:border-b-0">
                        <td className="py-3 pr-4 font-medium">{alert.trap_slug}</td>
                        <td className="py-3 pr-4">
                          <Badge variant="secondary">{alert.alert_type}</Badge>
                        </td>
                        <td className="py-3 pr-4">{alert.alert_date}</td>
                        <td className="py-3 text-muted-foreground">
                          {format(parseISO(alert.sent_at), 'dd MMM HH:mm')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </OperatorLayout>
  );
}
