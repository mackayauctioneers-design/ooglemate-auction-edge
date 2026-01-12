import { useState, useEffect, useMemo, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AdminGuard } from '@/components/guards/AdminGuard';
import { TrapInventoryTable } from '@/components/trap-inventory/TrapInventoryTable';
import { TrapInventoryFilters, TrapInventoryFiltersState } from '@/components/trap-inventory/TrapInventoryFilters';
import { TrapInventoryDrawer } from '@/components/trap-inventory/TrapInventoryDrawer';
import { Button } from '@/components/ui/button';
import { Loader2, Store, Download, Phone } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export interface TrapListing {
  id: string;
  listing_id: string;
  make: string;
  model: string;
  variant_family: string | null;
  year: number;
  km: number | null;
  asking_price: number | null;
  first_seen_at: string;
  source: string;
  status: string;
  listing_url: string | null;
  location: string | null;
  region_id: string | null;
  // Time-based fields
  days_on_market: number;
  price_change_count: number;
  last_price_change_at: string | null;
  first_price: number | null;
  // Benchmark fields
  benchmark_price: number | null;
  benchmark_sample: number | null;
  benchmark_ttd: number | null;
  delta_dollars: number | null;
  delta_pct: number | null;
  deal_label: string;
  no_benchmark: boolean;
  // Risk flags
  sold_returned_suspected?: boolean;
  sold_returned_reason?: string | null;
  // Watch mode fields
  watch_status?: 'watching' | 'buy_window' | 'avoid' | null;
  watch_reason?: string | null;
  buy_window_at?: string | null;
  tracked_by?: string | null;
  assigned_to?: string | null;
  assigned_at?: string | null;
  attempt_count?: number;
  attempt_stage?: string | null;
  avoid_reason?: string | null;
  watch_confidence?: 'high' | 'med' | 'low' | null;
}

export default function TrapInventoryPage() {
  const { user } = useAuth();
  const [listings, setListings] = useState<TrapListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState<TrapListing | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [notesIds, setNotesIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<TrapInventoryFiltersState>({
    dealer: '',
    make: '',
    model: '',
    daysOnMarket: 'all',
    deltaBand: 'all',
    preset: 'none',
    sortBy: 'delta_pct',
    sortDir: 'asc',
  });

  // Extract unique dealers, makes, models for filter dropdowns
  const [dealers, setDealers] = useState<string[]>([]);
  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    document.title = 'Trap Inventory | OogleMate';
    fetchListings();
    if (user) {
      fetchWatchlist();
    }
  }, [user]);

  const fetchListings = async () => {
    setLoading(true);
    
    // Use secure RPC that checks admin status server-side
    const { data, error } = await supabase
      .rpc('get_trap_deals')
      .order('delta_pct', { ascending: true, nullsFirst: false });

    if (error) {
      console.error('Error fetching trap deals:', error);
      // Check for 403/insufficient privilege
      if (error.code === '42501' || error.message?.includes('forbidden')) {
        toast.error('Not authorised to view trap deals');
      }
      setListings([]);
      setLoading(false);
      return;
    }

    if (!data || data.length === 0) {
      setListings([]);
      setLoading(false);
      return;
    }

    // Transform to TrapListing
    const transformed: TrapListing[] = data.map((l: any) => ({
      id: l.id,
      listing_id: l.listing_id,
      make: l.make,
      model: l.model,
      variant_family: l.variant_family === 'ALL' ? null : l.variant_family,
      year: l.year,
      km: l.km,
      asking_price: l.asking_price,
      first_seen_at: l.first_seen_at,
      source: l.source,
      status: l.status,
      listing_url: l.listing_url,
      location: l.location,
      region_id: l.region_id,
      days_on_market: l.days_on_market ?? 0,
      price_change_count: l.price_change_count ?? 0,
      last_price_change_at: l.last_price_change_at,
      first_price: l.first_price,
      benchmark_price: l.fingerprint_price,
      benchmark_sample: l.fingerprint_sample,
      benchmark_ttd: l.fingerprint_ttd,
      delta_dollars: l.delta_dollars,
      delta_pct: l.delta_pct,
      deal_label: l.deal_label ?? 'NO_BENCHMARK',
      no_benchmark: l.no_benchmark ?? true,
      // Watch mode fields
      sold_returned_suspected: l.sold_returned_suspected ?? false,
      sold_returned_reason: l.sold_returned_reason,
      watch_status: l.watch_status,
      watch_reason: l.watch_reason,
      buy_window_at: l.buy_window_at,
      tracked_by: l.tracked_by,
      assigned_to: l.assigned_to ?? null,
      assigned_at: l.assigned_at ?? null,
      attempt_count: l.attempt_count ?? 0,
      attempt_stage: l.attempt_stage,
      avoid_reason: l.avoid_reason,
      watch_confidence: l.watch_confidence,
    }));

    // Extract unique values for filters
    const uniqueDealers = [...new Set(transformed.map(l => l.source))].sort();
    const uniqueMakes = [...new Set(transformed.map(l => l.make))].sort();
    const uniqueModels = [...new Set(transformed.map(l => l.model))].sort();

    setDealers(uniqueDealers);
    setMakes(uniqueMakes);
    setModels(uniqueModels);
    setListings(transformed);
    setLoading(false);
  };

  const fetchWatchlist = async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from('user_watchlist')
      .select('listing_id, is_watching, is_pinned, notes')
      .eq('user_id', user.id);

    if (error) {
      console.error('Error fetching watchlist:', error);
      return;
    }

    const watching = new Set<string>();
    const pinned = new Set<string>();
    const withNotes = new Set<string>();
    
    data?.forEach(item => {
      if (item.is_watching) watching.add(item.listing_id);
      if (item.is_pinned) pinned.add(item.listing_id);
      if (item.notes && item.notes.trim()) withNotes.add(item.listing_id);
    });

    setWatchlistIds(watching);
    setPinnedIds(pinned);
    setNotesIds(withNotes);
  };

  // Apply filters and sorting
  const filteredListings = useMemo(() => {
    let result = [...listings];

    // Apply preset first (overrides other filters)
    if (filters.preset === 'watchlist') {
      result = result.filter(l => watchlistIds.has(l.id));
    } else if (filters.preset === 'has_notes') {
      result = result.filter(l => notesIds.has(l.id));
    } else if (filters.preset === 'strong_buy') {
      // SAFETY: Exclude AVOID from Strong Buy views
      result = result.filter(l => 
        (l.deal_label === 'STRONG_BUY' || l.deal_label === 'MISPRICED') &&
        l.watch_status !== 'avoid' &&
        !l.sold_returned_suspected
      );
    } else if (filters.preset === 'mispriced') {
      // SAFETY: Exclude AVOID from Mispriced views
      result = result.filter(l => 
        l.deal_label === 'MISPRICED' &&
        l.watch_status !== 'avoid' &&
        !l.sold_returned_suspected
      );
    } else if (filters.preset === '90_plus') {
      result = result.filter(l => l.days_on_market >= 90);
    } else if (filters.preset === 'return_risk') {
      result = result.filter(l => l.sold_returned_suspected === true);
    } else if (filters.preset === 'no_benchmark') {
      result = result.filter(l => l.no_benchmark);
    } else if (filters.preset === 'buy_window') {
      result = result.filter(l => l.watch_status === 'buy_window');
    } else if (filters.preset === 'buy_window_unassigned') {
      result = result.filter(l => 
        l.watch_status === 'buy_window' &&
        !l.assigned_to &&
        !l.sold_returned_suspected
      );
    } else if (filters.preset === 'watching') {
      result = result.filter(l => l.watch_status === 'watching');
    } else if (filters.preset === 'avoid') {
      result = result.filter(l => l.watch_status === 'avoid' || l.sold_returned_suspected);
    } else if (filters.preset === 'tracked') {
      result = result.filter(l => l.tracked_by != null && l.tracked_by !== '');
    }

    // Filter by dealer
    if (filters.dealer) {
      result = result.filter(l => l.source === filters.dealer);
    }

    // Filter by make
    if (filters.make) {
      result = result.filter(l => l.make === filters.make);
    }

    // Filter by model
    if (filters.model) {
      result = result.filter(l => l.model === filters.model);
    }

    // Filter by days on market
    if (filters.daysOnMarket !== 'all') {
      const [min, max] = filters.daysOnMarket.split('-').map(Number);
      if (max) {
        result = result.filter(l => l.days_on_market >= min && l.days_on_market <= max);
      } else {
        result = result.filter(l => l.days_on_market >= min);
      }
    }

    // Filter by delta band
    if (filters.deltaBand !== 'all') {
      if (filters.deltaBand === 'under_25') {
        result = result.filter(l => l.delta_pct !== null && l.delta_pct <= -25);
      } else if (filters.deltaBand === 'under_15') {
        result = result.filter(l => l.delta_pct !== null && l.delta_pct <= -15);
      } else if (filters.deltaBand === 'under_10') {
        result = result.filter(l => l.delta_pct !== null && l.delta_pct <= -10);
      } else if (filters.deltaBand === 'at_benchmark') {
        result = result.filter(l => l.delta_pct !== null && l.delta_pct > -5 && l.delta_pct < 5);
      } else if (filters.deltaBand === 'over_5') {
        result = result.filter(l => l.delta_pct !== null && l.delta_pct >= 5);
      } else if (filters.deltaBand === 'no_benchmark') {
        result = result.filter(l => l.no_benchmark);
      }
    }

    // Sort
    result.sort((a, b) => {
      // Pinned items always first
      if (pinnedIds.has(a.id) && !pinnedIds.has(b.id)) return -1;
      if (!pinnedIds.has(a.id) && pinnedIds.has(b.id)) return 1;

      let aVal: number | null = null;
      let bVal: number | null = null;

      switch (filters.sortBy) {
        case 'delta_pct':
          // Put items without benchmark at the end
          if (a.no_benchmark && !b.no_benchmark) return 1;
          if (!a.no_benchmark && b.no_benchmark) return -1;
          aVal = a.delta_pct ?? 999;
          bVal = b.delta_pct ?? 999;
          break;
        case 'days_on_market':
          aVal = a.days_on_market;
          bVal = b.days_on_market;
          break;
        case 'price_drop':
          aVal = a.delta_dollars ?? 0;
          bVal = b.delta_dollars ?? 0;
          break;
        case 'price':
          aVal = a.asking_price ?? 0;
          bVal = b.asking_price ?? 0;
          break;
      }

      if (aVal === null || bVal === null) return 0;
      return filters.sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [listings, filters, watchlistIds, pinnedIds, notesIds]);

  const handleRowClick = (listing: TrapListing) => {
    setSelectedListing(listing);
    setDrawerOpen(true);
  };

  // Stats for header
  const stats = useMemo(() => {
    const withBenchmark = listings.filter(l => !l.no_benchmark);
    const strongBuys = listings.filter(l => l.deal_label === 'STRONG_BUY' || l.deal_label === 'MISPRICED');
    const mispriced = listings.filter(l => l.deal_label === 'MISPRICED');
    const aged90 = listings.filter(l => l.days_on_market >= 90);
    return { 
      total: listings.length, 
      withBenchmark: withBenchmark.length, 
      strongBuys: strongBuys.length, 
      mispriced: mispriced.length,
      aged90: aged90.length 
    };
  }, [listings]);

  // CSV export function
  const exportCsv = useCallback(() => {
    if (filteredListings.length === 0) {
      toast.error('No listings to export');
      return;
    }

    // Build watchlist lookup for current user
    const getWatchlistInfo = (id: string) => ({
      watched: watchlistIds.has(id) ? 'Y' : '',
      pinned: pinnedIds.has(id) ? 'Y' : '',
      hasNotes: notesIds.has(id) ? 'Y' : '',
    });

    // CSV headers
    const headers = [
      'trap_slug', 'make', 'model', 'variant_family', 'year', 'km',
      'asking_price', 'fingerprint_price', 'fingerprint_sample',
      'delta_pct', 'delta_dollars', 'deal_label',
      'days_on_market', 'price_change_count', 'location', 'listing_url',
      'watched', 'pinned', 'has_notes'
    ];

    // Build rows
    const rows = filteredListings.map(l => {
      const wl = getWatchlistInfo(l.id);
      return [
        l.source.replace(/^trap_/, ''),
        l.make,
        l.model,
        l.variant_family || '',
        l.year,
        l.km ?? '',
        l.asking_price ?? '',
        l.benchmark_price ?? '',
        l.benchmark_sample ?? '',
        l.delta_pct !== null ? l.delta_pct.toFixed(1) : '',
        l.delta_dollars ?? '',
        l.deal_label,
        l.days_on_market,
        l.price_change_count,
        l.location || '',
        l.listing_url || '',
        wl.watched,
        wl.pinned,
        wl.hasNotes
      ];
    });

    // Escape and format CSV
    const escapeCell = (val: any) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(escapeCell).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trap_inventory_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${filteredListings.length} listings`);
  }, [filteredListings, watchlistIds, pinnedIds, notesIds]);

  // Call List export function (90+ day prospects)
  const exportCallList = useCallback(() => {
    // Start from filtered listings (respects user's current filters)
    // but enforce call list rules on top
    // SAFETY: ALWAYS exclude AVOID / sold_returned_suspected from Call List
    const callListItems = filteredListings
      .filter(l => 
        l.days_on_market >= 90 &&
        l.watch_status !== 'avoid' &&
        !l.sold_returned_suspected && (
          l.deal_label === 'MISPRICED' ||
          l.deal_label === 'STRONG_BUY' ||
          l.price_change_count >= 2 ||
          (l.delta_pct !== null && l.delta_pct <= -10)
        )
      );

    if (callListItems.length === 0) {
      toast.error('No listings match call list criteria (90+ days with price signals)');
      return;
    }

    // Sort: deal_label priority, then days_on_market DESC, then delta_pct ASC
    const dealPriority: Record<string, number> = {
      'MISPRICED': 1,
      'STRONG_BUY': 2,
      'WATCH': 3,
      'NORMAL': 4,
      'NO_BENCHMARK': 5,
    };

    const sorted = [...callListItems].sort((a, b) => {
      // 1. Deal label priority
      const aPri = dealPriority[a.deal_label] ?? 99;
      const bPri = dealPriority[b.deal_label] ?? 99;
      if (aPri !== bPri) return aPri - bPri;
      
      // 2. Days on market DESC
      if (a.days_on_market !== b.days_on_market) return b.days_on_market - a.days_on_market;
      
      // 3. Delta pct ASC (nulls last)
      const aDelta = a.delta_pct ?? 999;
      const bDelta = b.delta_pct ?? 999;
      return aDelta - bDelta;
    });

    // Watchlist lookup
    const getWatchlistInfo = (id: string) => ({
      watched: watchlistIds.has(id) ? 'Y' : '',
      pinned: pinnedIds.has(id) ? 'Y' : '',
      hasNotes: notesIds.has(id) ? 'Y' : '',
    });

    // CSV headers (specified columns)
    const headers = [
      'trap_slug', 'year', 'make', 'model', 'variant_family', 'km',
      'asking_price', 'fingerprint_price', 'delta_pct', 'delta_dollars',
      'days_on_market', 'price_change_count', 'last_price_change_at',
      'watched', 'pinned', 'has_notes', 'listing_url', 'location'
    ];

    // Build rows
    const rows = sorted.map(l => {
      const wl = getWatchlistInfo(l.id);
      return [
        l.source.replace(/^trap_/, ''),
        l.year,
        l.make,
        l.model,
        l.variant_family || '',
        l.km ?? '',
        l.asking_price ?? '',
        l.benchmark_price ?? '',
        l.delta_pct !== null ? l.delta_pct.toFixed(1) : '',
        l.delta_dollars ?? '',
        l.days_on_market,
        l.price_change_count,
        l.last_price_change_at ? format(new Date(l.last_price_change_at), 'yyyy-MM-dd') : '',
        wl.watched,
        wl.pinned,
        wl.hasNotes,
        l.listing_url || '',
        l.location || ''
      ];
    });

    // Escape and format CSV
    const escapeCell = (val: any) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(escapeCell).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `call_list_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${sorted.length} call list prospects`);
  }, [filteredListings, watchlistIds, pinnedIds, notesIds]);

  return (
    <AdminGuard>
      <AppLayout>
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Store className="h-6 w-6" />
                Trap Inventory
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Monitor retail stock vs benchmark – identify mispriced wholesale opportunities
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right text-sm text-muted-foreground space-y-0.5">
                {!loading && (
                  <>
                    <div>{filteredListings.length} of {stats.total} listings</div>
                    <div className="text-xs">
                      {stats.mispriced} mispriced • {stats.strongBuys} strong buys • {stats.aged90} aged 90+
                    </div>
                  </>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={loading || filteredListings.length === 0}
              >
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCallList}
                disabled={loading || filteredListings.length === 0}
              >
                <Phone className="h-4 w-4" />
                Export Call List
              </Button>
            </div>
          </div>

          <TrapInventoryFilters
            filters={filters}
            onFiltersChange={setFilters}
            dealers={dealers}
            makes={makes}
            models={models}
          />

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <TrapInventoryTable
              listings={filteredListings}
              onRowClick={handleRowClick}
              watchedIds={watchlistIds}
              pinnedIds={pinnedIds}
              notesIds={notesIds}
            />
          )}

          <TrapInventoryDrawer
            listing={selectedListing}
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            onNotesChange={fetchWatchlist}
            onTrackedByChange={(listingId, trackedBy) => {
              // Update listings in state
              setListings(prev => prev.map(l => 
                l.id === listingId ? { ...l, tracked_by: trackedBy ?? undefined } : l
              ));
              // Update selected listing too
              if (selectedListing?.id === listingId) {
                setSelectedListing(prev => prev ? { ...prev, tracked_by: trackedBy ?? undefined } : null);
              }
            }}
          />
        </div>
      </AppLayout>
    </AdminGuard>
  );
}
