import { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
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
  last_seen_at: string;
  source: string;
  status: string;
  listing_url: string | null;
  location: string | null;
  region_id: string | null;
  // Computed fields
  days_on_market: number;
  price_change_amount: number | null;
  price_change_pct: number | null;
  last_price_change_date: string | null;
  first_price: number | null;
  // Benchmark fields
  benchmark_price: number | null;
  benchmark_sample: number | null;
  delta_dollars: number | null;
  delta_pct: number | null;
  no_benchmark: boolean;
}

export default function TrapInventoryPage() {
  const [listings, setListings] = useState<TrapListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState<TrapListing | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  }, []);

  const fetchListings = async () => {
    setLoading(true);
    
    // Fetch from trap_deals view (joins with fingerprint benchmarks)
    const { data: dealsData, error } = await supabase
      .from('trap_deals')
      .select('*')
      .order('delta_pct', { ascending: true, nullsFirst: false });

    if (error) {
      console.error('Error fetching trap deals:', error);
      // Fallback to direct query if view doesn't exist yet
      await fetchListingsFallback();
      return;
    }

    if (!dealsData || dealsData.length === 0) {
      setListings([]);
      setLoading(false);
      return;
    }

    // Transform to TrapListing
    const transformed: TrapListing[] = dealsData.map((l: any) => ({
      id: l.id,
      listing_id: l.listing_id,
      make: l.make,
      model: l.model,
      variant_family: l.variant_family,
      year: l.year,
      km: l.km,
      asking_price: l.asking_price,
      first_seen_at: l.first_seen_at,
      last_seen_at: l.last_seen_at,
      source: l.source,
      status: l.status,
      listing_url: l.listing_url,
      location: l.location,
      region_id: l.region_id,
      days_on_market: l.days_on_market ?? 0,
      price_change_amount: l.price_change_dollars,
      price_change_pct: l.price_change_pct,
      last_price_change_date: l.last_price_change_at,
      first_price: l.first_price,
      benchmark_price: l.benchmark_price,
      benchmark_sample: l.benchmark_sample,
      delta_dollars: l.delta_dollars,
      delta_pct: l.delta_pct,
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

  // Fallback for when view doesn't exist
  const fetchListingsFallback = async () => {
    const { data: listingsData, error } = await supabase
      .from('vehicle_listings')
      .select('*')
      .eq('source_class', 'classifieds')
      .order('first_seen_at', { ascending: false });

    if (error) {
      console.error('Error fetching trap listings:', error);
      setLoading(false);
      return;
    }

    if (!listingsData || listingsData.length === 0) {
      setListings([]);
      setLoading(false);
      return;
    }

    // Fetch first snapshots for price change calculation
    const listingIds = listingsData.map(l => l.id);
    const { data: snapshots } = await supabase
      .from('listing_snapshots')
      .select('listing_id, asking_price, seen_at')
      .in('listing_id', listingIds)
      .order('seen_at', { ascending: true });

    // Group snapshots by listing
    const snapshotsByListing: Record<string, { first_price: number | null; last_change_date: string | null }> = {};
    if (snapshots) {
      const grouped: Record<string, typeof snapshots> = {};
      snapshots.forEach(s => {
        if (!grouped[s.listing_id]) grouped[s.listing_id] = [];
        grouped[s.listing_id].push(s);
      });
      
      Object.entries(grouped).forEach(([listingId, snaps]) => {
        const firstWithPrice = snaps.find(s => s.asking_price != null);
        let lastChangeDate: string | null = null;
        
        for (let i = snaps.length - 1; i > 0; i--) {
          if (snaps[i].asking_price !== snaps[i - 1].asking_price) {
            lastChangeDate = snaps[i].seen_at;
            break;
          }
        }
        
        snapshotsByListing[listingId] = {
          first_price: firstWithPrice?.asking_price ?? null,
          last_change_date: lastChangeDate,
        };
      });
    }

    // Transform to TrapListing
    const now = new Date();
    const transformed: TrapListing[] = listingsData.map(l => {
      const firstSeenDate = new Date(l.first_seen_at);
      const daysOnMarket = Math.floor((now.getTime() - firstSeenDate.getTime()) / (1000 * 60 * 60 * 24));
      
      const snapshotInfo = snapshotsByListing[l.id] || { first_price: null, last_change_date: null };
      const firstPrice = snapshotInfo.first_price ?? l.asking_price;
      const currentPrice = l.asking_price;
      
      let priceChangeAmount: number | null = null;
      let priceChangePct: number | null = null;
      
      if (firstPrice && currentPrice && firstPrice !== currentPrice) {
        priceChangeAmount = currentPrice - firstPrice;
        priceChangePct = ((currentPrice - firstPrice) / firstPrice) * 100;
      }

      return {
        id: l.id,
        listing_id: l.listing_id,
        make: l.make,
        model: l.model,
        variant_family: l.variant_family,
        year: l.year,
        km: l.km,
        asking_price: l.asking_price,
        first_seen_at: l.first_seen_at,
        last_seen_at: l.last_seen_at,
        source: l.source,
        status: l.status,
        listing_url: l.listing_url,
        location: l.location,
        region_id: null,
        days_on_market: daysOnMarket,
        price_change_amount: priceChangeAmount,
        price_change_pct: priceChangePct,
        last_price_change_date: snapshotInfo.last_change_date,
        first_price: firstPrice,
        benchmark_price: null,
        benchmark_sample: null,
        delta_dollars: null,
        delta_pct: null,
        no_benchmark: true,
      };
    });

    const uniqueDealers = [...new Set(transformed.map(l => l.source))].sort();
    const uniqueMakes = [...new Set(transformed.map(l => l.make))].sort();
    const uniqueModels = [...new Set(transformed.map(l => l.model))].sort();

    setDealers(uniqueDealers);
    setMakes(uniqueMakes);
    setModels(uniqueModels);
    setListings(transformed);
    setLoading(false);
  };

  // Apply filters and sorting
  const filteredListings = useMemo(() => {
    let result = [...listings];

    // Apply preset first (overrides other filters)
    if (filters.preset === 'strong_buy') {
      result = result.filter(l => l.delta_pct !== null && l.delta_pct <= -15 && !l.no_benchmark);
    } else if (filters.preset === 'mispriced') {
      result = result.filter(l => l.delta_pct !== null && l.delta_pct <= -25 && !l.no_benchmark);
    } else if (filters.preset === '90_plus') {
      result = result.filter(l => l.days_on_market >= 90);
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
      if (filters.deltaBand === 'under_15') {
        result = result.filter(l => l.delta_pct !== null && l.delta_pct <= -15);
      } else if (filters.deltaBand === 'under_10') {
        result = result.filter(l => l.delta_pct !== null && l.delta_pct <= -10);
      } else if (filters.deltaBand === 'under_5') {
        result = result.filter(l => l.delta_pct !== null && l.delta_pct <= -5);
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
          aVal = a.price_change_amount ?? 0;
          bVal = b.price_change_amount ?? 0;
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
  }, [listings, filters]);

  const handleRowClick = (listing: TrapListing) => {
    setSelectedListing(listing);
    setDrawerOpen(true);
  };

  // Stats for header
  const stats = useMemo(() => {
    const withBenchmark = listings.filter(l => !l.no_benchmark);
    const strongBuys = withBenchmark.filter(l => l.delta_pct !== null && l.delta_pct <= -15);
    const aged90 = listings.filter(l => l.days_on_market >= 90);
    return { total: listings.length, withBenchmark: withBenchmark.length, strongBuys: strongBuys.length, aged90: aged90.length };
  }, [listings]);

  return (
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
                  {stats.strongBuys} strong buys • {stats.aged90} aged 90+
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
          />
        )}

        <TrapInventoryDrawer
          listing={selectedListing}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
        />
      </div>
    </AppLayout>
  );
}
