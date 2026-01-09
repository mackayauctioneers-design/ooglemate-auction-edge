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
  // Computed fields
  days_on_market: number;
  price_change_amount: number | null;
  price_change_pct: number | null;
  last_price_change_date: string | null;
  first_price: number | null;
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
    sortBy: 'days_on_market',
    sortDir: 'desc',
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
    
    // Fetch trap listings (classifieds from dealer traps)
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
        
        // Find last price change
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
        days_on_market: daysOnMarket,
        price_change_amount: priceChangeAmount,
        price_change_pct: priceChangePct,
        last_price_change_date: snapshotInfo.last_change_date,
        first_price: firstPrice,
      };
    });

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

  // Apply filters and sorting
  const filteredListings = useMemo(() => {
    let result = [...listings];

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

    // Sort
    result.sort((a, b) => {
      let aVal: number | null = null;
      let bVal: number | null = null;

      switch (filters.sortBy) {
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
      return filters.sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });

    return result;
  }, [listings, filters]);

  const handleRowClick = (listing: TrapListing) => {
    setSelectedListing(listing);
    setDrawerOpen(true);
  };

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
              Monitor retail stock from dealer traps – track price decay and identify wholesale opportunities
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            {!loading && `${filteredListings.length} listings`}
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
