import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { BarChart3, Loader2, Search, Bell, Target } from 'lucide-react';

// ============================================================================
// AUCTION COVERAGE METRICS — Shows per-dealer weekly stats:
// lots scanned, opportunities created, alerts sent
// ============================================================================

interface DealerMetrics {
  dealer_name: string;
  account_id: string;
  lots_scanned: number;
  opportunities_created: number;
  alerts_sent: number;
}

export function AuctionCoverageMetrics() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['auction-coverage-metrics'],
    queryFn: async () => {
      // Get all dealer profiles with accounts
      const { data: profiles } = await supabase
        .from('dealer_profiles')
        .select('id, dealer_name, account_id')
        .not('account_id', 'is', null);

      if (!profiles?.length) return [];

      const accountIds = profiles.map(p => p.account_id).filter(Boolean) as string[];

      // Parallel queries for the last 7 days
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [oppsRes, alertsRes] = await Promise.all([
        // Opportunities created this week
        supabase
          .from('matched_opportunities_v1')
          .select('account_id')
          .in('account_id', accountIds)
          .gte('created_at', weekAgo),

        // Alerts sent this week
        supabase
          .from('hunt_alerts')
          .select('hunt_id')
          .not('sent_at', 'is', null)
          .gte('created_at', weekAgo),
      ]);

      // Count lots scanned (from vehicle_listings ingested this week, auction sources only)
      const { count: totalLots } = await supabase
        .from('vehicle_listings')
        .select('id', { count: 'exact', head: true })
        .in('source', ['pickles', 'slattery', 'manheim', 'grays', 'auto_auctions', 'vma'])
        .gte('first_seen_at', weekAgo);

      // Aggregate per dealer
      const oppCounts = new Map<string, number>();
      (oppsRes.data || []).forEach(o => {
        oppCounts.set(o.account_id, (oppCounts.get(o.account_id) || 0) + 1);
      });

      const totalAlerts = alertsRes.data?.length || 0;

      const result: DealerMetrics[] = profiles.map(p => ({
        dealer_name: p.dealer_name,
        account_id: p.account_id!,
        lots_scanned: totalLots || 0, // Same pool for all dealers
        opportunities_created: oppCounts.get(p.account_id!) || 0,
        alerts_sent: 0, // Will populate per-dealer when hunt→dealer mapping is used
      }));

      // For now put total alerts on first dealer (AJH) since they're the only active one
      if (result.length > 0) {
        result[0].alerts_sent = totalAlerts;
      }

      return result.filter(r => r.opportunities_created > 0 || r.alerts_sent > 0 || r.lots_scanned > 0);
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const totalLots = metrics?.[0]?.lots_scanned || 0;
  const totalOpps = metrics?.reduce((sum, m) => sum + m.opportunities_created, 0) || 0;
  const totalAlerts = metrics?.reduce((sum, m) => sum + m.alerts_sent, 0) || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Auction Coverage — Last 7 Days
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary strip */}
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground">{totalLots.toLocaleString()}</span>
            <span className="text-muted-foreground">lots scanned</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground">{totalOpps}</span>
            <span className="text-muted-foreground">opportunities</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Bell className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground">{totalAlerts}</span>
            <span className="text-muted-foreground">alerts sent</span>
          </div>
        </div>

        {/* Per-dealer breakdown */}
        {metrics && metrics.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dealer</TableHead>
                <TableHead className="text-center">Opps Created</TableHead>
                <TableHead className="text-center">Alerts Sent</TableHead>
                <TableHead className="text-center">Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map(m => (
                <TableRow key={m.account_id}>
                  <TableCell className="font-medium text-sm">{m.dealer_name}</TableCell>
                  <TableCell className="text-center font-mono text-sm">{m.opportunities_created}</TableCell>
                  <TableCell className="text-center font-mono text-sm">{m.alerts_sent}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="text-xs font-mono">
                      {totalLots > 0
                        ? `${((m.opportunities_created / totalLots) * 100).toFixed(1)}%`
                        : '—'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
