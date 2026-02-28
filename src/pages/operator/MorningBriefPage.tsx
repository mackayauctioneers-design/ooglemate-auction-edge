import { useEffect, useState, useCallback } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { KitingIndicator } from '@/components/kiting/KitingIndicator';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BriefItem {
  id: string;
  listing_id: string;
  brief_date: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  variant: string | null;
  fuel: string | null;
  transmission: string | null;
  drivetrain: string | null;
  asking_price: number | null;
  guide_price: number | null;
  reserve_price: number | null;
  buy_method: string | null;
  sale_close_at: string | null;
  sale_status: string | null;
  reserve_status: string | null;
  source: string | null;
  location: string | null;
  state: string | null;
  listing_url: string | null;
  auction_house: string | null;
  wovr_indicator: boolean | null;
  damage_noted: boolean | null;
  condition_notes: string[] | null;
  keys_present: boolean | null;
  starts_drives: boolean | null;
  tier: string | null;
  expected_margin: number | null;
  under_buy: number | null;
  retail_median: number | null;
  retail_median_confidence: string | null;
  guide_vs_median_gap: number | null;
  auction_target_price: number | null;
  motivation_signal: string | null;
  margin_flag: string | null;
  matched_spec_names: string[];
  composite_score: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(v: number | null | undefined): string {
  if (!v) return '—';
  return `$${(v / 1000).toFixed(1)}k`;
}

function formatKm(v: number | null | undefined): string {
  if (!v) return '—';
  return `${(v / 1000).toFixed(0)}k km`;
}

function formatCloseTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffH = (d.getTime() - now.getTime()) / 3600000;
  if (diffH < 0) return 'Closed';
  if (diffH < 1) return `${Math.round(diffH * 60)}m`;
  if (diffH < 24) return `${diffH.toFixed(1)}h`;
  return d.toLocaleDateString('en-AU', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney' });
}

function tierColor(tier: string | null): string {
  switch (tier) {
    case 'CODE_RED': return 'bg-red-500 text-white';
    case 'HIGH': return 'bg-orange-500 text-white';
    case 'BUY': return 'bg-green-600 text-white';
    case 'RETAIL_BUY': return 'bg-teal-600 text-white';
    case 'AUCTION_WATCH': return 'bg-blue-500 text-white';
    case 'WATCH': return 'bg-muted text-muted-foreground';
    default: return 'bg-muted text-muted-foreground';
  }
}

function tierLabel(tier: string | null): string {
  switch (tier) {
    case 'CODE_RED': return '🔴 CODE RED';
    case 'HIGH': return '🟠 HIGH';
    case 'BUY': return '🟢 BUY';
    case 'RETAIL_BUY': return '🟢 RETAIL BUY';
    case 'AUCTION_WATCH': return '🔵 WATCH';
    case 'WATCH': return 'WATCH';
    default: return '—';
  }
}

// ─── Summary strip ────────────────────────────────────────────────────────────

function BriefSummary({ items }: { items: BriefItem[] }) {
  const codeRed = items.filter(i => i.tier === 'CODE_RED').length;
  const high = items.filter(i => i.tier === 'HIGH').length;
  const specMatched = items.filter(i => i.matched_spec_names?.length > 0).length;
  const noReserve = items.filter(i => i.reserve_status === 'no_reserve').length;
  const wovr = items.filter(i => i.wovr_indicator).length;
  const totalMargin = items.reduce((s, i) => s + (i.expected_margin ?? 0), 0);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {[
        { label: 'Total Lots', value: items.length, icon: Target, color: 'text-foreground' },
        { label: 'Code Red', value: codeRed, icon: Zap, color: 'text-red-500' },
        { label: 'High', value: high, icon: TrendingUp, color: 'text-orange-500' },
        { label: 'Spec Matched', value: specMatched, icon: CheckCircle2, color: 'text-green-500' },
        { label: 'No Reserve', value: noReserve, icon: Target, color: 'text-blue-500' },
        { label: 'WOVR Flagged', value: wovr, icon: AlertTriangle, color: 'text-yellow-500' },
      ].map(({ label, value, icon: Icon, color }) => (
        <Card key={label} className="p-3">
          <div className="flex items-center gap-2">
            <Icon className={cn('h-4 w-4', color)} />
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
          <div className={cn('text-2xl font-bold mt-1', color)}>{value}</div>
        </Card>
      ))}
    </div>
  );
}

// ─── Lot card ─────────────────────────────────────────────────────────────────

function LotCard({ item, rank }: { item: BriefItem; rank: number }) {
  const price = item.guide_price ?? item.asking_price;
  const gap = item.guide_vs_median_gap;
  const hasFlags = item.wovr_indicator || item.damage_noted || !item.starts_drives || !item.keys_present;

  return (
    <Card className={cn(
      'relative overflow-hidden transition-all hover:shadow-md',
      item.tier === 'CODE_RED' && 'border-red-500/50 bg-red-500/5',
      item.tier === 'HIGH' && 'border-orange-500/40 bg-orange-500/5',
    )}>
      {/* Rank badge */}
      <div className="absolute top-3 left-3 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
        {rank}
      </div>

      <CardHeader className="pl-12 pb-2 pt-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base leading-tight">
              {item.year} {item.make} {item.model}
              {item.variant && <span className="text-muted-foreground font-normal text-sm ml-1">({item.variant})</span>}
            </CardTitle>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {item.km && <span className="text-xs text-muted-foreground">{formatKm(item.km)}</span>}
              {item.fuel && <span className="text-xs text-muted-foreground">· {item.fuel}</span>}
              {item.transmission && <span className="text-xs text-muted-foreground">· {item.transmission}</span>}
              {item.drivetrain && <span className="text-xs text-muted-foreground">· {item.drivetrain}</span>}
              {item.state && <span className="text-xs text-muted-foreground">· {item.state}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {item.tier && (
              <Badge className={cn('text-xs', tierColor(item.tier))}>
                {tierLabel(item.tier)}
              </Badge>
            )}
            {item.matched_spec_names?.length > 0 && (
              <Badge variant="outline" className="text-xs text-green-600 border-green-400">
                ✓ Spec match
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 pb-3 pl-12 space-y-3">
        {/* Price row */}
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">Guide</span>
            <div className="font-semibold">{formatPrice(item.guide_price)}</div>
          </div>
          {item.reserve_price && (
            <div>
              <span className="text-muted-foreground text-xs">Reserve</span>
              <div className="font-semibold">{formatPrice(item.reserve_price)}</div>
            </div>
          )}
          {item.retail_median && (
            <div>
              <span className="text-muted-foreground text-xs">Retail median</span>
              <div className="font-semibold text-green-600">{formatPrice(item.retail_median)}</div>
            </div>
          )}
          {gap && gap > 0 && (
            <div>
              <span className="text-muted-foreground text-xs">Gap (guide→retail)</span>
              <div className="font-semibold text-emerald-600">+{formatPrice(gap)}</div>
            </div>
          )}
          {item.expected_margin && (
            <div>
              <span className="text-muted-foreground text-xs">Expected margin</span>
              <div className="font-semibold text-emerald-600">{formatPrice(item.expected_margin)}</div>
            </div>
          )}
          {item.auction_target_price && (
            <div>
              <span className="text-muted-foreground text-xs">Target bid</span>
              <div className="font-bold text-primary">{formatPrice(item.auction_target_price)}</div>
            </div>
          )}
        </div>

        {/* Auction info row */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {item.auction_house && (
            <span className="capitalize font-medium text-foreground">{item.auction_house}</span>
          )}
          {item.buy_method && (
            <Badge variant="outline" className="text-xs capitalize">{item.buy_method.replace('_', ' ')}</Badge>
          )}
          {item.reserve_status === 'no_reserve' && (
            <Badge variant="outline" className="text-xs text-blue-600 border-blue-400">No Reserve</Badge>
          )}
          {item.sale_close_at && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Closes in {formatCloseTime(item.sale_close_at)}
            </span>
          )}
          {item.source && (
            <span className="capitalize">{item.source}</span>
          )}
        </div>

        {/* Condition flags */}
        {hasFlags && (
          <div className="flex flex-wrap gap-1.5">
            {item.wovr_indicator && (
              <Badge className="bg-red-600 text-white text-xs">⚠ WOVR</Badge>
            )}
            {item.damage_noted && (
              <Badge className="bg-orange-500 text-white text-xs">Damage noted</Badge>
            )}
            {item.starts_drives === false && (
              <Badge className="bg-yellow-600 text-white text-xs">Does not start/drive</Badge>
            )}
            {item.keys_present === false && (
              <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-400">No keys</Badge>
            )}
          </div>
        )}

        {/* Condition notes */}
        {item.condition_notes && item.condition_notes.length > 0 && (
          <p className="text-xs text-muted-foreground italic">
            {item.condition_notes.slice(0, 2).join(' · ')}
          </p>
        )}

        {/* Motivation signal */}
        {item.motivation_signal && (
          <p className="text-xs text-blue-600">{item.motivation_signal}</p>
        )}

        {/* Spec match names */}
        {item.matched_spec_names?.length > 0 && (
          <p className="text-xs text-green-600">
            Matches: {item.matched_spec_names.join(', ')}
          </p>
        )}

        {/* Score + link */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            Score: <span className="font-semibold text-foreground">{item.composite_score}</span>
          </span>
          {item.listing_url && (
            <a
              href={item.listing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View listing <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MorningBriefPage() {
  const [items, setItems] = useState<BriefItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    document.title = "Tomorrow's Targets | Operator";
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      const { data, error } = await (supabase as any)
        .from('morning_brief_items')
        .select('*')
        .gte('brief_date', yesterday)
        .order('composite_score', { ascending: false })
        .limit(200);

      if (error) throw error;
      setItems(data || []);

      if (data && data.length > 0) {
        setLastGenerated(data[0].created_at);
      }
    } catch (err: any) {
      console.error('[MorningBrief] fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const generateBrief = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('morning-brief', {
        body: {},
      });
      if (error) throw error;
      console.log('[MorningBrief] Generated:', data);
      await fetchItems();
    } catch (err: any) {
      console.error('[MorningBrief] generate error:', err.message);
    } finally {
      setGenerating(false);
    }
  };

  // Filter sets
  const specMatched = items.filter(i => i.matched_spec_names?.length > 0);
  const codeRed = items.filter(i => i.tier === 'CODE_RED');
  const noReserve = items.filter(i => i.reserve_status === 'no_reserve');
  const wovr = items.filter(i => i.wovr_indicator);
  const clean = items.filter(i => !i.wovr_indicator && !i.damage_noted);

  const tabItems: Record<string, BriefItem[]> = {
    all: items,
    'spec-matched': specMatched,
    'code-red': codeRed,
    'no-reserve': noReserve,
    clean,
    wovr,
  };

  const displayItems = tabItems[activeTab] ?? items;

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Target className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Tomorrow's Targets</h1>
              <p className="text-sm text-muted-foreground">
                Prioritised auction buy list — lots closing today &amp; next business day
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastGenerated && (
              <span className="text-xs text-muted-foreground">
                Last generated: {new Date(lastGenerated).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}
              </span>
            )}
            <Button
              onClick={generateBrief}
              disabled={generating}
              size="sm"
              className="gap-2"
            >
              {generating ? (
                <>
                  <KitingIndicator state="scanning" size="sm" />
                  Generating…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Generate Brief
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <KitingIndicator state="scanning" size="xl" showLabel />
            <p className="text-sm text-muted-foreground">Loading morning brief…</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && (
          <Card className="p-12 text-center">
            <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">No brief generated yet</h2>
            <p className="text-sm text-muted-foreground mb-6">
              The morning brief runs automatically at 6am AEST each weekday.
              You can also generate it manually now.
            </p>
            <Button onClick={generateBrief} disabled={generating} className="gap-2">
              {generating ? (
                <><KitingIndicator state="scanning" size="sm" /> Generating…</>
              ) : (
                <><Zap className="h-4 w-4" /> Generate Now</>
              )}
            </Button>
          </Card>
        )}

        {/* Content */}
        {!loading && items.length > 0 && (
          <>
            {/* Summary strip */}
            <BriefSummary items={items} />

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="flex-wrap h-auto gap-1">
                <TabsTrigger value="all">
                  All ({items.length})
                </TabsTrigger>
                <TabsTrigger value="spec-matched">
                  Spec Matched ({specMatched.length})
                </TabsTrigger>
                <TabsTrigger value="code-red">
                  Code Red ({codeRed.length})
                </TabsTrigger>
                <TabsTrigger value="no-reserve">
                  No Reserve ({noReserve.length})
                </TabsTrigger>
                <TabsTrigger value="clean">
                  Clean ({clean.length})
                </TabsTrigger>
                <TabsTrigger value="wovr">
                  WOVR ({wovr.length})
                </TabsTrigger>
              </TabsList>

              {Object.keys(tabItems).map(tab => (
                <TabsContent key={tab} value={tab}>
                  {displayItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No lots in this category.
                    </p>
                  ) : (
                    <div className="grid gap-4 mt-4">
                      {displayItems.map((item, idx) => (
                        <LotCard key={item.id} item={item} rank={idx + 1} />
                      ))}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}
      </div>
    </OperatorLayout>
  );
}
