import { useEffect, useState, useCallback } from 'react';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ExternalLink, RefreshCw, ChevronDown, ChevronUp, Loader2, Anchor, Check, ArrowRight, Users, CalendarDays, Clock, Star, Bell, BellOff, Trash2 } from 'lucide-react';
import { CaroogleAIFindsDrawer } from '@/components/trading-desk/CaroogleAIFindsDrawer';

import { toast } from 'sonner';
import { format, formatDistanceToNow, isPast, isToday, isTomorrow, differenceInHours } from 'date-fns';

interface OperatorOpportunity {
  id: string;
  listing_id: string;
  listing_source: string | null;
  source_url: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  best_account_id: string | null;
  best_account_name: string | null;
  best_expected_margin: number | null;
  best_under_buy: number | null;
  alt_matches: any[];
  tier: string;
  status: string;
  assigned_to_name: string | null;
  days_listed: number | null;
  freshness: string | null;
  created_at: string;
  updated_at: string;
  anchor_sale_id: string | null;
  anchor_sale_buy_price: number | null;
  anchor_sale_sell_price: number | null;
  anchor_sale_profit: number | null;
  anchor_sale_sold_at: string | null;
  anchor_sale_km: number | null;
  anchor_sale_trim_class: string | null;
  auction_datetime: string | null;
  auction_status: string | null;
  auction_target_price: number | null;
  auction_house: string | null;
  is_starred: boolean;
  reminder_at: string | null;
  retail_median: number | null;
  retail_median_confidence: string | null;
  retail_median_sample: number | null;
  retail_vs_ask_pct: number | null;
}

type SortField = 'best_expected_margin' | 'best_under_buy' | 'asking_price' | 'year' | 'created_at' | 'tier' | 'auction_datetime';

const ACTIONABLE_STATUSES = ['new', 'assigned', 'reviewed'];

const tierOrder: Record<string, number> = { CODE_RED: 0, HIGH: 1, BUY: 2, RETAIL_BUY: 3, RETAIL_TARGET: 4, AUCTION_WATCH: 5, WATCH: 6 };
const tierColors: Record<string, string> = {
  CODE_RED: 'bg-red-600 text-white',
  HIGH: 'bg-primary text-primary-foreground',
  BUY: 'bg-accent text-accent-foreground',
  RETAIL_BUY: 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30',
  RETAIL_TARGET: 'bg-amber-500/15 text-amber-700 border border-amber-500/30',
  AUCTION_WATCH: 'bg-violet-500/15 text-violet-700 border border-violet-500/30',
  WATCH: 'bg-muted text-muted-foreground',
};

const auctionStatusColors: Record<string, string> = {
  upcoming: 'bg-violet-500/15 text-violet-700 border-violet-500/30',
  watch: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  bid_target: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  live_buy: 'bg-destructive/15 text-destructive border-destructive/30',
};

const fmt = (n: number | null) => n != null ? `$${n.toLocaleString()}` : '-';
const fmtKm = (n: number | null) => n != null ? `${(n / 1000).toFixed(0)}k` : '-';

// ─── Auction Calendar Badge ──────────────────────────────────────────────────
function AuctionCalendarBadge({ datetime, status, house, targetPrice }: {
  datetime: string | null;
  status: string | null;
  house: string | null;
  targetPrice: number | null;
}) {
  if (!datetime && (!status || status === 'none')) return null;

  const dt = datetime ? new Date(datetime) : null;
  const past = dt ? isPast(dt) : false;
  const today = dt ? isToday(dt) : false;
  const tomorrow = dt ? isTomorrow(dt) : false;
  const hoursUntil = dt ? differenceInHours(dt, new Date()) : null;
  const isUrgent = hoursUntil != null && hoursUntil >= 0 && hoursUntil <= 24;
  const isLive = hoursUntil != null && hoursUntil >= -2 && hoursUntil <= 2;

  // Calendar mini-card
  const monthStr = dt ? format(dt, 'MMM').toUpperCase() : '';
  const dayStr = dt ? format(dt, 'd') : '';
  const timeStr = dt ? format(dt, 'h:mm a') : '';
  const dayOfWeek = dt ? format(dt, 'EEE') : '';

  const urgencyClass = isLive
    ? 'border-destructive bg-destructive/10 ring-2 ring-destructive/20'
    : isUrgent
      ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/20'
      : today
        ? 'border-primary bg-primary/5'
        : tomorrow
          ? 'border-blue-400 bg-blue-400/5'
          : 'border-border bg-muted/30';

  return (
    <div className="flex items-start gap-2">
      {/* Calendar tile */}
      {dt && (
        <div className={`flex flex-col items-center rounded-lg border px-2 py-1 min-w-[3rem] ${urgencyClass}`}>
          <span className="text-[9px] font-bold tracking-wider text-muted-foreground">{monthStr}</span>
          <span className="text-lg font-bold leading-tight text-foreground">{dayStr}</span>
          <span className="text-[9px] text-muted-foreground">{dayOfWeek}</span>
        </div>
      )}
      {/* Details */}
      <div className="space-y-0.5">
        {dt && (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">{timeStr}</span>
          </div>
        )}
        {dt && !past && (
          <span className={`text-[10px] ${isUrgent ? 'text-amber-600 font-semibold' : 'text-muted-foreground'}`}>
            {isLive ? '🔴 LIVE NOW' : formatDistanceToNow(dt, { addSuffix: true })}
          </span>
        )}
        {past && dt && <span className="text-[10px] text-muted-foreground">Ended</span>}
        {house && <p className="text-[10px] text-muted-foreground">{house}</p>}
        {targetPrice != null && (
          <p className="text-[10px] font-mono text-emerald-600">Target: ${targetPrice.toLocaleString()}</p>
        )}
        {status && status !== 'none' && (
          <Badge variant="outline" className={`text-[9px] px-1 py-0 ${auctionStatusColors[status] || ''}`}>
            {status.replace('_', ' ').toUpperCase()}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ─── Override Dealer Popover ──────────────────────────────────────────────────

function OverrideDealerPopover({
  accounts,
  onSelect,
}: {
  accounts: { id: string; display_name: string }[];
  onSelect: (accountId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs h-7 px-2 gap-1">
          <Users className="h-3 w-3" />
          Override
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search dealer..." />
          <CommandList>
            <CommandEmpty>No dealer found.</CommandEmpty>
            <CommandGroup>
              {accounts.map(a => (
                <CommandItem
                  key={a.id}
                  value={a.display_name}
                  onSelect={() => { onSelect(a.id); setOpen(false); }}
                >
                  {a.display_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TradingDeskPage() {
  const [opportunities, setOpportunities] = useState<OperatorOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [accounts, setAccounts] = useState<{ id: string; display_name: string }[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [altExpandedRows, setAltExpandedRows] = useState<Set<string>>(new Set());

  const [filterAccount, setFilterAccount] = useState<string>('all');
  const [filterTier, setFilterTier] = useState<string>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  
  const [filterStatus, setFilterStatus] = useState<string>('active');
  const [filterDealerSearch, setFilterDealerSearch] = useState<string>('');
  const [filterKmMax, setFilterKmMax] = useState<string>('120000');

  const [sortField, setSortField] = useState<SortField>('best_under_buy');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const resetFilters = useCallback(() => {
    setFilterAccount('all');
    setFilterTier('all');
    setFilterSource('all');
    setFilterStatus('active');
    setFilterDealerSearch('');
    setFilterKmMax('120000');
  }, []);

  useEffect(() => { document.title = 'Trading Desk | Operator'; }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch active opportunities + starred (regardless of status) in parallel
      const [oppsRes, starredRes, acctsRes] = await Promise.all([
        supabase.from('operator_opportunities').select('*').in('status', ACTIONABLE_STATUSES).order('best_expected_margin', { ascending: false }).limit(500),
        supabase.from('operator_opportunities').select('*').eq('is_starred', true).not('status', 'in', '("new","assigned","reviewed")').limit(100),
        supabase.from('accounts').select('id, display_name'),
      ]);
      if (oppsRes.error) throw oppsRes.error;
      // Merge: active opps + starred that weren't already in active set
      const activeIds = new Set((oppsRes.data || []).map((o: any) => o.id));
      const merged = [
        ...(oppsRes.data || []),
        ...((starredRes.data || []).filter((o: any) => !activeIds.has(o.id))),
      ];
      setOpportunities(merged as OperatorOpportunity[]);
      setAccounts((acctsRes.data || []) as { id: string; display_name: string }[]);
    } catch (err) {
      console.error('Failed to load trading desk:', err);
      toast.error('Failed to load opportunities');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runScoring = async () => {
    setScoring(true);
    try {
      const { data, error } = await supabase.functions.invoke('score-operator-opportunities');
      if (error) throw error;
      toast.success(`Scored ${data?.scored || 0} opportunities from ${data?.candidates || 0} listings`);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Scoring failed');
    } finally {
      setScoring(false);
    }
  };

  const updateStatus = async (id: string, newStatus: string, assignTo?: string) => {
    const update: any = { status: newStatus, updated_at: new Date().toISOString() };
    if (assignTo) {
      const acct = accounts.find(a => a.id === assignTo);
      update.assigned_to_account = assignTo;
      update.assigned_to_name = acct?.display_name || assignTo;
      update.assigned_at = new Date().toISOString();
    }
    const { error } = await supabase.from('operator_opportunities').update(update).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Status → ${newStatus}`);
    setOpportunities(prev => prev.map(o => o.id === id ? { ...o, ...update } : o));
  };

  const toggleStar = async (id: string, current: boolean, listingId?: string) => {
    const newVal = !current;
    const { error } = await supabase.from('operator_opportunities').update({ is_starred: newVal, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setOpportunities(prev => prev.map(o => o.id === id ? { ...o, is_starred: newVal } : o));
    toast.success(newVal ? 'Added to watchlist ⭐' : 'Removed from watchlist');

    // Dispatch star-watch when starring ON
    if (newVal && listingId) {
      supabase.functions.invoke('lindy-star-watch', {
        body: { listing_id: listingId },
      }).then(({ error: watchErr }) => {
        if (watchErr) console.warn('Star-watch dispatch failed (non-blocking):', watchErr);
        else console.log('Star-watch dispatched for', listingId);
      });
    }
  };

  const setReminder = async (id: string, auctionDatetime: string | null, listingId?: string) => {
    if (!auctionDatetime) { toast.error('No auction date set'); return; }
    // Set reminder 1 hour before auction
    const auctionDt = new Date(auctionDatetime);
    const reminderDt = new Date(auctionDt.getTime() - 60 * 60 * 1000);
    const { error } = await supabase.from('operator_opportunities').update({ reminder_at: reminderDt.toISOString(), is_starred: true, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setOpportunities(prev => prev.map(o => o.id === id ? { ...o, reminder_at: reminderDt.toISOString(), is_starred: true } : o));
    toast.success(`Reminder set for ${format(reminderDt, 'd MMM h:mm a')}`);

    // Also dispatch star-watch for reminder (implies starring)
    if (listingId) {
      supabase.functions.invoke('lindy-star-watch', {
        body: { listing_id: listingId },
      }).then(({ error: watchErr }) => {
        if (watchErr) console.warn('Star-watch dispatch failed (non-blocking):', watchErr);
      });
    }
  };

  const clearReminder = async (id: string) => {
    const { error } = await supabase.from('operator_opportunities').update({ reminder_at: null, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setOpportunities(prev => prev.map(o => o.id === id ? { ...o, reminder_at: null } : o));
    toast.success('Reminder cleared');
  };

  const deleteAnchor = async (oppId: string, anchorSaleId: string) => {
    if (!confirm('Remove this anchor? The pipeline will not re-attach any anchor to this opportunity.')) return;
    // Get current dismissed list
    const { data: existing } = await supabase.from('operator_opportunities').select('dismissed_anchor_ids').eq('id', oppId).single();
    const dismissed: string[] = (existing?.dismissed_anchor_ids as string[] || []);
    if (!dismissed.includes(anchorSaleId)) dismissed.push(anchorSaleId);
    // Clear anchor + set suppress_anchor so no future anchor can be attached by pipeline
    const { error: updErr } = await supabase.from('operator_opportunities').update({
      anchor_sale_id: null, anchor_sale_buy_price: null, anchor_sale_sell_price: null,
      anchor_sale_profit: null, anchor_sale_sold_at: null, anchor_sale_km: null,
      anchor_sale_trim_class: null, dismissed_anchor_ids: dismissed,
      suppress_anchor: true,
      updated_at: new Date().toISOString(),
    }).eq('id', oppId);
    if (updErr) { toast.error(updErr.message); return; }
    setOpportunities(prev => prev.map(o => o.id === oppId ? {
      ...o, anchor_sale_id: null, anchor_sale_buy_price: null, anchor_sale_sell_price: null,
      anchor_sale_profit: null, anchor_sale_sold_at: null, anchor_sale_km: null, anchor_sale_trim_class: null,
    } : o));
    toast.success('Anchor removed — pipeline will not re-attach');
  };

  const toggleRow = (id: string) => {
    setExpandedRows(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleAltRow = (id: string) => {
    setAltExpandedRows(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // ─── Filter + Sort ──────────────────────────────────────────────────────────
  const matchesFilters = (o: OperatorOpportunity, options?: { ignoreSource?: boolean }) => {
    if (filterStatus === 'starred' && !o.is_starred) return false;
    if (filterStatus === 'active' && !['new', 'reviewed'].includes(o.status)) return false;
    if (filterStatus !== 'all' && filterStatus !== 'active' && filterStatus !== 'starred' && o.status !== filterStatus) return false;
    if (filterAccount !== 'all' && o.best_account_id !== filterAccount) return false;
    if (filterTier !== 'all' && o.tier !== filterTier) return false;
    if (!options?.ignoreSource && filterSource !== 'all' && o.listing_source !== filterSource) return false;
    if (filterDealerSearch) {
      const q = filterDealerSearch.toLowerCase();
      const nameMatch = o.best_account_name?.toLowerCase().includes(q);
      const assignedMatch = o.assigned_to_name?.toLowerCase().includes(q);
      if (!nameMatch && !assignedMatch) return false;
    }
    if (filterKmMax && filterKmMax !== 'none') {
      const maxKm = parseInt(filterKmMax);
      if (!isNaN(maxKm) && o.km != null && o.km > maxKm) return false;
    }
    return true;
  };

  const filtered = opportunities.filter(o => matchesFilters(o));
  const sourcePool = opportunities.filter(o => matchesFilters(o, { ignoreSource: true }));

  const AUCTION_SOURCES = new Set(["pickles","grays","manheim","slattery","f3","auto_auctions","vma","bidsonline","caroogle_shadow"]);
  const sorted = [...filtered].sort((a, b) => {
    // Primary: auction sources always above retail
    const aIsAuction = AUCTION_SOURCES.has(a.listing_source || "");
    const bIsAuction = AUCTION_SOURCES.has(b.listing_source || "");
    if (aIsAuction !== bIsAuction) return aIsAuction ? -1 : 1;

    let aVal: number, bVal: number;
    if (sortField === 'tier') { aVal = tierOrder[a.tier] ?? 99; bVal = tierOrder[b.tier] ?? 99; }
    else if (sortField === 'created_at') { aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); }
    else if (sortField === 'auction_datetime') {
      aVal = a.auction_datetime ? new Date(a.auction_datetime).getTime() : 0;
      bVal = b.auction_datetime ? new Date(b.auction_datetime).getTime() : 0;
    }
    else { aVal = (a[sortField] as number) ?? 0; bVal = (b[sortField] as number) ?? 0; }
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />;
  };

  const uniqueSources = [...new Set(opportunities.map(o => o.listing_source).filter(Boolean))] as string[];
  const sourceCounts = uniqueSources
    .map(source => ({
      source,
      count: sourcePool.filter(o => o.listing_source === source).length,
    }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  // Base set respects dealer search + account filter so KPI counts update
  const baseFiltered = opportunities.filter(o => {
    if (filterAccount !== 'all' && o.best_account_id !== filterAccount) return false;
    if (filterDealerSearch) {
      const q = filterDealerSearch.toLowerCase();
      const nameMatch = o.best_account_name?.toLowerCase().includes(q);
      const assignedMatch = o.assigned_to_name?.toLowerCase().includes(q);
      if (!nameMatch && !assignedMatch) return false;
    }
    return true;
  });
  const active = (tier: string) => baseFiltered.filter(o => o.tier === tier && ['new', 'reviewed'].includes(o.status)).length;
  const codeRedCount = active('CODE_RED');
  const highCount = active('HIGH');
  const buyCount = active('BUY');
  const retailBuyCount = active('RETAIL_BUY');
  const retailTargetCount = active('RETAIL_TARGET');
  const watchCount = active('WATCH');
  const auctionCount = baseFiltered.filter(o => o.auction_status && o.auction_status !== 'none' && ['new', 'reviewed'].includes(o.status)).length;
  const starredCount = baseFiltered.filter(o => o.is_starred).length;

  // ─── Daily Signal Strip (deterministic, no AI) ──────────────────────────────
  const signalStrip = (() => {
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    // Respect account filter for dealer-scoped view
    const scoped = filterAccount !== 'all'
      ? opportunities.filter(o => o.best_account_id === filterAccount)
      : opportunities;

    const strong = scoped.filter(o =>
      (o.best_under_buy || 0) >= 1500 &&
      ['new', 'reviewed'].includes(o.status)
    );

    // Explicit sort — never assume UI sort equals data truth
    const strongSorted = [...strong].sort(
      (a, b) => (b.best_under_buy || 0) - (a.best_under_buy || 0)
    );

    const urgent = strongSorted.filter(o => {
      if (!o.auction_datetime) return false;
      const dt = new Date(o.auction_datetime);
      return dt >= now && dt <= in48h;
    });

    // Sort urgent by soonest closing first
    const urgentSorted = [...urgent].sort(
      (a, b) => new Date(a.auction_datetime!).getTime() - new Date(b.auction_datetime!).getTime()
    );

    const closestUrgentHours = urgentSorted.length > 0
      ? Math.max(0, Math.round((new Date(urgentSorted[0].auction_datetime!).getTime() - now.getTime()) / (1000 * 60 * 60)))
      : null;

    const topOpp = strongSorted[0];

    if (strongSorted.length === 0) {
      return { type: 'empty' as const, text: 'No aligned inventory today.' };
    }

    const vehicle = topOpp ? `${topOpp.year || ''} ${topOpp.make || ''} ${topOpp.model || ''}`.trim() : '';
    const urgentText = urgentSorted.length > 0
      ? ` ${urgentSorted.length} closing in ${closestUrgentHours != null && closestUrgentHours < 48 ? closestUrgentHours + 'h' : '48h'}.`
      : '';

    return {
      type: 'strong' as const,
      text: `${strongSorted.length} strong opportunit${strongSorted.length === 1 ? 'y' : 'ies'} today.${urgentText}`,
      detail: `Top: ${vehicle}`,
      isUrgent: closestUrgentHours != null && closestUrgentHours < 24,
    };
  })();

  return (
    <OperatorLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Trading Desk</h1>
            <p className="text-muted-foreground text-sm">Centralised multi-dealer opportunity board</p>
          </div>
          <Button onClick={runScoring} disabled={scoring} variant="default">
            {scoring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {scoring ? 'Scoring…' : 'Run Scoring'}
          </Button>
        </div>

        {/* Daily Signal Strip */}
        {!loading && (
          <div className={`rounded-lg border px-4 py-2.5 text-sm font-medium flex items-center gap-2 ${
            signalStrip.type === 'strong'
              ? 'border-primary/30 bg-primary/5 text-foreground'
              : 'border-border bg-muted/30 text-muted-foreground'
          }`}>
            <span>{signalStrip.type === 'strong' ? '🔥' : '—'}</span>
            <span>
              {signalStrip.text}
              {signalStrip.type === 'strong' && signalStrip.detail && (
                <>
                  {' '}
                  <span className={signalStrip.isUrgent ? 'text-red-600 dark:text-red-400 font-bold' : 'font-semibold'}>
                    {signalStrip.detail}
                  </span>
                </>
              )}
            </span>
          </div>
        )}

        {/* KPI Strip - Clickable Tier Buttons */}
        <div className="flex flex-wrap gap-2 items-center">
          <CaroogleAIFindsDrawer />
          {[
            { tier: 'CODE_RED', count: codeRedCount, label: 'CODE RED', className: 'border-red-500/40 bg-red-600/15 hover:bg-red-600/25 text-red-600' },
            { tier: 'HIGH', count: highCount, label: 'HIGH', className: 'border-primary/30 bg-primary/5 hover:bg-primary/15 text-primary' },
            { tier: 'BUY', count: buyCount, label: 'BUY', className: 'border-accent/30 bg-accent/5 hover:bg-accent/15 text-accent-foreground' },
            { tier: 'RETAIL_BUY', count: retailBuyCount, label: 'RETAIL BUY', className: 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 text-emerald-600' },
            { tier: 'RETAIL_TARGET', count: retailTargetCount, label: 'RETAIL TARGET', className: 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 text-amber-600' },
            { tier: 'AUCTION', count: auctionCount, label: 'AUCTION', className: 'border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/15 text-violet-600', icon: <CalendarDays className="h-4 w-4" /> },
            { tier: 'starred', count: starredCount, label: 'STARRED', className: 'border-amber-400/30 bg-amber-400/5 hover:bg-amber-400/15 text-amber-500', icon: <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> },
            { tier: 'WATCH', count: watchCount, label: 'WATCH', className: 'border-border bg-muted/30 hover:bg-muted/60 text-muted-foreground' },
          ].map(({ tier, count, label, className, icon }) => {
            const isActive = tier === 'starred' ? filterStatus === 'starred' :
              tier === 'AUCTION' ? filterSource === 'auction' :
              filterTier === tier;
            return (
              <button
                key={tier}
                onClick={() => {
                  if (tier === 'starred') {
                    setFilterStatus(filterStatus === 'starred' ? 'active' : 'starred');
                    setFilterTier('all');
                  } else if (tier === 'AUCTION') {
                    // Toggle auction filter - not a real tier, just show auction items
                    setFilterTier('AUCTION_WATCH');
                    setFilterStatus('active');
                  } else {
                    setFilterTier(filterTier === tier ? 'all' : tier);
                    setFilterStatus('active');
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border font-medium transition-all ${className} ${isActive ? 'ring-2 ring-offset-1 ring-current shadow-md scale-105' : 'opacity-80 hover:opacity-100'}`}
              >
                {icon}
                <span className="text-xl font-bold">{count}</span>
                <span className="text-[11px] uppercase tracking-wide">{label}</span>
              </button>
            );
          })}
        </div>


        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-end">
          <div className="w-40">
            <label className="text-xs text-muted-foreground mb-1 block">Account</label>
            <Select value={filterAccount} onValueChange={setFilterAccount}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <label className="text-xs text-muted-foreground mb-1 block">Tier</label>
            <Select value={filterTier} onValueChange={setFilterTier}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="CODE_RED">CODE RED</SelectItem>
                <SelectItem value="HIGH">HIGH</SelectItem>
                <SelectItem value="BUY">BUY</SelectItem>
                <SelectItem value="RETAIL_BUY">RETAIL BUY</SelectItem>
                <SelectItem value="RETAIL_TARGET">RETAIL TARGET</SelectItem>
                <SelectItem value="AUCTION_WATCH">AUCTION WATCH</SelectItem>
                <SelectItem value="WATCH">WATCH</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <label className="text-xs text-muted-foreground mb-1 block">Source</label>
            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {uniqueSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <label className="text-xs text-muted-foreground mb-1 block">Status</label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">New + Reviewed</SelectItem>
                <SelectItem value="new">New Only</SelectItem>
                <SelectItem value="starred">⭐ Starred</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="bought">Bought</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <label className="text-xs text-muted-foreground mb-1 block">Search Dealer</label>
            <Input value={filterDealerSearch} onChange={e => setFilterDealerSearch(e.target.value)} placeholder="Type dealer name…" />
          </div>
          <div className="w-36">
            <label className="text-xs text-muted-foreground mb-1 block">Max KM</label>
            <Select value={filterKmMax} onValueChange={setFilterKmMax}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No limit</SelectItem>
                <SelectItem value="50000">50,000 km</SelectItem>
                <SelectItem value="80000">80,000 km</SelectItem>
                <SelectItem value="100000">100,000 km</SelectItem>
                <SelectItem value="120000">120,000 km</SelectItem>
                <SelectItem value="150000">150,000 km</SelectItem>
                <SelectItem value="200000">200,000 km</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {sourceCounts.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted-foreground">Live sources:</span>
            <Button
              size="sm"
              variant={filterSource === 'all' ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => setFilterSource('all')}
            >
              All <span className="ml-1 text-xs opacity-70">{sourcePool.length}</span>
            </Button>
            {sourceCounts.map(({ source, count }) => (
              <Button
                key={source}
                size="sm"
                variant={filterSource === source ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => setFilterSource(source)}
              >
                {source} <span className="ml-1 text-xs opacity-70">{count}</span>
              </Button>
            ))}
          </div>
        )}

        <p className="text-sm text-muted-foreground">{sorted.length} opportunities</p>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : sorted.length === 0 ? (
          <Card><CardContent className="p-12 text-center"><p className="text-muted-foreground">No opportunities yet. Hit "Run Scoring" to populate.</p></CardContent></Card>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-7 px-1"></TableHead>
                    <TableHead className="w-7 px-1">★</TableHead>
                    <TableHead className="w-[72px] cursor-pointer px-2" onClick={() => handleSort('tier')}>Tier <SortIcon field="tier" /></TableHead>
                    <TableHead className="px-2">Vehicle</TableHead>
                    <TableHead className="w-[76px] text-right cursor-pointer px-2" onClick={() => handleSort('asking_price')}>Ask <SortIcon field="asking_price" /></TableHead>
                    <TableHead className="w-[110px] px-2">Best Fit</TableHead>
                    <TableHead className="w-[85px] text-right cursor-pointer px-2" onClick={() => handleSort('best_under_buy')}>Under-Buy <SortIcon field="best_under_buy" /></TableHead>
                    <TableHead className="w-[90px] text-right px-2">Mkt Median</TableHead>
                    <TableHead className="w-[90px] cursor-pointer px-2" onClick={() => handleSort('auction_datetime')}>Auction <SortIcon field="auction_datetime" /></TableHead>
                    <TableHead className="w-[80px] px-2">Source</TableHead>
                    <TableHead className="w-[46px] text-right cursor-pointer px-1" onClick={() => handleSort('year')}>Year <SortIcon field="year" /></TableHead>
                    <TableHead className="w-[42px] text-right px-1">KM</TableHead>
                    <TableHead className="w-[42px] text-right px-1">Age</TableHead>
                    <TableHead className="w-[70px] px-2">Status</TableHead>
                    <TableHead className="w-[120px] text-right px-2">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map(opp => {
                    const alts = (opp.alt_matches || []) as any[];
                    const hasAlts = alts.length > 0;

                    return (
                      <Collapsible key={opp.id} asChild open={expandedRows.has(opp.id)} onOpenChange={() => toggleRow(opp.id)}>
                        <>
                          <TableRow className={`border-b border-border ${opp.tier === 'CODE_RED' ? 'animate-flash-red' : ''}`}>
                            {/* Anchor toggle */}
                            <TableCell className="px-1">
                              {opp.anchor_sale_id && (
                                <CollapsibleTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                    <Anchor className={`h-3.5 w-3.5 transition-colors ${expandedRows.has(opp.id) ? 'text-primary' : 'text-muted-foreground'}`} />
                                  </Button>
                                </CollapsibleTrigger>
                              )}
                            </TableCell>
                            {/* Star */}
                            <TableCell className="px-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => toggleStar(opp.id, opp.is_starred, opp.listing_id)}
                              >
                                <Star className={`h-3.5 w-3.5 transition-colors ${opp.is_starred ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} />
                              </Button>
                            </TableCell>
                            {/* Tier */}
                            <TableCell className="px-2">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold leading-tight ${tierColors[opp.tier] || 'bg-muted text-muted-foreground'}`}>
                                {opp.tier.replace('_', ' ')}
                              </span>
                            </TableCell>
                            {/* Vehicle */}
                            <TableCell className="px-2">
                              <p className="font-medium text-foreground text-sm truncate">{opp.make} {opp.model}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{opp.variant}</p>
                            </TableCell>
                            {/* Ask */}
                            <TableCell className="text-right font-mono text-sm px-2">{fmt(opp.asking_price)}</TableCell>
                            {/* Best Fit — primary dealer block */}
                            <TableCell className="px-2">
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-semibold text-primary">{opp.best_account_name || '-'}</span>
                                  {opp.assigned_to_name && opp.assigned_to_name !== opp.best_account_name && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0">overridden</Badge>
                                  )}
                                </div>
                                {hasAlts && (
                                  <button
                                    onClick={() => toggleAltRow(opp.id)}
                                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
                                  >
                                    +{alts.length} other fit{alts.length > 1 ? 's' : ''}
                                    <ChevronDown className={`h-3 w-3 transition-transform ${altExpandedRows.has(opp.id) ? 'rotate-180' : ''}`} />
                                  </button>
                                )}
                                {altExpandedRows.has(opp.id) && hasAlts && (
                                  <div className="mt-1 space-y-0.5 border-l-2 border-muted pl-2">
                                    {alts.sort((a: any, b: any) => (b.under_buy || 0) - (a.under_buy || 0)).map((m: any, i: number) => (
                                      <div key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                                        <span className="font-medium">{m.account_name}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            {/* Under-Buy */}
                            <TableCell className="text-right px-2">
                              <span className={`font-mono text-sm ${(opp.best_under_buy || 0) >= 1500 ? 'text-primary' : 'text-muted-foreground'}`}>
                                {fmt(opp.best_under_buy)}
                              </span>
                            </TableCell>
                            {/* Retail Median */}
                            <TableCell className="text-right px-2">
                              {opp.retail_median ? (
                                <div>
                                  <span className="font-mono text-sm text-foreground">{fmt(opp.retail_median)}</span>
                                  <div className="flex items-center justify-end gap-1">
                                    <span className={`text-[10px] font-mono ${(opp.retail_vs_ask_pct || 0) < 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                                      {(opp.retail_vs_ask_pct || 0) > 0 ? '+' : ''}{opp.retail_vs_ask_pct}%
                                    </span>
                                    <span className={`text-[9px] px-1 rounded ${
                                      opp.retail_median_confidence === 'HIGH' ? 'bg-emerald-500/15 text-emerald-700' :
                                      opp.retail_median_confidence === 'MEDIUM' ? 'bg-amber-500/15 text-amber-700' :
                                      'bg-muted text-muted-foreground'
                                    }`}>
                                      {opp.retail_median_confidence?.replace('_WIDE', '↔')} ({opp.retail_median_sample})
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            {/* Auction + Reminder */}
                            <TableCell className="px-2">
                              <div className="space-y-1">
                                <AuctionCalendarBadge
                                  datetime={opp.auction_datetime}
                                  status={opp.auction_status}
                                  house={opp.auction_house}
                                  targetPrice={opp.auction_target_price}
                                />
                                {opp.auction_datetime && (
                                  opp.reminder_at ? (
                                    <button
                                      onClick={() => clearReminder(opp.id)}
                                      className="flex items-center gap-1 text-[10px] text-primary hover:text-destructive transition-colors"
                                      title={`Reminder: ${format(new Date(opp.reminder_at), 'd MMM h:mm a')}`}
                                    >
                                      <Bell className="h-3 w-3 fill-current" />
                                      <span>{format(new Date(opp.reminder_at), 'h:mm a')}</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => setReminder(opp.id, opp.auction_datetime, opp.listing_id)}
                                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                                    >
                                      <BellOff className="h-3 w-3" />
                                      <span>Set reminder</span>
                                    </button>
                                  )
                                )}
                              </div>
                            </TableCell>
                            {/* Source */}
                            <TableCell className="text-[11px] text-muted-foreground px-2 truncate">{opp.listing_source}</TableCell>
                            <TableCell className="text-right font-mono text-sm px-1">{opp.year}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-muted-foreground px-1">{fmtKm(opp.km)}</TableCell>
                            {/* Age */}
                            <TableCell className="text-right font-mono text-sm px-1">
                              {opp.days_listed != null ? (
                                <span className={opp.days_listed >= 20 ? 'text-amber-600 dark:text-amber-400 font-semibold' : opp.days_listed >= 10 ? 'text-muted-foreground' : 'text-muted-foreground/60'}>
                                  {opp.days_listed}d
                                </span>
                              ) : '-'}
                            </TableCell>
                            {/* Status */}
                            <TableCell className="px-2">
                              <Badge variant={opp.status === 'new' ? 'default' : 'outline'} className="text-xs">
                                {opp.assigned_to_name ? `→ ${opp.assigned_to_name}` : opp.status}
                              </Badge>
                            </TableCell>
                            {/* Actions — Assign Best + Override + Ignore + Link */}
                            <TableCell className="text-right px-2">
                              <div className="flex items-center justify-end gap-1">
                                {opp.best_account_id && opp.status !== 'assigned' && (
                                  <Button
                                    variant="default"
                                    size="sm"
                                    className="text-xs h-7 px-2 gap-1"
                                    onClick={() => updateStatus(opp.id, 'assigned', opp.best_account_id!)}
                                  >
                                    <Check className="h-3 w-3" />
                                    Assign Best
                                  </Button>
                                )}
                                <OverrideDealerPopover
                                  accounts={accounts}
                                  onSelect={(acctId) => updateStatus(opp.id, 'assigned', acctId)}
                                />
                                <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => updateStatus(opp.id, 'ignored')}>✕</Button>
                                {(() => {
                                  let linkUrl = opp.source_url;
                                  // Pickles direct lot URLs 404 — build a search URL instead
                                    if (linkUrl && linkUrl.includes('pickles.com.au') && /\/search\?q=|\/used\/search/.test(linkUrl)) {
                                      const q = [opp.year, opp.make, opp.model].filter(Boolean).join('+');
                                      linkUrl = `https://www.pickles.com.au/cars/search?q=${q}`;
                                    }
                                  return linkUrl ? (
                                    <Button variant="ghost" size="iconSm" asChild>
                                      <a href={linkUrl} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </a>
                                    </Button>
                                  ) : null;
                                })()}
                              </div>
                            </TableCell>
                          </TableRow>

                          {/* Anchor Sale Collapsible Row */}
                          <CollapsibleContent asChild>
                            <TableRow className={`border-b border-border ${opp.tier === 'CODE_RED' || opp.tier === 'HIGH' ? 'bg-primary/5' : 'bg-muted/30'}`}>
                              <TableCell colSpan={16} className="py-3 px-6">
                                <div className="flex items-start gap-6">
                                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
                                    <Anchor className="h-3.5 w-3.5" />
                                    Matched Sale
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 text-sm flex-1">
                                    <div>
                                      <p className="text-xs text-muted-foreground">Bought</p>
                                      <p className="font-mono font-semibold text-foreground">{fmt(opp.anchor_sale_buy_price)}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground">Sold</p>
                                      <p className="font-mono font-semibold text-foreground">{fmt(opp.anchor_sale_sell_price)}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground">Profit</p>
                                      <p className="font-mono font-semibold text-primary">{fmt(opp.anchor_sale_profit)}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground">Sold Date</p>
                                      <p className="font-medium text-foreground">
                                        {opp.anchor_sale_sold_at ? format(new Date(opp.anchor_sale_sold_at), 'd MMM yyyy') : '-'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground">KM at Sale</p>
                                      <p className="font-mono text-foreground">{fmtKm(opp.anchor_sale_km)}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground">KM Diff</p>
                                      <p className="font-mono text-foreground">
                                        {opp.anchor_sale_km != null && opp.km != null
                                          ? `${opp.km - opp.anchor_sale_km >= 0 ? '+' : ''}${fmtKm(Math.abs(opp.km - opp.anchor_sale_km))}`
                                          : '-'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground">Trim</p>
                                      <p className="font-medium text-foreground">{opp.anchor_sale_trim_class || '-'}</p>
                                    </div>
                                    <div className="flex items-end">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs gap-1"
                                        onClick={() => opp.anchor_sale_id && deleteAnchor(opp.id, opp.anchor_sale_id)}
                                      >
                                        <Trash2 className="h-3 w-3" /> Delete Anchor
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          </CollapsibleContent>
                        </>
                      </Collapsible>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </OperatorLayout>
  );
}
