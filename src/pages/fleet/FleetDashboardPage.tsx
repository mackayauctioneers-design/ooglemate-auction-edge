import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  TrendingUp, TrendingDown, DollarSign, Target, Clock,
  Users, BarChart3, AlertTriangle, CheckCircle2, RefreshCw,
  ArrowUpRight, Zap, Package,
} from 'lucide-react';
import { format, subDays, startOfDay } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIData {
  totalInstructions: number;
  instructionsWon: number;
  instructionsLost: number;
  instructionsPassed: number;
  winRate: number;
  totalBidValue: number;
  totalWonValue: number;
  avgBidVsTarget: number;
  activeInstructions: number;
  criticalPending: number;
}

interface BuyerPerformance {
  user_id: string;
  display_name: string | null;
  won: number;
  lost: number;
  passed: number;
  total: number;
  winRate: number;
  totalWonValue: number;
  avgBidVsTarget: number;
}

interface StockGap {
  make: string;
  model: string;
  year_min: number | null;
  year_max: number | null;
  trim: string | null;
  sold_30d: number;
  in_stock: number;
  stock_gap: number;
  monthly_opportunity_value: number | null;
  avg_gross_profit: number | null;
  avg_days_to_sell: number | null;
}

interface AgedStock {
  make: string;
  model: string;
  year: number | null;
  trim: string | null;
  days_on_lot: number | null;
  asking_price: number | null;
  stock_number: string;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label, value, sub, icon: Icon, trend, color = 'text-white',
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; trend?: 'up' | 'down' | null; color?: string;
}) {
  return (
    <Card className="bg-white/[0.03] border-white/10">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <p className="text-white/50 text-xs uppercase tracking-wider">{label}</p>
          <Icon className={cn('h-4 w-4', color)} />
        </div>
        <p className={cn('text-2xl font-bold', color)}>{value}</p>
        {sub && <p className="text-white/40 text-xs mt-0.5">{sub}</p>}
        {trend && (
          <div className={cn('flex items-center gap-1 mt-1 text-xs', trend === 'up' ? 'text-emerald-400' : 'text-red-400')}>
            {trend === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FleetDashboardPage() {
  const { user } = useAuth();
  const [fleetClientId, setFleetClientId] = useState<string | null>(null);
  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [buyerPerformance, setBuyerPerformance] = useState<BuyerPerformance[]>([]);
  const [stockGaps, setStockGaps] = useState<StockGap[]>([]);
  const [agedStock, setAgedStock] = useState<AgedStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningEngine, setRunningEngine] = useState(false);
  const [tab, setTab] = useState('overview');

  // Determine fleet client
  useEffect(() => {
    if (!user) return;
    supabase
      .from('fleet_client_users')
      .select('fleet_client_id')
      .eq('user_id', user.id)
      .in('role', ['manager', 'admin'])
      .single()
      .then(({ data }) => {
        if (data) setFleetClientId(data.fleet_client_id);
      });
  }, [user]);

  const fetchData = useCallback(async () => {
    if (!fleetClientId) return;
    setLoading(true);

    const since30d = subDays(new Date(), 30).toISOString();

    // Fetch instructions for KPIs
    const { data: instructions } = await supabase
      .from('fleet_buyer_instructions')
      .select('id, status, bid_amount, target_acquisition_price, priority, assigned_buyer_id, created_at')
      .eq('fleet_client_id', fleetClientId)
      .gte('created_at', since30d);

    if (instructions) {
      const won = instructions.filter((i) => i.status === 'won');
      const lost = instructions.filter((i) => i.status === 'lost');
      const passed = instructions.filter((i) => i.status === 'passed');
      const active = instructions.filter((i) => ['pending', 'acknowledged', 'bid_placed'].includes(i.status));
      const critical = active.filter((i) => i.priority === 'critical');

      const totalBidValue = instructions
        .filter((i) => i.bid_amount)
        .reduce((sum, i) => sum + (i.bid_amount || 0), 0);

      const totalWonValue = won
        .filter((i) => i.bid_amount)
        .reduce((sum, i) => sum + (i.bid_amount || 0), 0);

      const bidVsTargetDeltas = instructions
        .filter((i) => i.bid_amount && i.target_acquisition_price)
        .map((i) => ((i.bid_amount! - i.target_acquisition_price!) / i.target_acquisition_price!) * 100);

      const avgBidVsTarget = bidVsTargetDeltas.length
        ? bidVsTargetDeltas.reduce((a, b) => a + b, 0) / bidVsTargetDeltas.length
        : 0;

      setKpis({
        totalInstructions: instructions.length,
        instructionsWon: won.length,
        instructionsLost: lost.length,
        instructionsPassed: passed.length,
        winRate: instructions.length > 0 ? Math.round((won.length / instructions.length) * 100) : 0,
        totalBidValue,
        totalWonValue,
        avgBidVsTarget,
        activeInstructions: active.length,
        criticalPending: critical.length,
      });

      // Buyer performance
      const { data: buyers } = await supabase
        .from('fleet_client_users')
        .select('user_id, display_name')
        .eq('fleet_client_id', fleetClientId)
        .eq('is_active', true);

      if (buyers) {
        const perf: BuyerPerformance[] = buyers.map((b) => {
          const buyerInstructions = instructions.filter((i) => i.assigned_buyer_id === b.user_id);
          const bWon = buyerInstructions.filter((i) => i.status === 'won');
          const bLost = buyerInstructions.filter((i) => i.status === 'lost');
          const bPassed = buyerInstructions.filter((i) => i.status === 'passed');
          const bTotal = bWon.length + bLost.length + bPassed.length;
          const bWonValue = bWon.reduce((sum, i) => sum + (i.bid_amount || 0), 0);
          const bDeltas = buyerInstructions
            .filter((i) => i.bid_amount && i.target_acquisition_price)
            .map((i) => ((i.bid_amount! - i.target_acquisition_price!) / i.target_acquisition_price!) * 100);
          return {
            user_id: b.user_id,
            display_name: b.display_name,
            won: bWon.length,
            lost: bLost.length,
            passed: bPassed.length,
            total: bTotal,
            winRate: bTotal > 0 ? Math.round((bWon.length / bTotal) * 100) : 0,
            totalWonValue: bWonValue,
            avgBidVsTarget: bDeltas.length ? bDeltas.reduce((a, b) => a + b, 0) / bDeltas.length : 0,
          };
        });
        setBuyerPerformance(perf.sort((a, b) => b.won - a.won));
      }
    }

    // Stock gaps
    const { data: gaps } = await supabase
      .from('fleet_velocity_metrics')
      .select('make, model, year_min, year_max, trim, sold_30d, in_stock, stock_gap, monthly_opportunity_value, avg_gross_profit, avg_days_to_sell')
      .eq('fleet_client_id', fleetClientId)
      .gt('stock_gap', 0)
      .order('monthly_opportunity_value', { ascending: false })
      .limit(20);

    setStockGaps((gaps as unknown as StockGap[]) || []);

    // Aged stock (>60 days)
    const { data: aged } = await supabase
      .from('fleet_inventory_feed')
      .select('make, model, year, trim, days_on_lot, asking_price, stock_number')
      .eq('fleet_client_id', fleetClientId)
      .eq('status', 'available')
      .gte('days_on_lot', 60)
      .order('days_on_lot', { ascending: false })
      .limit(20);

    setAgedStock((aged as AgedStock[]) || []);
    setLoading(false);
  }, [fleetClientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runVelocityEngine = async () => {
    setRunningEngine(true);
    try {
      await supabase.functions.invoke('fleet-velocity-engine', { body: { fleet_client_id: fleetClientId } });
      await supabase.functions.invoke('fleet-score-opportunities', { body: { fleet_client_id: fleetClientId } });
      toast.success('Engine run complete — data refreshed');
      fetchData();
    } catch {
      toast.error('Engine run failed');
    } finally {
      setRunningEngine(false);
    }
  };

  if (!fleetClientId) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto mb-3" />
          <p className="text-white/60">No Fleet client associated with your account.</p>
          <p className="text-white/30 text-sm mt-1">Contact your CarBitrage account manager.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-emerald-400" />
              Fleet Dashboard
            </h1>
            <p className="text-white/40 text-sm mt-0.5">Last 30 days · {format(new Date(), 'EEEE d MMMM yyyy')}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:bg-white/10 text-xs"
              onClick={fetchData} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1', loading && 'animate-spin')} /> Refresh
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
              onClick={runVelocityEngine} disabled={runningEngine}>
              <Zap className="h-3.5 w-3.5 mr-1" />
              {runningEngine ? 'Running…' : 'Run Engine'}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-white/5 border border-white/10 mb-4">
            <TabsTrigger value="overview" className="data-[state=active]:bg-white/10">Overview</TabsTrigger>
            <TabsTrigger value="gaps" className="data-[state=active]:bg-white/10">Stock Gaps</TabsTrigger>
            <TabsTrigger value="team" className="data-[state=active]:bg-white/10">Team Performance</TabsTrigger>
            <TabsTrigger value="aged" className="data-[state=active]:bg-white/10">Aged Stock</TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview">
            {kpis && (
              <>
                {/* KPI grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <KPICard label="Win Rate" value={`${kpis.winRate}%`}
                    sub={`${kpis.instructionsWon} won of ${kpis.totalInstructions}`}
                    icon={Target} color={kpis.winRate >= 40 ? 'text-emerald-400' : 'text-amber-400'} />
                  <KPICard label="Total Won Value" value={`$${Math.round(kpis.totalWonValue / 1000)}k`}
                    sub="acquisition cost" icon={DollarSign} color="text-emerald-400" />
                  <KPICard label="Active Instructions" value={kpis.activeInstructions}
                    sub={kpis.criticalPending > 0 ? `${kpis.criticalPending} critical` : 'No critical items'}
                    icon={AlertTriangle} color={kpis.criticalPending > 0 ? 'text-red-400' : 'text-white'} />
                  <KPICard label="Avg Bid vs Target"
                    value={`${kpis.avgBidVsTarget >= 0 ? '+' : ''}${kpis.avgBidVsTarget.toFixed(1)}%`}
                    sub={kpis.avgBidVsTarget <= 0 ? 'Under target — good' : 'Over target — review'}
                    icon={TrendingUp} color={kpis.avgBidVsTarget <= 2 ? 'text-emerald-400' : 'text-red-400'} />
                </div>

                {/* Outcome breakdown */}
                <Card className="bg-white/[0.03] border-white/10 mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-white/70">Instruction Outcomes (30 days)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-4">
                      {[
                        { label: 'Won', value: kpis.instructionsWon, color: 'bg-emerald-400' },
                        { label: 'Lost', value: kpis.instructionsLost, color: 'bg-red-400' },
                        { label: 'Passed', value: kpis.instructionsPassed, color: 'bg-white/30' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="flex-1">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-white/50">{label}</span>
                            <span className="text-white font-semibold">{value}</span>
                          </div>
                          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', color)}
                              style={{ width: `${kpis.totalInstructions > 0 ? (value / kpis.totalInstructions) * 100 : 0}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* ── Stock Gaps ── */}
          <TabsContent value="gaps">
            <Card className="bg-white/[0.03] border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-white/70">
                  Top Stock Gaps — ranked by monthly opportunity value
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        {['Vehicle', 'Year Band', 'Sold/30d', 'In Stock', 'Gap', 'Opp. Value/mo', 'Avg Gross', 'Days to Sell'].map((h) => (
                          <th key={h} className="text-left text-white/40 text-xs uppercase tracking-wider px-4 py-2 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stockGaps.map((gap, idx) => (
                        <tr key={idx} className="border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3">
                            <span className="text-white font-medium">{gap.make} {gap.model}</span>
                            {gap.trim && <span className="text-white/40 ml-1 text-xs">{gap.trim}</span>}
                          </td>
                          <td className="px-4 py-3 text-white/60">{gap.year_min}–{gap.year_max}</td>
                          <td className="px-4 py-3">
                            <span className={cn('font-semibold', gap.sold_30d >= 5 ? 'text-emerald-400' : 'text-white')}>{gap.sold_30d}</span>
                          </td>
                          <td className="px-4 py-3 text-white/60">{gap.in_stock}</td>
                          <td className="px-4 py-3">
                            <Badge className={cn('text-xs', gap.stock_gap >= 3 ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30')}>
                              {gap.stock_gap} needed
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-emerald-400 font-semibold">
                            {gap.monthly_opportunity_value ? `$${Math.round(gap.monthly_opportunity_value / 1000)}k` : '—'}
                          </td>
                          <td className="px-4 py-3 text-white/60">
                            {gap.avg_gross_profit ? `$${Math.round(gap.avg_gross_profit).toLocaleString()}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-white/60">
                            {gap.avg_days_to_sell ? `${Math.round(gap.avg_days_to_sell)}d` : '—'}
                          </td>
                        </tr>
                      ))}
                      {stockGaps.length === 0 && (
                        <tr><td colSpan={8} className="px-4 py-8 text-center text-white/30">No stock gaps identified. Run the engine to compute.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Team Performance ── */}
          <TabsContent value="team">
            <Card className="bg-white/[0.03] border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-white/70">Buyer Performance (30 days)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        {['Buyer', 'Won', 'Lost', 'Passed', 'Win Rate', 'Total Won Value', 'Avg Bid vs Target'].map((h) => (
                          <th key={h} className="text-left text-white/40 text-xs uppercase tracking-wider px-4 py-2 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {buyerPerformance.map((b) => (
                        <tr key={b.user_id} className="border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60">
                                {(b.display_name || 'U').charAt(0).toUpperCase()}
                              </div>
                              <span className="text-white font-medium">{b.display_name || 'Unknown'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-emerald-400 font-semibold">{b.won}</td>
                          <td className="px-4 py-3 text-red-400">{b.lost}</td>
                          <td className="px-4 py-3 text-white/40">{b.passed}</td>
                          <td className="px-4 py-3">
                            <span className={cn('font-semibold', b.winRate >= 40 ? 'text-emerald-400' : 'text-amber-400')}>{b.winRate}%</span>
                          </td>
                          <td className="px-4 py-3 text-white/70">
                            {b.totalWonValue > 0 ? `$${Math.round(b.totalWonValue / 1000)}k` : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('font-mono text-xs', b.avgBidVsTarget <= 0 ? 'text-emerald-400' : 'text-red-400')}>
                              {b.avgBidVsTarget >= 0 ? '+' : ''}{b.avgBidVsTarget.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                      {buyerPerformance.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-white/30">No buyer data yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Aged Stock ── */}
          <TabsContent value="aged">
            <Card className="bg-white/[0.03] border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-white/70">
                  Aged Stock — vehicles on lot 60+ days
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        {['Stock #', 'Vehicle', 'Year', 'Days on Lot', 'Asking Price'].map((h) => (
                          <th key={h} className="text-left text-white/40 text-xs uppercase tracking-wider px-4 py-2 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {agedStock.map((v, idx) => (
                        <tr key={idx} className="border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-white/40 font-mono text-xs">{v.stock_number}</td>
                          <td className="px-4 py-3">
                            <span className="text-white font-medium">{v.make} {v.model}</span>
                            {v.trim && <span className="text-white/40 ml-1 text-xs">{v.trim}</span>}
                          </td>
                          <td className="px-4 py-3 text-white/60">{v.year || '—'}</td>
                          <td className="px-4 py-3">
                            <Badge className={cn('text-xs', (v.days_on_lot || 0) >= 90 ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30')}>
                              {v.days_on_lot}d
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-white/60">
                            {v.asking_price ? `$${v.asking_price.toLocaleString()}` : '—'}
                          </td>
                        </tr>
                      ))}
                      {agedStock.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-white/30">No aged stock on file. Sync your inventory feed.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
