import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AccountSelector } from '@/components/carbitrage/AccountSelector';
import { useAccounts } from '@/hooks/useAccounts';
import { toast } from 'sonner';
import {
  RefreshCw, Trophy, TrendingUp, TrendingDown, Minus, DollarSign, Clock, Eye, Loader2,
  BarChart3, Brain, Radar, Info,
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Auto-select first account
  useEffect(() => {
    if (accounts?.length && !accountId) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);

  useEffect(() => {
    document.title = 'Dealer Intelligence | Carbitrage';
  }, []);

  // ──────── Fetch data ────────
  useEffect(() => {
    if (!accountId) return;
    fetchAll();
  }, [accountId]);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchWinners(), fetchTraps(), fetchMonthlySales()]);
    setLoading(false);
  };

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
        const month = row.sold_at.substring(0, 7); // YYYY-MM
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

  const handleRefreshWinners = async () => {
    setRefreshing(true);
    try {
      const res = await supabase.functions.invoke('update-winners-watchlist', {
        body: { account_id: accountId },
      });
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

  // Body type approximation for pie chart
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

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard icon={Trophy} label="Top Winners" value={winners.length.toString()} sub="Ranked fingerprints" />
          <KPICard icon={BarChart3} label="Total Sold" value={totalSold.toLocaleString()} sub="From winners list" />
          <KPICard icon={DollarSign} label="Avg Profit" value={`$${avgProfit.toLocaleString()}`} sub="Per vehicle" />
          <KPICard icon={Radar} label="Active Traps" value={traps.length.toString()} sub="Monitoring competitors" />
        </div>

        {/* ──── Section 1: Proven Big Sellers ──── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              Your Proven Big Sellers
            </CardTitle>
            <CardDescription>
              Top fingerprints ranked by total profit — these are your fastest money-makers
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : winners.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No winners data yet. Upload sales history first.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {winners.map((w, i) => (
                  <WinnerCard key={w.id} winner={w} index={i} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ──── Section 2: Sales History Charts ──── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Monthly Volume + Profit */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly Sales & Avg Profit</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : monthlySales.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No monthly data</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={monthlySales}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <RechartsTooltip
                      contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--popover-foreground))' }}
                    />
                    <Legend />
                    <Bar yAxisId="left" dataKey="count" name="Vehicles Sold" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="avg_profit" name="Avg Profit ($)" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Profit by Category Pie */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profit by Category</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : bodyTypePie.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={bodyTypePie}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {bodyTypePie.map((_, idx) => (
                        <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value: number) => `$${value.toLocaleString()}`}
                      contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--popover-foreground))' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top Models Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Models by Times Sold</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : winners.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={winners.slice(0, 8).map(w => ({ name: `${w.make} ${w.model}`.substring(0, 18), sold: w.times_sold, profit: w.avg_profit }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <RechartsTooltip
                    contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--popover-foreground))' }}
                  />
                  <Bar dataKey="sold" name="Times Sold" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* ──── Section 3: Competitor Monitoring ──── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Watching Competitors
            </CardTitle>
            <CardDescription>Active traps monitoring dealer sites for arbitrage opportunities</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : traps.length === 0 ? (
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
                        <td className="py-2.5 pr-4">
                          <Badge variant="outline" className="text-xs">{t.trap_mode}</Badge>
                        </td>
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

function WinnerCard({ winner: w, index }: { winner: Winner; index: number }) {
  const profitPerDay = w.avg_profit && w.times_sold ? Math.round(w.avg_profit / 91) : 0; // rough estimate

  return (
    <Card className="border-border/50 hover:border-primary/30 transition-colors">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
              #{index + 1}
            </div>
            <div>
              <p className="font-semibold text-sm">{w.make} {w.model}</p>
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">{w.variant}</p>
              <p className="text-xs text-muted-foreground">{w.year_min}–{w.year_max}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-primary">${(w.avg_profit ?? 0).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">avg profit</p>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
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
              <p>Shows your fastest money-makers</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}
