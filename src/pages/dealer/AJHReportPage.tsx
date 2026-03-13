import { useState } from "react";
import { AJH_REPORT } from "@/data/ajhReportData";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line, Area, AreaChart, Legend 
} from "recharts";
import { 
  TrendingUp, TrendingDown, DollarSign, Clock, Award, AlertTriangle, 
  Zap, BarChart3, Target, ArrowLeft, ChevronDown, ChevronUp 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);

const fmtK = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return fmt(n);
};

const COLORS = [
  "hsl(0, 0%, 9%)", "hsl(0, 0%, 25%)", "hsl(0, 0%, 40%)", 
  "hsl(0, 0%, 55%)", "hsl(0, 0%, 70%)", "hsl(0, 0%, 85%)"
];

const GREEN = "hsl(142, 71%, 45%)";
const RED = "hsl(0, 84%, 60%)";
const AMBER = "hsl(38, 92%, 50%)";

type TabId = "overview" | "makes" | "winners" | "losers" | "velocity";

export default function AJHReportPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { summary, makeBreakdown, topProfitModels, worstModels, fastestMovers, slowestMovers, monthlyTrend, profitDistribution, daysDistribution } = AJH_REPORT;

  const TABS: { id: TabId; label: string; icon: typeof BarChart3 }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "makes", label: "By Make", icon: Target },
    { id: "winners", label: "Winners", icon: Award },
    { id: "losers", label: "Avoid List", icon: AlertTriangle },
    { id: "velocity", label: "Velocity", icon: Zap },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button
              size="sm"
              className="ml-auto gap-2 bg-green-600 hover:bg-green-700 text-white"
              onClick={() => navigate('/dealer/opportunities/ajh')}
            >
              <Target className="h-4 w-4" /> View Opportunity Feed
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
            AJH Auto Traders — Intelligence Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {summary.totalSales} vehicles analyzed · {summary.dateRange}
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPICard label="Total Sales" value={String(summary.totalSales)} icon={<BarChart3 className="h-4 w-4" />} />
          <KPICard label="Revenue" value={fmtK(summary.totalRevenue)} icon={<DollarSign className="h-4 w-4" />} />
          <KPICard label="Total Profit" value={fmtK(summary.totalProfit)} icon={<TrendingUp className="h-4 w-4" />} accent="green" />
          <KPICard label="Avg Profit" value={fmt(summary.avgProfit)} icon={<TrendingUp className="h-4 w-4" />} accent="green" />
          <KPICard label="Win Rate" value={`${summary.winRate}%`} icon={<Award className="h-4 w-4" />} accent="green" />
          <KPICard label="Avg Days" value={`${summary.avgDays}d`} icon={<Clock className="h-4 w-4" />} />
        </div>

        {/* Secondary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Best Single Deal</p>
            <p className="text-xl font-bold text-foreground mt-1" style={{ color: GREEN }}>{fmt(summary.bestSingleDeal)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Worst Single Deal</p>
            <p className="text-xl font-bold mt-1" style={{ color: RED }}>{fmt(summary.worstSingleDeal)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Median Profit</p>
            <p className="text-xl font-bold text-foreground mt-1">{fmt(summary.medianProfit)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Loss-Making</p>
            <p className="text-xl font-bold mt-1" style={{ color: RED }}>{summary.lossCount} <span className="text-sm font-normal text-muted-foreground">({Math.round(100 * summary.lossCount / summary.totalSales)}%)</span></p>
          </div>
        </div>

        {/* Monthly Trend Chart */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Monthly Performance
            </h3>
          </div>
          <div className="p-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={[...monthlyTrend]}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
                <XAxis 
                  dataKey="month" 
                  tick={{ fontSize: 11, fill: "hsl(0, 0%, 45%)" }}
                  tickFormatter={(v) => {
                    const [y, m] = v.split("-");
                    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m)-1]} ${y.slice(2)}`;
                  }}
                />
                <YAxis tick={{ fontSize: 11, fill: "hsl(0, 0%, 45%)" }} tickFormatter={(v) => fmtK(v)} />
                <Tooltip 
                  formatter={(value: number, name: string) => [fmt(value), name === "profit" ? "Profit" : name === "revenue" ? "Revenue" : "Count"]}
                  labelFormatter={(label) => {
                    const [y, m] = label.split("-");
                    return `${["January","February","March","April","May","June","July","August","September","October","November","December"][parseInt(m)-1]} ${y}`;
                  }}
                />
                <Legend />
                <Area type="monotone" dataKey="profit" stroke={GREEN} fill={GREEN} fillOpacity={0.15} name="Profit" />
                <Area type="monotone" dataKey="revenue" stroke="hsl(0, 0%, 25%)" fill="hsl(0, 0%, 25%)" fillOpacity={0.05} name="Revenue" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Two-column: Profit Distribution + Days Distribution */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-foreground text-sm">Profit Distribution</h3>
            </div>
            <div className="p-4 h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[...profitDistribution]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
                  <XAxis dataKey="range" tick={{ fontSize: 10, fill: "hsl(0, 0%, 45%)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(0, 0%, 45%)" }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {profitDistribution.map((entry, i) => (
                      <Cell key={i} fill={i < 2 ? RED : i === 2 ? AMBER : GREEN} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-foreground text-sm">Days to Sell Distribution</h3>
            </div>
            <div className="p-4 h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[...daysDistribution]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
                  <XAxis dataKey="range" tick={{ fontSize: 10, fill: "hsl(0, 0%, 45%)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(0, 0%, 45%)" }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(0, 0%, 20%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex rounded-lg border border-border bg-muted/30 p-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-md text-sm font-medium transition-all whitespace-nowrap",
                  activeTab === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "makes" && <MakesTab />}
        {activeTab === "winners" && <WinnersTab />}
        {activeTab === "losers" && <LosersTab />}
        {activeTab === "velocity" && <VelocityTab />}
      </div>
    </div>
  );
}

function OverviewTab() {
  const { makeBreakdown, monthlyTrend } = AJH_REPORT;
  const topMakes = makeBreakdown.slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Make Breakdown Chart */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">Volume by Make (Top 10)</h3>
        </div>
        <div className="p-4 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topMakes} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(0, 0%, 45%)" }} />
              <YAxis dataKey="make" type="category" width={100} tick={{ fontSize: 11, fill: "hsl(0, 0%, 30%)" }} />
              <Tooltip formatter={(v: number) => [v, "Units Sold"]} />
              <Bar dataKey="count" fill="hsl(0, 0%, 15%)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Make Profitability Chart */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">Average Profit by Make</h3>
        </div>
        <div className="p-4 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topMakes} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(0, 0%, 45%)" }} tickFormatter={(v) => fmt(v)} />
              <YAxis dataKey="make" type="category" width={100} tick={{ fontSize: 11, fill: "hsl(0, 0%, 30%)" }} />
              <Tooltip formatter={(v: number) => [fmt(v), "Avg Profit"]} />
              <Bar dataKey="avgProfit" radius={[0, 4, 4, 0]}>
                {topMakes.map((entry, i) => (
                  <Cell key={i} fill={entry.avgProfit >= 0 ? GREEN : RED} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Monthly Units Sold */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">Monthly Units Sold</h3>
        </div>
        <div className="p-4 h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[...monthlyTrend]}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 10, fill: "hsl(0, 0%, 45%)" }}
                tickFormatter={(v) => {
                  const m = parseInt(v.split("-")[1]);
                  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1];
                }}
              />
              <YAxis tick={{ fontSize: 11, fill: "hsl(0, 0%, 45%)" }} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(0, 0%, 20%)" radius={[4, 4, 0, 0]} name="Units" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function MakesTab() {
  const { makeBreakdown } = AJH_REPORT;
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{makeBreakdown.length} makes traded</p>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Make</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Units</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Revenue</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Total Profit</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Avg Profit</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Win Rate</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Avg Days</th>
            </tr>
          </thead>
          <tbody>
            {makeBreakdown.map((m) => (
              <tr key={m.make} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-4 py-3 font-semibold text-foreground">{m.make}</td>
                <td className="px-3 py-3 text-right text-foreground">{m.count}</td>
                <td className="px-3 py-3 text-right text-muted-foreground">{fmtK(m.totalRevenue)}</td>
                <td className="px-3 py-3 text-right font-medium" style={{ color: m.totalProfit >= 0 ? GREEN : RED }}>{fmt(m.totalProfit)}</td>
                <td className="px-3 py-3 text-right font-semibold" style={{ color: m.avgProfit >= 0 ? GREEN : RED }}>{fmt(m.avgProfit)}</td>
                <td className="px-3 py-3 text-right">
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                    m.winRate >= 90 ? "bg-green-100 text-green-800" :
                    m.winRate >= 75 ? "bg-yellow-100 text-yellow-800" :
                    "bg-red-100 text-red-800"
                  )}>{m.winRate}%</span>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground">{m.avgDays}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Win Rate Chart */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground text-sm">Win Rate by Make (Top 15)</h3>
        </div>
        <div className="p-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={makeBreakdown.slice(0, 15)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <YAxis dataKey="make" type="category" width={110} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v}%`, "Win Rate"]} />
              <Bar dataKey="winRate" radius={[0, 4, 4, 0]}>
                {makeBreakdown.slice(0, 15).map((m, i) => (
                  <Cell key={i} fill={m.winRate >= 90 ? GREEN : m.winRate >= 75 ? AMBER : RED} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function WinnersTab() {
  const { topProfitModels } = AJH_REPORT;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-2 border-border bg-card overflow-hidden" style={{ borderColor: GREEN }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: GREEN, backgroundColor: `${GREEN}10` }}>
          <Award className="h-5 w-5" style={{ color: GREEN }} />
          <h3 className="font-bold text-foreground">Top Profit Models</h3>
          <span className="text-xs text-muted-foreground ml-auto">Min 2 units sold</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
              <th className="text-left px-3 py-3 font-medium text-muted-foreground">Vehicle</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Avg Profit</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Total Profit</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Units</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Win Rate</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Avg Days</th>
            </tr>
          </thead>
          <tbody>
            {topProfitModels.map((v, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-4 py-3 font-bold text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-3 font-semibold text-foreground">{v.make} {v.model}</td>
                <td className="px-3 py-3 text-right font-bold text-lg" style={{ color: GREEN }}>{fmt(v.avgProfit)}</td>
                <td className="px-3 py-3 text-right font-medium" style={{ color: GREEN }}>{fmt(v.totalProfit)}</td>
                <td className="px-3 py-3 text-right text-foreground">{v.count}</td>
                <td className="px-3 py-3 text-right">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">{v.winRate}%</span>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground">{v.avgDays}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Chart */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground text-sm">Top Models — Avg Profit</h3>
        </div>
        <div className="p-4 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[...topProfitModels].slice(0, 10)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
              <YAxis dataKey={(d) => `${d.make} ${d.model}`} type="category" width={140} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [fmt(v), "Avg Profit"]} />
              <Bar dataKey="avgProfit" fill={GREEN} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function LosersTab() {
  const { worstModels } = AJH_REPORT;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-2 overflow-hidden" style={{ borderColor: RED }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: RED, backgroundColor: `${RED}10` }}>
          <AlertTriangle className="h-5 w-5" style={{ color: RED }} />
          <h3 className="font-bold text-foreground">Vehicles to Avoid</h3>
          <span className="text-xs text-muted-foreground ml-auto">Worst average profit per unit</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
              <th className="text-left px-3 py-3 font-medium text-muted-foreground">Vehicle</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Avg Profit</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Total Loss</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Units</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Win Rate</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Avg Days</th>
            </tr>
          </thead>
          <tbody>
            {worstModels.map((v, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-4 py-3 font-bold text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-3 font-semibold text-foreground">{v.make} {v.model}</td>
                <td className="px-3 py-3 text-right font-bold text-lg" style={{ color: v.avgProfit < 0 ? RED : GREEN }}>{fmt(v.avgProfit)}</td>
                <td className="px-3 py-3 text-right font-medium" style={{ color: v.totalProfit < 0 ? RED : GREEN }}>{fmt(v.totalProfit)}</td>
                <td className="px-3 py-3 text-right text-foreground">{v.count}</td>
                <td className="px-3 py-3 text-right">
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                    v.winRate < 50 ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"
                  )}>{v.winRate}%</span>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground">{v.avgDays}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Chart */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground text-sm">Worst Models — Avg Profit</h3>
        </div>
        <div className="p-4 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[...worstModels].slice(0, 10)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
              <YAxis dataKey={(d) => `${d.make} ${d.model}`} type="category" width={140} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [fmt(v), "Avg Profit"]} />
              <Bar dataKey="avgProfit" radius={[0, 4, 4, 0]}>
                {worstModels.slice(0, 10).map((m, i) => (
                  <Cell key={i} fill={m.avgProfit < 0 ? RED : GREEN} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function VelocityTab() {
  const { fastestMovers, slowestMovers } = AJH_REPORT;

  return (
    <div className="space-y-6">
      {/* Fastest Movers */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Zap className="h-5 w-5" style={{ color: GREEN }} />
          <h3 className="font-bold text-foreground">Fastest Movers</h3>
          <span className="text-xs text-muted-foreground ml-auto">Lowest avg days on lot</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vehicle</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Avg Days</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Avg Profit</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Units</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Win Rate</th>
            </tr>
          </thead>
          <tbody>
            {fastestMovers.map((v, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-3 font-semibold text-foreground">{v.make} {v.model}</td>
                <td className="px-3 py-3 text-right font-bold text-lg" style={{ color: GREEN }}>{v.avgDays}d</td>
                <td className="px-3 py-3 text-right font-medium" style={{ color: v.avgProfit >= 0 ? GREEN : RED }}>{fmt(v.avgProfit)}</td>
                <td className="px-3 py-3 text-right text-foreground">{v.count}</td>
                <td className="px-3 py-3 text-right"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">{v.winRate}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Slowest Movers (Capital Traps) */}
      <div className="rounded-lg border-2 overflow-hidden" style={{ borderColor: AMBER }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: AMBER, backgroundColor: `${AMBER}10` }}>
          <Clock className="h-5 w-5" style={{ color: AMBER }} />
          <h3 className="font-bold text-foreground">Capital Traps</h3>
          <span className="text-xs text-muted-foreground ml-auto">Longest avg days on lot</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vehicle</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Avg Days</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Avg Profit</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Units</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {slowestMovers.map((v, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-3 font-semibold text-foreground">{v.make} {v.model}</td>
                <td className="px-3 py-3 text-right font-bold text-lg" style={{ color: RED }}>{v.avgDays}d</td>
                <td className="px-3 py-3 text-right font-medium" style={{ color: v.avgProfit >= 0 ? GREEN : RED }}>{fmt(v.avgProfit)}</td>
                <td className="px-3 py-3 text-right text-foreground">{v.count}</td>
                <td className="px-3 py-3 text-right text-muted-foreground">{fmtK(v.totalRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Velocity vs Profit scatter (simulated as bar chart) */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground text-sm">Days to Sell Comparison</h3>
        </div>
        <div className="p-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[...slowestMovers].reverse()}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 90%)" />
              <XAxis dataKey={(d) => `${d.make} ${d.model}`} tick={{ fontSize: 9, fill: "hsl(0, 0%, 45%)" }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} label={{ value: "Days", angle: -90, position: "insideLeft" }} />
              <Tooltip formatter={(v: number) => [`${v} days`, "Avg Days"]} />
              <Bar dataKey="avgDays" fill={RED} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: "green" | "red" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={cn(
        "text-xl font-bold",
        accent === "green" ? "" : accent === "red" ? "" : "text-foreground"
      )} style={accent === "green" ? { color: GREEN } : accent === "red" ? { color: RED } : undefined}>
        {value}
      </p>
    </div>
  );
}
