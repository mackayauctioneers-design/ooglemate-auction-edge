import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { OpportunityTable } from '@/components/opportunities/OpportunityTable';
import { OpportunityFiltersPanel } from '@/components/opportunities/OpportunityFilters';
import { AuctionOpportunity, OpportunityFilters, SaleFingerprint } from '@/types';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/contexts/AuthContext';
import { Car, TrendingUp, AlertTriangle } from 'lucide-react';

export default function OpportunitiesPage() {
  const { isAdmin, currentUser } = useAuth();
  const [opportunities, setOpportunities] = useState<AuctionOpportunity[]>([]);
  const [filteredOpportunities, setFilteredOpportunities] = useState<AuctionOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterOptions, setFilterOptions] = useState({ auction_houses: [] as string[], locations: [] as string[], makes: [] as string[] });
  const [dealerFingerprints, setDealerFingerprints] = useState<SaleFingerprint[]>([]);
  
  const [filters, setFilters] = useState<OpportunityFilters>({
    auction_house: null,
    action: null,
    pass_count_min: null,
    location: null,
    margin_min: null,
    margin_max: null,
    show_all: false,
  });

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load dealer fingerprints if not admin
      let fingerprints: SaleFingerprint[] = [];
      if (!isAdmin && currentUser) {
        fingerprints = await dataService.getDealerFingerprints(currentUser.dealer_name);
        setDealerFingerprints(fingerprints);
      }

      const opps = await dataService.getOpportunities(isAdmin, isAdmin ? undefined : fingerprints);
      setOpportunities(opps);
      
      const options = await dataService.getFilterOptions();
      setFilterOptions(options);
    } catch (error) {
      console.error('Failed to load opportunities:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Apply client-side filters
  useEffect(() => {
    let filtered = [...opportunities];

    if (filters.auction_house) {
      filtered = filtered.filter(o => o.auction_house === filters.auction_house);
    }
    if (filters.action) {
      filtered = filtered.filter(o => o.action === filters.action);
    }
    if (filters.pass_count_min) {
      filtered = filtered.filter(o => o.pass_count >= filters.pass_count_min!);
    }
    if (filters.location) {
      filtered = filtered.filter(o => o.location === filters.location);
    }
    if (filters.margin_min) {
      filtered = filtered.filter(o => o.estimated_margin >= filters.margin_min!);
    }
    if (filters.margin_max) {
      filtered = filtered.filter(o => o.estimated_margin <= filters.margin_max!);
    }

    setFilteredOpportunities(filtered);
  }, [opportunities, filters]);

  // Calculate stats
  const buyCount = filteredOpportunities.filter(o => o.action === 'Buy').length;
  const watchCount = filteredOpportunities.filter(o => o.action === 'Watch').length;
  const avgMargin = filteredOpportunities.length > 0
    ? Math.round(filteredOpportunities.reduce((sum, o) => sum + o.estimated_margin, 0) / filteredOpportunities.length)
    : 0;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Today's Opportunities</h1>
            <p className="text-muted-foreground mt-1">
              {filteredOpportunities.length} vehicles matching your criteria
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <Car className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Buy Now</p>
              <p className="text-2xl font-bold text-primary mono">{buyCount}</p>
            </div>
          </div>
          
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-lg bg-action-watch/10">
              <AlertTriangle className="h-5 w-5 text-action-watch" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Watch List</p>
              <p className="text-2xl font-bold text-action-watch mono">{watchCount}</p>
            </div>
          </div>
          
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-lg bg-accent/10">
              <TrendingUp className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg Margin</p>
              <p className="text-2xl font-bold text-foreground mono">
                ${avgMargin.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <OpportunityFiltersPanel
          filters={filters}
          onFiltersChange={setFilters}
          filterOptions={filterOptions}
          onRefresh={loadData}
          isLoading={isLoading}
        />

        {/* Table */}
        <OpportunityTable
          opportunities={filteredOpportunities}
          isLoading={isLoading}
        />
      </div>
    </AppLayout>
  );
}
