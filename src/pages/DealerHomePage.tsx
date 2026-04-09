import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { DealerLayout } from "@/components/layout/DealerLayout";
import { useDealerDashboard, DealerOpp, RecentActivity } from "@/hooks/useDealerDashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Target, Crosshair, FileText, CheckCircle2, Car, Bot,
  ArrowRight, ExternalLink, Loader2, Activity, Clock,
  TrendingUp, BarChart3, Sparkles, RefreshCw, Zap, Radio
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function fmt$(n: number | null) {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-AU", { maximumFractionDigits: 0 });
}

function fmtKm(n: number | null) {
  if (n == null) return "—";
  return Math.round(n / 1000) + "k km";
}

function ScoreBadge({ score }: { score: number }) {
  if (score >= 85)
    return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">🔥 {score}</Badge>;
  if (score >= 70)
    return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">✔ {score}</Badge>;
  return <Badge variant="secondary" className="text-xs">{score}</Badge>;
}

// Heat bar — visual "alive" indicator showing match distribution
function HeatBar({ opportunities }: { opportunities: DealerOpp[] }) {
  const hot = opportunities.filter(o => o.match_score >= 85).length;
  const warm = opportunities.filter(o => o.match_score >= 70 && o.match_score < 85).length;
  const cool = opportunities.filter(o => o.match_score < 70).length;
  const total = opportunities.length || 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
          Match Heat
        </span>
        <span>{opportunities.length} active</span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
        {hot > 0 && (
          <div
            className="bg-emerald-500 transition-all duration-700"
            style={{ width: `${(hot / total) * 100}%` }}
          />
        )}
        {warm > 0 && (
          <div
            className="bg-amber-500 transition-all duration-700"
            style={{ width: `${(warm / total) * 100}%` }}
          />
        )}
        {cool > 0 && (
          <div
            className="bg-muted-foreground/30 transition-all duration-700"
            style={{ width: `${(cool / total) * 100}%` }}
          />
        )}
      </div>
      <div className="flex gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> {hot} hot</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> {warm} warm</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground/30 inline-block" /> {cool} cool</span>
      </div>
    </div>
  );
}

// Live ticker strip
function LiveTicker({ opportunities }: { opportunities: DealerOpp[] }) {
  if (opportunities.length === 0) return null;
  const recent = opportunities.slice(0, 5);

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-xs font-medium text-muted-foreground">Latest Matches</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {recent.map((opp) => (
          <div
            key={opp.id}
            className="flex-shrink-0 px-3 py-1.5 rounded-md bg-muted/50 border border-border text-xs flex items-center gap-2"
          >
            <ScoreBadge score={opp.match_score} />
            <span className="text-foreground font-medium whitespace-nowrap">
              {opp.year} {opp.make} {opp.model}
            </span>
            <span className="text-muted-foreground">{fmt$(opp.asking_price)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DealerHomePage() {
  const { currentUser, dealerProfile } = useAuth();
  const { pulse, opportunities, activity, loading, refetch } = useDealerDashboard();
  const isNewDealer = !dealerProfile;

  return (
    <DealerLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {currentUser?.dealer_name || "Dashboard"}
            </h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
              <Activity className="h-3.5 w-3.5" />
              {pulse.lastScanAt ? (
                <>
                  Last scan {formatDistanceToNow(new Date(pulse.lastScanAt), { addSuffix: true })}
                  <span className={`flex items-center gap-1 ${pulse.lastScanOk ? "text-emerald-400" : "text-destructive"}`}>
                    <span className="relative flex h-1.5 w-1.5">
                      {pulse.lastScanOk && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                      <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${pulse.lastScanOk ? "bg-emerald-500" : "bg-destructive"}`} />
                    </span>
                    {pulse.lastScanOk ? "Live" : "Issue"}
                  </span>
                </>
              ) : (
                "Scanning market..."
              )}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* ── New dealer banner ── */}
        {isNewDealer && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Welcome — here's what's moving on the market right now</p>
              <p className="text-xs text-muted-foreground mt-0.5">Complete your profile to get matches tailored to your dealership.</p>
            </div>
            <Link to="/onboarding/win-flow">
              <Button size="sm" variant="default">Get Started</Button>
            </Link>
          </div>
        )}

        {/* ── Live Ticker ── */}
        <LiveTicker opportunities={opportunities} />

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard icon={<Crosshair className="h-4 w-4" />} label="Active Hunts" value={pulse.activeHunts} to="/my-hunts" />
          <KPICard icon={<Target className="h-4 w-4" />} label="Open Matches" value={pulse.openOpportunities} to="/today" highlight={pulse.openOpportunities > 0} />
          <KPICard icon={<FileText className="h-4 w-4" />} label="Deals In Progress" value={pulse.dealsInProgress} />
          <KPICard icon={<CheckCircle2 className="h-4 w-4" />} label="Closed (30d)" value={pulse.closedDeals30d} />
        </div>

        {/* ── Main Content ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Opportunity Blotter */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Live Opportunities
              </h2>
              <Link to="/today">
                <Button variant="ghost" size="sm" className="text-xs">
                  View All <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </Link>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : opportunities.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Target className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground font-medium">No live opportunities right now</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your hunts are scanning. Matches appear here automatically.
                  </p>
                  <Link to="/my-hunts" className="mt-4 inline-block">
                    <Button variant="outline" size="sm">
                      <Crosshair className="mr-1.5 h-3.5 w-3.5" /> Set Up Hunts
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {opportunities.slice(0, 8).map((opp) => (
                  <OpportunityRow key={opp.id} opp={opp} />
                ))}
                {opportunities.length > 8 && (
                  <Link to="/today" className="block">
                    <p className="text-sm text-primary hover:underline text-center py-2">
                      +{opportunities.length - 8} more →
                    </p>
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {/* Heat Map */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  Market Heat
                </CardTitle>
              </CardHeader>
              <CardContent>
                <HeatBar opportunities={opportunities} />
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {[
                  { to: "/find-cars", label: "Find Cars", icon: Car },
                  { to: "/valo", label: "Do A Valo", icon: Sparkles },
                  { to: "/sales-upload", label: "Upload Sales", icon: BarChart3 },
                  { to: "/ooglebot", label: "Ask OogleBot", icon: Bot },
                ].map((l) => (
                  <Link key={l.to} to={l.to}>
                    <Button variant="ghost" size="sm" className="w-full justify-start text-sm">
                      <l.icon className="h-3.5 w-3.5 mr-2" />
                      {l.label}
                    </Button>
                  </Link>
                ))}
              </CardContent>
            </Card>

            {/* Activity Feed */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {activity.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No recent activity</p>
                ) : (
                  <div className="space-y-3">
                    {activity.map((item) => (
                      <ActivityItem key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DealerLayout>
  );
}

// ── Sub-components ──

function KPICard({ icon, label, value, to, highlight }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  to?: string;
  highlight?: boolean;
}) {
  const inner = (
    <Card className={`transition-all ${highlight ? "border-primary/50 bg-primary/5" : ""} ${to ? "hover:border-foreground/20 cursor-pointer" : ""}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
        {highlight && value > 0 && (
          <span className="relative flex h-2 w-2 ml-auto">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
        )}
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function OpportunityRow({ opp }: { opp: DealerOpp }) {
  const age = formatDistanceToNow(new Date(opp.created_at), { addSuffix: true });
  const tierColor = opp.match_score >= 85
    ? "border-l-emerald-500"
    : opp.match_score >= 70
      ? "border-l-amber-500"
      : "border-l-muted-foreground/30";

  return (
    <Card className={`hover:border-foreground/20 transition-all border-l-[3px] ${tierColor}`}>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-foreground text-sm truncate">
              {opp.year} {opp.make} {opp.model}
            </p>
            <ScoreBadge score={opp.match_score} />
            {opp.dealer_action === "interested" && (
              <Badge variant="outline" className="text-xs border-primary/40 text-primary">Interested</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span>{fmt$(opp.asking_price)}</span>
            <span>{fmtKm(opp.km)}</span>
            {opp.source_searched && <span className="capitalize">{opp.source_searched}</span>}
            <span>{age}</span>
          </div>
        </div>
        {opp.url_canonical && (
          <a href={opp.url_canonical} target="_blank" rel="noopener noreferrer" className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityItem({ item }: { item: RecentActivity }) {
  const age = formatDistanceToNow(new Date(item.timestamp), { addSuffix: true });
  const typeIcon = item.type === "opportunity" ? "🎯" : item.type === "deal" ? "📋" : "🔔";

  return (
    <div className="flex items-start gap-2">
      <span className="text-sm mt-0.5">{typeIcon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{item.title}</p>
        <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{age}</span>
    </div>
  );
}
