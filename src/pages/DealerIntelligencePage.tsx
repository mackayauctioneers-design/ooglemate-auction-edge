import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AccountSelector } from '@/components/carbitrage/AccountSelector';
import { useAccounts } from '@/hooks/useAccounts';
import { toast } from 'sonner';
import {
  RefreshCw, Trophy, TrendingUp, TrendingDown, Minus, DollarSign, Clock, Eye, Loader2,
  BarChart3, Brain, Radar, Info, AlertTriangle, Zap,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, LineChart, Line, Legend, PieChart, Pie, Cell,
} from 'recharts';

// ──────────────────────────── Types ────────────────────────────
interface Winner {
  id: string;
  make: string;
  model: string;
  variant: string;
  year_min: number;
  year_max: number;
  times_sold: number;
  avg_profit: number;
  total_profit: number;
  last_sale_date: string | null;
  rank: number;
}

interface TrapSummary {
  trap_slug: string;
  dealer_name: string;
  enabled: boolean;
  last_crawl_at: string | null;
  last_vehicle_count: number | null;
  trap_mode: string;
}

interface MonthlySale {
  month: string;
  count: number;
  avg_profit: number;
}

interface TrendData {
  make: string;
  model: string;
  recent_count: number;
  previous_count: number;
  recent_profit: number;
  previous_profit: number;
}

// ──────────────────────────── Constants ────────────────────────────
const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(142, 76%, 36%)',
  'hsl(262, 83%, 58%)',
  'hsl(24, 95%, 53%)',
];

// ──────────────────────────── Page ────────────────────────────
export default function DealerIntelligencePage() {
  const { data: accounts } = useAccounts();
  const [accountId, setAccountId] = useState<string>('');
  const [winners, setWinners] = useState<Winner[]>([]);
  const [traps, setTraps] = useState<TrapSummary[]>([]);
  const [monthlySales, setMonthlySales] = useState<MonthlySale[]>([]);
  const [trendMap, setTrendMap] = useState<Record<string, TrendData>>({});
  const [trapMatchCounts, setTrapMatchCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (accounts?.length && !accountId) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  useEffect(() => { document.title = 'Dealer Intelligence | Carbitrage'; }, []);

  useEffect(() => {
    if (!accountId) return;
    fetchAll();
  }, [accountId]);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchWinners(), fetchTraps(), fetchMonthlySales(), fetchTrends(), fetchTrapMatchCounts()]);
    setLoading(false);
  };

  // ──────── Data fetchers ────────

  const fetchWinners = async () => {
    const { data, error } = await supabase
      .from('winners_watchlist')
      .select('*')
      .eq('account_id', accountId)
      .order('rank', { ascending: true })
      .limit(10);
    if (!error && data) setWinners(data as Winner[]);
  };

  const fetchTraps = async () => {
    const { data, error } = await supabase
      .from('dealer_traps')
      .select('trap_slug, dealer_name, enabled, last_crawl_at, last_vehicle_count, trap_mode')
      .eq('enabled', true)
      .order('last_crawl_at', { ascending: false })
      .limit(15);
    if (!error && data) setTraps(data as TrapSummary[]);
  };

  const fetchMonthlySales = async () => {
    const { data, error } = await supabase
      .from('vehicle_sales_truth')
      .select('sold_at, sale_price, buy_price')
      .eq('account_id', accountId)
      .not('buy_price', 'is', null)
      .not('sale_price', 'is', null)
      .order('sold_at', { ascending: true });

    if (!error && data) {
      const byMonth: Record<string, { count: number; totalProfit: number }> = {};
      for (const row of data) {
        if (!row.sold_at) continue;
        const month = row.sold_at.substring(0, 7);
        if (!byMonth[month]) byMonth[month] = { count: 0, totalProfit: 0 };
        byMonth[month].count++;
        byMonth[month].totalProfit += (row.sale_price ?? 0) - Number(row.buy_price ?? 0);
      }
      setMonthlySales(
        Object.entries(byMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-12)
          .map(([month, v]) => ({
            month,
            count: v.count,
            avg_profit: v.count > 0 ? Math.round(v.totalProfit / v.count) : 0,
          })),
      );
    }
  };

  const fetchTrends = async () => {
    const now = new Date();
    const d90 = new Date(now.getTime() - 90 * 86400000).toISOString();
    const d180 = new Date(now.getTime() - 180 * 86400000).toISOString();

    const { data, error } = await supabase
      .from('vehicle_sales_truth')
      .select('make, model, sold_at, sale_price, buy_price')
      .eq('account_id', accountId)
      .gte('sold_at', d180)
      .not('buy_price', 'is', null)
      .not('sale_price', 'is', null);

    if (!error && data) {
      const map: Record<string, TrendData> = {};
      for (const row of data) {
        if (!row.sold_at || !row.make || !row.model) continue;
        const key = `${row.make}|${row.model}`;
        if (!map[key]) map[key] = { make: row.make, model: row.model, recent_count: 0, previous_count: 0, recent_profit: 0, previous_profit: 0 };
        const profit = (row.sale_price ?? 0) - Number(row.buy_price ?? 0);
        if (row.sold_at >= d90) {
          map[key].recent_count++;
          map[key].recent_profit += profit;
        } else {
          map[key].previous_count++;
          map[key].previous_profit += profit;
        }
      }
      setTrendMap(map);
    }
  };

  const fetchTrapMatchCounts = async () => {
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data, error } = await supabase
      .from('opportunities')
      .select('make, model')
      .eq('account_id', accountId)
      .eq('source_type', 'trap_match')
      .gte('created_at', d30);

    if (!error && data) {
      const counts: Record<string, number> = {};
      for (const row of data) {
        const key = `${row.make}|${row.model}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      setTrapMatchCounts(counts);
    }
  };

  const handleRefreshWinners = async () => {
    setRefreshing(true);
    try {
      const res = await supabase.functions.invoke('update-winners-watchlist', { body: { account_id: accountId } });
      if (res.error) throw res.error;
      toast.success('Watchlist refreshed');
      await fetchWinners();
    } catch {
      toast.error('Failed to refresh watchlist');
    } finally {
      setRefreshing(false);
    }
  };

  // ──────── Derived data ────────
  const totalProfit = winners.reduce((s, w) => s + (w.total_profit ?? 0), 0);
  const totalSold = winners.reduce((s, w) => s + (w.times_sold ?? 0), 0);
  const avgProfit = totalSold > 0 ? Math.round(totalProfit / totalSold) : 0;

  const bodyTypePie = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (const w of winners) {
      const model = w.model?.toUpperCase() ?? '';
      let type = 'Other';
      if (['RANGER', 'HILUX', 'BT-50', 'NAVARA', 'TRITON', 'AMAROK', 'D-MAX', 'COLORADO'].some(u => model.includes(u))) type = 'Utes';
      else if (['GRAND CHEROKEE', 'X-TRAIL', 'RAV4', 'OUTLANDER', 'SPORTAGE', 'TUCSON', 'CX-5', 'FORESTER'].some(u => model.includes(u))) type = 'SUVs';
      else if (['COROLLA', 'CAMRY', 'CIVIC', 'MAZDA3', 'MAZDA6', 'i30'].some(u => model.includes(u))) type = 'Sedans';
      buckets[type] = (buckets[type] ?? 0) + (w.total_profit ?? 0);
    }
    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  }, [winners]);

  // Supply gap: top winners with < 5 trap matches in 30 days
  const supplyGaps = useMemo(() => {
    return winners.slice(0, 5).filter(w => {
      const key = `${w.make}|${w.model}`;
      return (trapMatchCounts[key] ?? 0) < 5;
    });
  }, [winners, trapMatchCounts]);

  // Forecast: project next 3 months from monthly trend
  const forecast = useMemo(() => {
    if (monthlySales.length < 3) return [];
    const last3 = monthlySales.slice(-3);
    const avgCount = last3.reduce((s, m) => s + m.count, 0) / 3;
    const avgProfitTrend = last3.reduce((s, m) => s + m.avg_profit, 0) / 3;
    // Simple linear: use last3 slope
    const countSlope = last3.length >= 2 ? (last3[last3.length - 1].count - last3[0].count) / 2 : 0;

    return [1, 2, 3].map(i => {
      const projected = Math.max(0, Math.round(avgCount + countSlope * i));
      const lastMonth = last3[last3.length - 1].month;
      const [y, m] = lastMonth.split('-').map(Number);
      const nm = m + i > 12 ? m + i - 12 : m + i;
      const ny = m + i > 12 ? y + 1 : y;
      return {
        month: `${ny}-${String(nm).padStart(2, '0')}`,
        projected,
        avg_profit: Math.round(avgProfitTrend),
      };
    });
  }, [monthlySales]);

  // ──────── Render ────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              Dealer Intelligence
            </h1>
            <p className="text-muted-foreground">Your proven sellers, sales patterns & competitor monitoring</p>
          </div>
          <div className="flex items-center gap-3">
            <AccountSelector value={accountId} onChange={setAccountId} />
            <Button variant="outline" size="sm" onClick={handleRefreshWinners} disabled={refreshing}>
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Supply Gap Alert */}
        {!loading && supplyGaps.length > 0 && (
          <Alert className="border-chart-4/50 bg-chart-4/5">
            <AlertTriangle className="h-4 w-4 text-chart-4" />
            <AlertTitle className="text-chart-4 font-semibold">Supply Gap on Top Sellers</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              {supplyGaps.map(w => `${w.make} ${w.model}`).join(', ')} — fewer than 5 trap matches in 30 days.
              <span className="font-medium text-foreground ml-1">Expand traps or hunt wider.</span>
            </AlertDescription>
          </Alert>
        )}

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard icon={Trophy} label="Top Winners" value={winners.length.toString()} sub="Ranked fingerprints" />
          <KPICard icon={BarChart3} label="Total Sold" value={totalSold.toLocaleString()} sub="From winners list" />
          <KPICard icon={DollarSign} label="Avg Profit" value={`$${avgProfit.toLocaleString()}`} sub="Per vehicle" />
          <KPICard icon={Radar} label="Active Traps" value={traps.length.toString()} sub="Monitoring competitors" />
        </div>

        {/* ──── Proven Big Sellers ──── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              Your Proven Big Sellers
            </CardTitle>
            <CardDescription>Top fingerprints ranked by total profit — with 90-day trend indicators</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
            ) : winners.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No winners data yet. Upload sales history first.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {winners.map((w, i) => (
                  <WinnerCard key={w.id} winner={w} index={i} trend={trendMap[`${w.make}|${w.model}`]} trapMatches={trapMatchCounts[`${w.make}|${w.model}`] ?? 0} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ──── Big Sellers Forecast ──── */}
        {!loading && forecast.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-5 w-5 text-chart-2" />
                Big Sellers Forecast — Next 3 Months
              </CardTitle>
              <CardDescription>Simple projection based on your last 3 months of sales velocity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                {forecast.map(f => (
                  <div key={f.month} className="rounded-lg border border-border/50 p-4 text-center">
                    <p className="text-xs text-muted-foreground font-mono">{f.month}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{f.projected}</p>
                    <p className="text-xs text-muted-foreground">projected sales</p>
                    <p className="text-sm font-semibold text-primary mt-2">${f.avg_profit.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">avg profit trend</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ──── Charts ──── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Monthly Sales & Avg Profit</CardTitle></CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-64 w-full" /> : monthlySales.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No monthly data</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={monthlySales}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <RechartsTooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--popover-foreground))' }} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="count" name="Vehicles Sold" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="avg_profit" name="Avg Profit ($)" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Profit by Category</CardTitle></CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-64 w-full" /> : bodyTypePie.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={bodyTypePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {bodyTypePie.map((_, idx) => <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}
                    </Pie>
                    <RechartsTooltip formatter={(value: number) => `$${value.toLocaleString()}`}
                      contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--popover-foreground))' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top Models Bar */}
        <Card>
          <CardHeader><CardTitle className="text-base">Top Models by Times Sold</CardTitle></CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-64 w-full" /> : winners.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={winners.slice(0, 8).map(w => ({ name: `${w.make} ${w.model}`.substring(0, 18), sold: w.times_sold, profit: w.avg_profit }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <RechartsTooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--popover-foreground))' }} />
                  <Bar dataKey="sold" name="Times Sold" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* ──── Competitor Monitoring ──── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Watching Competitors
            </CardTitle>
            <CardDescription>Active traps monitoring dealer sites for arbitrage opportunities</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-40 w-full" /> : traps.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No active traps. Add competitor sites from the Traps Registry.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b">
                    <tr>
                      <th className="text-left py-2 pr-4">Dealer</th>
                      <th className="text-left py-2 pr-4">Mode</th>
                      <th className="text-left py-2 pr-4">Vehicles Found</th>
                      <th className="text-left py-2">Last Crawl</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traps.map(t => (
                      <tr key={t.trap_slug} className="border-b last:border-b-0">
                        <td className="py-2.5 pr-4 font-medium">{t.dealer_name}</td>
                        <td className="py-2.5 pr-4"><Badge variant="outline" className="text-xs">{t.trap_mode}</Badge></td>
                        <td className="py-2.5 pr-4 font-mono">{t.last_vehicle_count ?? '—'}</td>
                        <td className="py-2.5 text-muted-foreground">
                          {t.last_crawl_at ? new Date(t.last_crawl_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
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
    </AppLayout>
  );
}

// ──────────────────────────── Sub-components ────────────────────────────

function KPICard({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TrendArrow({ recent, previous }: { recent: number; previous: number }) {
  if (previous === 0 && recent === 0) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  if (previous === 0) return <TrendingUp className="h-3.5 w-3.5 text-chart-2" />;
  const pct = Math.round(((recent - previous) / previous) * 100);
  if (pct > 5) return (
    <span className="flex items-center gap-0.5 text-chart-2 text-xs font-semibold">
      <TrendingUp className="h-3.5 w-3.5" /> +{pct}%
    </span>
  );
  if (pct < -5) return (
    <span className="flex items-center gap-0.5 text-destructive text-xs font-semibold">
      <TrendingDown className="h-3.5 w-3.5" /> {pct}%
    </span>
  );
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function WinnerCard({ winner: w, index, trend, trapMatches }: { winner: Winner; index: number; trend?: TrendData; trapMatches: number }) {
  const profitPerDay = w.avg_profit && w.times_sold ? Math.round(w.avg_profit / 91) : 0;

  return (
    <Card className="border-border/50 hover:border-primary/30 transition-colors">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
              #{index + 1}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">{w.make} {w.model}</p>
                {trend && <TrendArrow recent={trend.recent_count} previous={trend.previous_count} />}
              </div>
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">{w.variant}</p>
              <p className="text-xs text-muted-foreground">{w.year_min}–{w.year_max}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-primary">${(w.avg_profit ?? 0).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">avg profit</p>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <BarChart3 className="h-3 w-3" />
            {w.times_sold}× sold
          </span>
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            ${(w.total_profit ?? 0).toLocaleString()} total
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 cursor-help">
                <Clock className="h-3 w-3" />
                ~${profitPerDay}/day
                <Info className="h-3 w-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Profit per day = avg profit ÷ avg days in stock</p>
            </TooltipContent>
          </Tooltip>
          <span className="flex items-center gap-1">
            <Radar className="h-3 w-3" />
            {trapMatches} matches (30d)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
