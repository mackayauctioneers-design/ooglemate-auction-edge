import { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AdminGuard } from '@/components/guards/AdminGuard';
import { TrapInventoryTable } from '@/components/trap-inventory/TrapInventoryTable';
import { TrapInventoryFilters, TrapInventoryFiltersState } from '@/components/trap-inventory/TrapInventoryFilters';
import { TrapInventoryDrawer } from '@/components/trap-inventory/TrapInventoryDrawer';
import { Loader2, Store } from 'lucide-react';

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
}

export default function TrapInventoryPage() {
  const { user } = useAuth();
  const [listings, setListings] = useState<TrapListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState<TrapListing | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
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
      .select('listing_id, is_watching, is_pinned')
      .eq('user_id', user.id);

    if (error) {
      console.error('Error fetching watchlist:', error);
      return;
    }

    const watching = new Set<string>();
    const pinned = new Set<string>();
    
    data?.forEach(item => {
      if (item.is_watching) watching.add(item.listing_id);
      if (item.is_pinned) pinned.add(item.listing_id);
    });

    setWatchlistIds(watching);
    setPinnedIds(pinned);
  };

  // Apply filters and sorting
  const filteredListings = useMemo(() => {
    let result = [...listings];

    // Apply preset first (overrides other filters)
    if (filters.preset === 'watchlist') {
      result = result.filter(l => watchlistIds.has(l.id));
    } else if (filters.preset === 'strong_buy') {
      result = result.filter(l => l.deal_label === 'STRONG_BUY' || l.deal_label === 'MISPRICED');
    } else if (filters.preset === 'mispriced') {
      result = result.filter(l => l.deal_label === 'MISPRICED');
    } else if (filters.preset === '90_plus') {
      result = result.filter(l => l.days_on_market >= 90);
    } else if (filters.preset === 'no_benchmark') {
      result = result.filter(l => l.no_benchmark);
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
  }, [listings, filters, watchlistIds, pinnedIds]);

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
            />
          )}

          <TrapInventoryDrawer
            listing={selectedListing}
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
          />
        </div>
      </AppLayout>
    </AdminGuard>
  );
}
