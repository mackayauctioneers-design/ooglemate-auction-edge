import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft,
  Target, 
  Play, 
  Pause, 
  CheckCircle,
  AlertCircle,
  Clock
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import { HuntAlertCardCompact } from "@/components/hunts/HuntAlertCard";
import type { 
  SaleHunt, 
  HuntMatch, 
  HuntScan, 
  HuntAlert,
  HuntStatus,
  MatchDecision
} from "@/types/hunts";

export default function HuntDetailPage() {
  const { huntId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: hunt, isLoading: huntLoading } = useQuery({
    queryKey: ['hunt', huntId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sale_hunts')
        .select('*')
        .eq('id', huntId)
        .single();
      if (error) throw error;
      return data as SaleHunt;
    },
    enabled: !!huntId
  });

  const { data: matches } = useQuery({
    queryKey: ['hunt-matches', huntId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hunt_matches')
        .select('*')
        .eq('hunt_id', huntId)
        .order('match_score', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as HuntMatch[];
    },
    enabled: !!huntId
  });

  const { data: alerts } = useQuery({
    queryKey: ['hunt-alerts', huntId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hunt_alerts')
        .select('*')
        .eq('hunt_id', huntId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as HuntAlert[];
    },
    enabled: !!huntId
  });

  const { data: scans } = useQuery({
    queryKey: ['hunt-scans', huntId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hunt_scans')
        .select('*')
        .eq('hunt_id', huntId)
        .order('started_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as HuntScan[];
    },
    enabled: !!huntId
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: HuntStatus) => {
      const { error } = await (supabase as any)
        .from('sale_hunts')
        .update({ status })
        .eq('id', huntId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunt', huntId] });
      toast.success('Hunt status updated');
    }
  });

  const runScanMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('run-hunt-scan', {
        body: { hunt_id: huntId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['hunt-matches', huntId] });
      queryClient.invalidateQueries({ queryKey: ['hunt-alerts', huntId] });
      queryClient.invalidateQueries({ queryKey: ['hunt-scans', huntId] });
      toast.success(`Scan complete: ${data.results?.[0]?.matches || 0} matches`);
    }
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
      queryClient.invalidateQueries({ queryKey: ['hunt-alerts', huntId] });
    }
  });

  if (huntLoading) {
    return (
      <AppLayout>
        <Skeleton className="h-96 w-full" />
      </AppLayout>
    );
  }

  if (!hunt) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold">Hunt not found</h2>
          <Button className="mt-4" onClick={() => navigate('/hunts')}>
            Back to Hunts
          </Button>
        </div>
      </AppLayout>
    );
  }

  const getDecisionColor = (decision: MatchDecision) => {
    switch (decision) {
      case 'buy': return 'bg-emerald-500/10 text-emerald-500';
      case 'watch': return 'bg-amber-500/10 text-amber-500';
      case 'ignore': return 'bg-muted text-muted-foreground';
      default: return 'bg-muted';
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/hunts')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Target className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold">
                {hunt.year} {hunt.make} {hunt.model}
              </h1>
              <Badge className={
                hunt.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' :
                hunt.status === 'paused' ? 'bg-amber-500/10 text-amber-500' :
                'bg-muted'
              }>
                {hunt.status}
              </Badge>
            </div>
            {hunt.variant_family && (
              <p className="text-muted-foreground mt-1">{hunt.variant_family}</p>
            )}
          </div>

          <div className="flex gap-2">
            {hunt.status === 'active' && (
              <>
                <Button onClick={() => runScanMutation.mutate()} disabled={runScanMutation.isPending}>
                  <Play className="h-4 w-4 mr-2" />
                  Run Scan Now
                </Button>
                <Button variant="outline" onClick={() => updateStatusMutation.mutate('paused')}>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </Button>
              </>
            )}
            {hunt.status === 'paused' && (
              <Button onClick={() => updateStatusMutation.mutate('active')}>
                <Play className="h-4 w-4 mr-2" />
                Resume
              </Button>
            )}
            {hunt.status !== 'done' && (
              <Button variant="outline" onClick={() => updateStatusMutation.mutate('done')}>
                <CheckCircle className="h-4 w-4 mr-2" />
                Mark Done
              </Button>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{matches?.length || 0}</div>
              <div className="text-sm text-muted-foreground">Total Matches</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-emerald-500">
                {matches?.filter(m => m.decision === 'buy').length || 0}
              </div>
              <div className="text-sm text-muted-foreground">BUY Candidates</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-amber-500">
                {matches?.filter(m => m.decision === 'watch').length || 0}
              </div>
              <div className="text-sm text-muted-foreground">WATCH Candidates</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">
                {scans?.length || 0}
              </div>
              <div className="text-sm text-muted-foreground">Scans Run</div>
            </CardContent>
          </Card>
        </div>

        {/* Hunt Config */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Hunt Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">KM Target:</span>
                <span className="ml-2">{hunt.km ? `${(hunt.km / 1000).toFixed(0)}k (±${hunt.km_tolerance_pct}%)` : 'Any'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Sources:</span>
                <span className="ml-2">{hunt.sources_enabled.join(', ')}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Scan Interval:</span>
                <span className="ml-2">{hunt.scan_interval_minutes} min</span>
              </div>
              <div>
                <span className="text-muted-foreground">Expires:</span>
                <span className="ml-2">
                  {hunt.expires_at ? format(new Date(hunt.expires_at), 'MMM d, yyyy') : 'Never'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">BUY Gap:</span>
                <span className="ml-2">${hunt.min_gap_abs_buy} / {hunt.min_gap_pct_buy}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">WATCH Gap:</span>
                <span className="ml-2">${hunt.min_gap_abs_watch} / {hunt.min_gap_pct_watch}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">BUY Age:</span>
                <span className="ml-2">≤{hunt.max_listing_age_days_buy} days</span>
              </div>
              <div>
                <span className="text-muted-foreground">WATCH Age:</span>
                <span className="ml-2">≤{hunt.max_listing_age_days_watch} days</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="alerts">
          <TabsList>
            <TabsTrigger value="alerts">
              Alerts ({alerts?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="matches">
              All Matches ({matches?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="scans">
              Scan History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="space-y-3 mt-4">
            {!alerts?.length ? (
              <Card className="py-8">
                <CardContent className="text-center text-muted-foreground">
                  No alerts yet. Run a scan to find matches.
                </CardContent>
              </Card>
            ) : (
              alerts.map((alert) => (
                <HuntAlertCardCompact
                  key={alert.id}
                  alert={alert}
                  onAcknowledge={(id) => acknowledgeAlertMutation.mutate(id)}
                  isAcknowledging={acknowledgeAlertMutation.isPending}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="matches" className="mt-4">
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3 text-left">Score</th>
                    <th className="p-3 text-left">Decision</th>
                    <th className="p-3 text-left">Price</th>
                    <th className="p-3 text-left">Gap</th>
                    <th className="p-3 text-left">Matched</th>
                    <th className="p-3 text-left">Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {matches?.map((match) => (
                    <tr key={match.id} className="border-t">
                      <td className="p-3 font-medium">{match.match_score.toFixed(1)}</td>
                      <td className="p-3">
                        <Badge className={getDecisionColor(match.decision)}>
                          {match.decision}
                        </Badge>
                      </td>
                      <td className="p-3">
                        ${match.asking_price?.toLocaleString() || '?'}
                      </td>
                      <td className="p-3">
                        {match.gap_dollars !== null ? (
                          <span className={match.gap_dollars > 0 ? 'text-emerald-500' : 'text-destructive'}>
                            ${match.gap_dollars?.toLocaleString()} ({match.gap_pct?.toFixed(1)}%)
                          </span>
                        ) : '—'}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {formatDistanceToNow(new Date(match.matched_at), { addSuffix: true })}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {match.reasons?.slice(0, 3).map((r, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {r}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="scans" className="mt-4">
            <div className="space-y-2">
              {scans?.map((scan) => (
                <Card key={scan.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge className={
                        scan.status === 'ok' ? 'bg-emerald-500/10 text-emerald-500' :
                        scan.status === 'error' ? 'bg-destructive/10 text-destructive' :
                        'bg-muted'
                      }>
                        {scan.status}
                      </Badge>
                      <div className="text-sm">
                        {scan.candidates_checked ?? 0} checked • 
                        {scan.matches_found ?? 0} matches • 
                        {scan.alerts_emitted ?? 0} alerts
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      {formatDistanceToNow(new Date(scan.started_at), { addSuffix: true })}
                      {scan.error && (
                        <div className="flex items-center gap-1 text-destructive">
                          <AlertCircle className="h-4 w-4" />
                          <span className="text-xs truncate max-w-[200px]">{scan.error}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
