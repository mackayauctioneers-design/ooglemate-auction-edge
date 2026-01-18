import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AlertCircle, AlertTriangle, Bell, Check, Clock, ExternalLink, Globe, Info, Pencil, Trophy, TrendingDown, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { EditHuntDrawer } from "@/components/hunts/EditHuntDrawer";
import { CarsalesIdKitModal } from "@/components/hunts/CarsalesIdKitModal";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { HuntHeader } from "@/components/hunts/HuntHeader";
import { HuntKPICards } from "@/components/hunts/HuntKPICards";
import { HuntAlertCardEnhanced } from "@/components/hunts/HuntAlertCardEnhanced";
import { ProofOfHuntModal } from "@/components/hunts/ProofOfHuntModal";
import { useUnifiedCandidates, useCandidateCounts } from "@/hooks/useUnifiedCandidates";
import { useLiveMatches } from "@/hooks/useLiveMatches";
import type { 
  SaleHunt, 
  HuntMatch, 
  HuntScan, 
  HuntAlert,
  HuntStatus,
  MatchDecision,
  UnifiedCandidate
} from "@/types/hunts";

export default function HuntDetailPage() {
  const { huntId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [proofModalOpen, setProofModalOpen] = useState(false);
  const [selectedStrike, setSelectedStrike] = useState<HuntAlert | null>(null);
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);

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

  // Get candidate counts for tab badges
  const { data: counts } = useCandidateCounts(huntId || '', !!huntId && !!hunt);

  // LIVE MATCHES: All candidates except IGNORE (BUY + WATCH + UNVERIFIED)
  // Uses dedicated RPC that ONLY filters out IGNORE - shows UNVERIFIED too
  const { data: liveMatchesData, isLoading: liveMatchesLoading, refetch: refetchLiveMatches } = useLiveMatches({
    huntId: huntId || '',
    limit: 200,
    enabled: !!huntId,
  });

  // OPPORTUNITIES: Only BUY + WATCH (price-gap labeled)
  const { data: opportunitiesData, isLoading: opportunitiesLoading } = useUnifiedCandidates({
    huntId: huntId || '',
    limit: 100,
    excludeIgnore: true,
    enabled: !!huntId,
    staleTime: 0,
    refetchOnMount: 'always'
  });

  // Filter opportunities to only BUY/WATCH
  const opportunities = (opportunitiesData?.candidates || []).filter(
    c => c.decision === 'BUY' || c.decision === 'WATCH'
  );

  // REJECTED: Only IGNORE decisions
  const { data: rejectedData, isLoading: rejectedLoading } = useUnifiedCandidates({
    huntId: huntId || '',
    limit: 100,
    decisionFilter: 'IGNORE' as any,
    excludeIgnore: false,
    enabled: !!huntId,
    staleTime: 0,
    refetchOnMount: 'always'
  });

  // Legacy matches query for compatibility
  const { data: matches = [] } = useQuery({
    queryKey: ['hunt-matches', huntId, hunt?.criteria_version],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hunt_matches')
        .select('*, retail_listings!inner(listing_url, source)')
        .eq('hunt_id', huntId)
        .eq('criteria_version', hunt?.criteria_version || 1)
        .eq('is_stale', false)
        .order('priority_score', { ascending: false, nullsFirst: false })
        .limit(100);
      if (error) throw error;
      
      return (data || []).map((m: any) => ({
        ...m,
        listing_url: m.retail_listings?.listing_url || null,
        source: m.retail_listings?.source || null
      })) as (HuntMatch & { listing_url?: string | null; source?: string | null })[];
    },
    enabled: !!huntId && !!hunt
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['hunt-alerts', huntId, hunt?.criteria_version],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hunt_alerts')
        .select('*')
        .eq('hunt_id', huntId)
        .eq('criteria_version', hunt?.criteria_version || 1)
        .eq('is_stale', false)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as HuntAlert[];
    },
    enabled: !!huntId && !!hunt,
    staleTime: 0,
    refetchOnMount: 'always'
  });

  const { data: scans = [] } = useQuery({
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
      queryClient.invalidateQueries({ queryKey: ['hunt', huntId] });
      queryClient.invalidateQueries({ queryKey: ['unified-candidates', huntId] });
      queryClient.invalidateQueries({ queryKey: ['candidate-counts', huntId] });
      queryClient.invalidateQueries({ queryKey: ['live-matches', huntId] });
      refetchLiveMatches();
      const r = data.results?.[0];
      const total = r?.matches || 0;
      const buy = r?.buy || 0;
      const watch = r?.watch || 0;
      const unverified = r?.unverified || 0;
      toast.success(`Scan complete: ${total} matches (${buy} BUY, ${watch} WATCH, ${unverified} UNVERIFIED)`);
    },
    onError: (error) => {
      toast.error(`Scan failed: ${error.message}`);
    }
  });

  // Outward hunt mutation
  const runOutwardMutation = useMutation({
    mutationFn: async () => {
      const { data: discoveryData, error: discoveryError } = await supabase.functions.invoke('outward-hunt', {
        body: { hunt_id: huntId }
      });
      if (discoveryError) throw discoveryError;
      
      toast.info('Verifying listings...');
      try {
        await supabase.functions.invoke('outward-scrape-worker', {
          body: { batch_size: 20 }
        });
      } catch (verifyErr) {
        console.warn('Scrape worker failed:', verifyErr);
      }
      
      return discoveryData;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['hunt-alerts', huntId] });
      queryClient.invalidateQueries({ queryKey: ['unified-candidates', huntId] });
      queryClient.invalidateQueries({ queryKey: ['candidate-counts', huntId] });
      toast.success(`Web search: ${data.candidates_found || 0} candidates, ${data.alerts_emitted || 0} alerts`);
    },
    onError: (error) => {
      toast.error(`Web search failed: ${error.message}`);
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
        <div className="space-y-6">
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-4 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
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

  // Separate alerts by type
  const buyAlerts = alerts.filter(a => a.alert_type === 'BUY' && !a.acknowledged_at);
  const watchAlerts = alerts.filter(a => a.alert_type === 'WATCH' && !a.acknowledged_at);
  const acknowledgedBuyAlerts = alerts.filter(a => a.alert_type === 'BUY' && a.acknowledged_at);

  // Get the most recent acknowledged BUY alert for "proof" feature
  const latestStrike = acknowledgedBuyAlerts.length > 0 ? acknowledgedBuyAlerts[0] : null;

  const handleViewProof = (alert: HuntAlert) => {
    setSelectedStrike(alert);
    setProofModalOpen(true);
  };

  const getDecisionColor = (decision: MatchDecision | string) => {
    const d = decision.toLowerCase();
    switch (d) {
      case 'buy': return 'bg-emerald-500/10 text-emerald-600';
      case 'watch': return 'bg-amber-500/10 text-amber-600';
      case 'discovered': return 'bg-purple-500/10 text-purple-600';
      case 'unverified': return 'bg-blue-500/10 text-blue-600';
      case 'ignore': return 'bg-muted text-muted-foreground';
      default: return 'bg-muted';
    }
  };

  const getSourceTierBadge = (candidate: UnifiedCandidate) => {
    if (candidate.source_tier === 1) {
      return <Badge variant="secondary" className="text-xs bg-amber-500/20 text-amber-700 border-amber-300">🔨 Auction</Badge>;
    } else if (candidate.source_tier === 2) {
      return <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-700 border-blue-300">🛒 Marketplace</Badge>;
    } else {
      return <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">{candidate.source_class || 'Dealer'}</Badge>;
    }
  };

  // Render candidate row (reusable)
  const renderCandidateRow = (candidate: UnifiedCandidate, idx: number) => (
    <tr key={candidate.id} className={`border-t hover:bg-muted/30 ${candidate.is_cheapest ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}`}>
      <td className="p-3 font-mono text-xs text-muted-foreground">
        {idx + 1}
      </td>
      <td className="p-3">
        <div className="flex flex-col gap-0.5">
          <span className={`font-mono text-xs px-1.5 py-0.5 rounded inline-block w-fit ${
            (candidate.dna_score || 0) >= 8 ? 'bg-emerald-500/20 text-emerald-700' :
            (candidate.dna_score || 0) >= 5 ? 'bg-amber-500/20 text-amber-700' :
            'bg-muted text-muted-foreground'
          }`}>
            {candidate.dna_score?.toFixed(1) || '—'}
          </span>
        </div>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-2">
          {getSourceTierBadge(candidate)}
          {candidate.is_verified && (
            <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-200">
              <Check className="h-3 w-3 mr-1" />
              Verified
            </Badge>
          )}
        </div>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-1">
          {candidate.is_cheapest && <Zap className="h-4 w-4 text-amber-500" />}
          <span className={candidate.is_cheapest ? 'font-bold text-emerald-600' : ''}>
            {candidate.price ? `$${candidate.price.toLocaleString()}` : '—'}
          </span>
        </div>
      </td>
      <td className="p-3">
        <Badge className={getDecisionColor(candidate.decision)}>
          {candidate.decision}
        </Badge>
      </td>
      <td className="p-3">
        <div className="text-xs">
          <div className="font-medium">{candidate.title || `${candidate.year} ${candidate.make} ${candidate.model}`}</div>
          <div className="text-muted-foreground">
            {candidate.km && `${candidate.km.toLocaleString()} km`}
            {candidate.location && ` • ${candidate.location}`}
          </div>
        </div>
      </td>
      <td className="p-3">
        <div className="flex flex-wrap gap-1 text-xs">
          {(candidate as any).series_family && (
            <Badge variant="outline" className="text-[10px] font-mono">{(candidate as any).series_family}</Badge>
          )}
          {(candidate as any).engine_family && (
            <Badge variant="outline" className="text-[10px] font-mono">{(candidate as any).engine_family}</Badge>
          )}
          {(candidate as any).body_type && (
            <Badge variant="outline" className="text-[10px] font-mono">{(candidate as any).body_type}</Badge>
          )}
        </div>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-2">
          {candidate.requires_manual_check ? (
            <>
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-200">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Manual
              </Badge>
              <CarsalesIdKitModal
                title={candidate.title || `${candidate.year} ${candidate.make} ${candidate.model}`}
                domain={candidate.domain || ''}
                idKit={candidate.id_kit}
                year={candidate.year}
                make={candidate.make}
                model={candidate.model}
                variant={candidate.variant_raw}
                km={candidate.km}
                price={candidate.price}
                location={candidate.location}
              />
            </>
          ) : candidate.url && !candidate.url.startsWith('internal://') ? (
            <a
              href={candidate.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <HuntHeader
          hunt={hunt as any}
          onUpdateStatus={(status) => updateStatusMutation.mutate(status)}
          onRunScan={() => runScanMutation.mutate()}
          onRunOutwardScan={() => runOutwardMutation.mutate()}
          isRunningScans={runScanMutation.isPending}
          isUpdatingStatus={updateStatusMutation.isPending}
          isRunningOutward={runOutwardMutation.isPending}
          lastAlertAt={alerts[0]?.created_at}
          lastMatchAt={matches[0]?.matched_at}
        />

        {/* Link to Hunt Alerts */}
        {alerts.length > 0 && (
          <div className="flex items-center justify-end">
            <Link to="/hunt-alerts">
              <Button variant="outline" size="sm" className="gap-2">
                <Bell className="h-4 w-4" />
                View All Alerts ({alerts.filter(a => !a.acknowledged_at).length} new)
              </Button>
            </Link>
          </div>
        )}

        {/* Strike Success Banner */}
        {latestStrike && (
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Trophy className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                    Kiting Mode Strike!
                  </div>
                  <div className="text-sm text-muted-foreground">
                    This hunt found a successful match
                  </div>
                </div>
              </div>
              <Button 
                variant="outline" 
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={() => handleViewProof(latestStrike)}
              >
                <Trophy className="h-4 w-4 mr-2" />
                View Proof
              </Button>
            </div>
          </div>
        )}

        {/* Scan Required Banner */}
        {(() => {
          const latestScanVersion = scans.length > 0 
            ? Math.max(...scans.map(s => s.criteria_version || 0)) 
            : 0;
          const needsScan = hunt.criteria_version > latestScanVersion;
          
          if (!needsScan) return null;
          
          return (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-300 dark:border-amber-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-amber-500/20 flex items-center justify-center animate-pulse">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <div className="font-semibold text-amber-700 dark:text-amber-400">
                      Hunt updated — no scan has run yet
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Run a scan to refresh results for the new criteria (v{hunt.criteria_version})
                    </div>
                  </div>
                </div>
                <Button 
                  variant="default"
                  className="bg-amber-500 hover:bg-amber-600 text-white animate-pulse"
                  onClick={() => runScanMutation.mutate()}
                  disabled={runScanMutation.isPending}
                >
                  <Zap className="h-4 w-4 mr-2" />
                  {runScanMutation.isPending ? 'Scanning...' : 'Scan Now'}
                </Button>
              </div>
            </div>
          );
        })()}

        {/* Coverage Bar */}
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-primary" />
                <span className="font-medium text-sm">Coverage</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                  <Check className="h-3 w-3 mr-1" /> Auctions
                </Badge>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                  <Check className="h-3 w-3 mr-1" /> Dealer sites
                </Badge>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                  <Check className="h-3 w-3 mr-1" /> Marketplaces
                </Badge>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                  <Check className="h-3 w-3 mr-1" /> Web discovery
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards */}
        <HuntKPICards 
          alerts={alerts} 
          matches={matches}
        />

        {/* Match Criteria Status */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-primary" />
              Match Criteria
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${hunt.series_family ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                <span className="text-muted-foreground">Series:</span>
                <span className="font-medium">
                  {hunt.series_family 
                    ? <span className="text-emerald-600">✓ {hunt.series_family}</span>
                    : <span className="text-muted-foreground">— auto</span>
                  }
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${hunt.engine_code && hunt.engine_code !== 'UNKNOWN' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="text-muted-foreground">Engine:</span>
                <span className="font-medium">
                  {hunt.engine_code && hunt.engine_code !== 'UNKNOWN' 
                    ? <span className="text-emerald-600">✓ {hunt.engine_code}</span>
                    : <span className="text-amber-600">⚠ unknown</span>
                  }
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${hunt.body_type || hunt.cab_type ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="text-muted-foreground">Body:</span>
                <span className="font-medium">
                  {(hunt.body_type || hunt.cab_type) 
                    ? <span className="text-emerald-600">✓ {hunt.body_type || hunt.cab_type}</span>
                    : <span className="text-amber-600">⚠ unknown</span>
                  }
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${hunt.badge ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                <span className="text-muted-foreground">Badge:</span>
                <span className="font-medium">
                  {hunt.badge 
                    ? <span className="text-emerald-600">✓ {hunt.badge}</span>
                    : <span className="text-muted-foreground">— not set</span>
                  }
                </span>
              </div>
            </div>
            
            {hunt.must_have_tokens && hunt.must_have_tokens.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Must-Have:</span>
                <div className="flex flex-wrap gap-1">
                  {hunt.must_have_tokens.map((token) => (
                    <Badge 
                      key={token} 
                      variant="outline" 
                      className={`font-mono text-xs ${hunt.must_have_mode === 'strict' ? 'border-amber-500 text-amber-600' : ''}`}
                    >
                      {token.toLowerCase()}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hunt Configuration */}
        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Hunt Configuration</CardTitle>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setEditDrawerOpen(true)}
              className="h-8 gap-1"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Year:</span>
                <span className="ml-2 font-medium">{hunt.year || 'Any'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">KM Target:</span>
                <span className="ml-2 font-medium">{hunt.km ? `${(hunt.km / 1000).toFixed(0)}k (±${hunt.km_tolerance_pct}%)` : 'Any'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Max Price:</span>
                <span className="ml-2 font-medium">${(hunt as any).max_price?.toLocaleString() || 'Any'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Exit Value:</span>
                <span className="ml-2 font-medium">${hunt.proven_exit_value?.toLocaleString() || 'Not set'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Tabs - IDENTITY-FIRST STRUCTURE */}
        <Tabs defaultValue="live-matches">
          <TabsList className="flex-wrap">
            <TabsTrigger value="live-matches" className="data-[state=active]:text-primary">
              Live Matches ({liveMatchesData?.totalCount || counts?.live_matches || 0})
            </TabsTrigger>
            <TabsTrigger value="opportunities" className="data-[state=active]:text-emerald-600">
              Opportunities ({counts?.opportunities || opportunities.length})
            </TabsTrigger>
            <TabsTrigger value="rejected" className="text-muted-foreground">
              Rejected ({counts?.ignore || 0})
            </TabsTrigger>
            <TabsTrigger value="scans">
              Scans ({scans.length})
            </TabsTrigger>
          </TabsList>

          {/* LIVE MATCHES - Shows ALL candidates except IGNORE */}
          <TabsContent value="live-matches" className="mt-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  Live Matches
                  <Badge variant="outline" className="ml-2">
                    {liveMatchesData?.totalCount || 0} total (BUY + WATCH + UNVERIFIED)
                  </Badge>
                  <div className="ml-auto flex gap-2 text-xs">
                    <Badge variant="secondary" className="bg-amber-500/10 text-amber-700">
                      {counts?.by_tier?.auction || 0} Auctions
                    </Badge>
                    <Badge variant="secondary" className="bg-blue-500/10 text-blue-700">
                      {counts?.by_tier?.marketplace || 0} Marketplaces
                    </Badge>
                    <Badge variant="secondary" className="bg-muted text-muted-foreground">
                      {counts?.by_tier?.dealer || 0} Dealers
                    </Badge>
                  </div>
                  {liveMatchesData?.cheapestPrice && (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600">
                      <TrendingDown className="h-3 w-3 mr-1" />
                      From ${liveMatchesData.cheapestPrice.toLocaleString()}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="mb-3 mx-4 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                  <Info className="h-4 w-4 inline mr-2" />
                  Showing ALL matching vehicles ranked by: Auction → Marketplace → Dealer, then by identity score and price.
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">#</th>
                        <th className="p-3 text-left font-medium">Score</th>
                        <th className="p-3 text-left font-medium">Source</th>
                        <th className="p-3 text-left font-medium">Price</th>
                        <th className="p-3 text-left font-medium">Status</th>
                        <th className="p-3 text-left font-medium">Details</th>
                        <th className="p-3 text-left font-medium">Identity</th>
                        <th className="p-3 text-left font-medium">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveMatchesLoading ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-muted-foreground">
                            Loading live matches...
                          </td>
                        </tr>
                      ) : (liveMatchesData?.matches || []).length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-muted-foreground">
                            <div className="flex flex-col items-center gap-2">
                              <Globe className="h-8 w-8 text-muted-foreground/50" />
                              <span>No matches found. Click "Scan Now" or "Search Web" to find vehicles.</span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        (liveMatchesData?.matches || []).map((match, idx) => (
                          <tr key={match.id} className="border-t hover:bg-muted/30">
                            <td className="p-3 text-muted-foreground">{idx + 1}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-1">
                                <Badge variant="outline" className="bg-primary/10 text-primary">
                                  {match.dna_score?.toFixed(1) || '—'}
                                </Badge>
                              </div>
                            </td>
                            <td className="p-3">
                              <Badge 
                                variant="outline" 
                                className={
                                  match.source_tier === 1 ? 'bg-amber-500/10 text-amber-700 border-amber-300' :
                                  match.source_tier === 2 ? 'bg-blue-500/10 text-blue-700 border-blue-300' :
                                  'bg-muted text-muted-foreground'
                                }
                              >
                                {match.source || match.source_class || 'Unknown'}
                              </Badge>
                            </td>
                            <td className="p-3 font-medium">
                              {match.price ? `$${match.price.toLocaleString()}` : '—'}
                              {match.is_cheapest && (
                                <Badge variant="outline" className="ml-1 bg-emerald-500/10 text-emerald-600 text-xs">
                                  ★
                                </Badge>
                              )}
                            </td>
                            <td className="p-3">
                              <Badge 
                                variant="outline" 
                                className={
                                  match.decision === 'BUY' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-300' :
                                  match.decision === 'WATCH' ? 'bg-amber-500/10 text-amber-600 border-amber-300' :
                                  'bg-muted text-muted-foreground border-muted-foreground/30'
                                }
                              >
                                {match.decision}
                              </Badge>
                              {match.blocked_reason && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({match.blocked_reason})
                                </span>
                              )}
                            </td>
                            <td className="p-3">
                              <div className="text-xs">
                                <div className="font-medium">{match.title || `${match.year} ${match.make} ${match.model}`}</div>
                                <div className="text-muted-foreground">
                                  {match.km ? `${(match.km / 1000).toFixed(0)}k km` : ''} 
                                  {match.location ? ` • ${match.location}` : ''}
                                </div>
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="text-xs space-y-0.5">
                                {match.series_family && (
                                  <Badge variant="outline" className="mr-1 text-xs">{match.series_family}</Badge>
                                )}
                                {match.engine_family && (
                                  <Badge variant="outline" className="mr-1 text-xs">{match.engine_family}</Badge>
                                )}
                                {match.body_type && (
                                  <Badge variant="outline" className="mr-1 text-xs">{match.body_type}</Badge>
                                )}
                              </div>
                            </td>
                            <td className="p-3">
                              {match.url && !match.url.startsWith('internal://') ? (
                                <a
                                  href={match.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  View
                                </a>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* OPPORTUNITIES - Only BUY/WATCH with price-gap labels */}
          <TabsContent value="opportunities" className="mt-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Zap className="h-4 w-4 text-emerald-600" />
                  Opportunities
                  <Badge variant="outline" className="ml-2 bg-emerald-500/10 text-emerald-600">
                    {counts?.buy || 0} BUY
                  </Badge>
                  <Badge variant="outline" className="ml-1 bg-amber-500/10 text-amber-600">
                    {counts?.watch || 0} WATCH
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="mb-3 mx-4 p-3 rounded-lg bg-emerald-500/5 border border-emerald-200/50 text-sm">
                  <Info className="h-4 w-4 inline mr-2 text-emerald-600" />
                  These are vehicles with confirmed price gaps based on proven exit value. BUY = high confidence strike. WATCH = worth monitoring.
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">#</th>
                        <th className="p-3 text-left font-medium">Score</th>
                        <th className="p-3 text-left font-medium">Source</th>
                        <th className="p-3 text-left font-medium">Price</th>
                        <th className="p-3 text-left font-medium">Status</th>
                        <th className="p-3 text-left font-medium">Details</th>
                        <th className="p-3 text-left font-medium">Identity</th>
                        <th className="p-3 text-left font-medium">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opportunitiesLoading ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-muted-foreground">
                            Loading opportunities...
                          </td>
                        </tr>
                      ) : opportunities.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-muted-foreground">
                            <div className="flex flex-col items-center gap-2">
                              <Zap className="h-8 w-8 text-muted-foreground/50" />
                              <span>No BUY/WATCH opportunities yet. Check "Live Matches" for all available vehicles.</span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        opportunities.map((candidate, idx) => 
                          renderCandidateRow(candidate, idx)
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* REJECTED - IGNORE decisions with reasons */}
          <TabsContent value="rejected" className="mt-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  Rejected
                  <Badge variant="outline" className="ml-2 text-muted-foreground">
                    {counts?.ignore || 0} items
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="mb-3 mx-4 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                  These listings were evaluated but rejected due to identity mismatch (series/engine/body) or non-listing content (news, reviews, etc.).
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">Reason</th>
                        <th className="p-3 text-left font-medium">Source</th>
                        <th className="p-3 text-left font-medium">Price</th>
                        <th className="p-3 text-left font-medium">Details</th>
                        <th className="p-3 text-left font-medium">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rejectedLoading ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-muted-foreground">
                            Loading rejected items...
                          </td>
                        </tr>
                      ) : (rejectedData?.candidates || []).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-muted-foreground">
                            No rejected items. Gates are being applied correctly.
                          </td>
                        </tr>
                      ) : (
                        (rejectedData?.candidates || []).map((candidate) => (
                          <tr key={candidate.id} className="border-t hover:bg-muted/30 opacity-60">
                            <td className="p-3">
                              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                                {candidate.blocked_reason || 'Unknown'}
                              </Badge>
                            </td>
                            <td className="p-3">
                              {getSourceTierBadge(candidate)}
                            </td>
                            <td className="p-3">
                              {candidate.price ? `$${candidate.price.toLocaleString()}` : '—'}
                            </td>
                            <td className="p-3">
                              <div className="text-xs">
                                <div>{candidate.title || `${candidate.year} ${candidate.make} ${candidate.model}`}</div>
                              </div>
                            </td>
                            <td className="p-3">
                              {candidate.url && !candidate.url.startsWith('internal://') ? (
                                <a
                                  href={candidate.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                >
                                  View <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SCANS - Audit trail */}
          <TabsContent value="scans" className="mt-4">
            <div className="space-y-3">
              {scans.length === 0 ? (
                <Card className="py-8">
                  <CardContent className="text-center text-muted-foreground">
                    No scans run yet
                  </CardContent>
                </Card>
              ) : (
                scans.map((scan) => {
                  const metadata = (scan as any).metadata as { 
                    sources_scanned?: string[]; 
                    rejected_by_gates?: number;
                    rejection_reasons?: Record<string, number>;
                  } | null;
                  
                  return (
                    <Card key={scan.id}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Badge className={
                              scan.status === 'ok' ? 'bg-emerald-500/10 text-emerald-600' :
                              scan.status === 'error' ? 'bg-destructive/10 text-destructive' :
                              'bg-amber-500/10 text-amber-600'
                            }>
                              {scan.status}
                            </Badge>
                            <div className="text-sm">
                              <span className="font-medium">{scan.candidates_checked ?? 0}</span> checked • 
                              <span className="font-medium ml-1">{scan.matches_found ?? 0}</span> matches • 
                              <span className="font-medium ml-1">{scan.alerts_emitted ?? 0}</span> alerts
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            {formatDistanceToNow(new Date(scan.started_at), { addSuffix: true })}
                          </div>
                        </div>
                        
                        {metadata?.sources_scanned && metadata.sources_scanned.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Sources:</span>
                            {metadata.sources_scanned.map(src => (
                              <Badge key={src} variant="secondary" className="text-xs capitalize">
                                {src.replace('_', ' ')}
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        {metadata?.rejected_by_gates && metadata.rejected_by_gates > 0 && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
                            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                            <span>
                              <span className="font-medium text-foreground">{metadata.rejected_by_gates}</span> near-misses rejected
                              {metadata.rejection_reasons && Object.keys(metadata.rejection_reasons).length > 0 && (
                                <span className="ml-1">
                                  ({Object.entries(metadata.rejection_reasons).map(([reason, count], i) => (
                                    <span key={reason}>
                                      {i > 0 && ', '}
                                      {count} {reason.toLowerCase().replace(/_/g, ' ')}
                                    </span>
                                  ))})
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        
                        {scan.error && (
                          <div className="flex items-center gap-2 text-xs text-destructive">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span className="truncate">{scan.error}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Proof of Hunt Modal */}
      {selectedStrike && hunt && (
        <ProofOfHuntModal
          open={proofModalOpen}
          onOpenChange={setProofModalOpen}
          hunt={hunt}
          strikeAlert={selectedStrike}
          scans={scans}
        />
      )}

      {/* Edit Hunt Drawer */}
      {hunt && (
        <EditHuntDrawer
          open={editDrawerOpen}
          onOpenChange={setEditDrawerOpen}
          hunt={hunt}
        />
      )}
    </AppLayout>
  );
}