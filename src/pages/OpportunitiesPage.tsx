import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { OpportunityTable } from '@/components/opportunities/OpportunityTable';
import { OpportunityFiltersPanel } from '@/components/opportunities/OpportunityFilters';
import { AuctionLot, OpportunityFilters, SaleFingerprint } from '@/types';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/contexts/AuthContext';
import { Car, TrendingUp, AlertTriangle, Target, Zap } from 'lucide-react';
import { KitingLiveStrip, HuntOpportunityCard, WatchlistMovementCard } from '@/components/home';
import { useHomeDashboard } from '@/hooks/useHomeDashboard';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { KitingWingMarkVideo } from '@/components/kiting';

export default function OpportunitiesPage() {
  const { isAdmin, currentUser, dealerProfile } = useAuth();
  const [opportunities, setOpportunities] = useState<AuctionLot[]>([]);
  const [filteredOpportunities, setFilteredOpportunities] = useState<AuctionLot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterOptions, setFilterOptions] = useState({ auction_houses: [] as string[], locations: [] as string[], makes: [] as string[] });
  const [dealerFingerprints, setDealerFingerprints] = useState<SaleFingerprint[]>([]);
  
  // Kiting Mode data
  const { 
    opportunities: huntOpportunities, 
    kitingLive, 
    watchlist, 
    isLoading: kitingLoading,
    refresh: refreshKiting
  } = useHomeDashboard();

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

      // getOpportunities now returns filtered Auction_Lots
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

  // Hunt alerts counts
  const huntBuyCount = huntOpportunities.filter(o => o.severity === 'BUY').length;
  const huntWatchCount = huntOpportunities.filter(o => o.severity === 'WATCH').length;
  const hasKitingData = dealerProfile && (huntOpportunities.length > 0 || kitingLive.active_hunts > 0);

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <KitingWingMarkVideo size={48} />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Today's Opportunities</h1>
              <p className="text-muted-foreground mt-1">
                {filteredOpportunities.length + huntOpportunities.length} vehicles matching your criteria
              </p>
            </div>
          </div>
          {dealerProfile && (
            <Link to="/log-sale">
              <Button size="sm" className="gap-2">
                <Zap className="h-4 w-4" />
                Log Sale
              </Button>
            </Link>
          )}
        </div>

        {/* Kiting Live Strip - shows system activity */}
        {dealerProfile && (
          <KitingLiveStrip data={kitingLive} isLoading={kitingLoading} />
        )}

        {/* Hunt Opportunities - BUY/WATCH from Kiting Mode */}
        {huntOpportunities.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Kiting Mode Alerts
                {huntBuyCount > 0 && (
                  <span className="text-sm font-normal text-green-600">
                    ({huntBuyCount} BUY, {huntWatchCount} WATCH)
                  </span>
                )}
              </h2>
              <Link to="/hunts" className="text-sm text-primary hover:underline">
                View all hunts →
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {huntOpportunities.slice(0, 6).map((opp) => (
                <HuntOpportunityCard key={opp.alert_id} opportunity={opp} />
              ))}
            </div>
            {huntOpportunities.length > 6 && (
              <Link to="/hunts" className="block">
                <Button variant="outline" size="sm" className="w-full">
                  View all {huntOpportunities.length} kiting alerts
                </Button>
              </Link>
            )}
          </div>
        )}

        {/* Stats - combined */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <Car className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Buy Now</p>
              <p className="text-2xl font-bold text-primary mono">{buyCount + huntBuyCount}</p>
            </div>
          </div>
          
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-lg bg-action-watch/10">
              <AlertTriangle className="h-5 w-5 text-action-watch" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Watch List</p>
              <p className="text-2xl font-bold text-action-watch mono">{watchCount + huntWatchCount}</p>
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

          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Hunts</p>
              <p className="text-2xl font-bold text-primary mono">{kitingLive.active_hunts}</p>
            </div>
          </div>
        </div>

        {/* Watchlist Movement - show movement/staleness */}
        {dealerProfile && watchlist.length > 0 && (
          <WatchlistMovementCard items={watchlist} />
        )}

        {/* Filters */}
        <OpportunityFiltersPanel
          filters={filters}
          onFiltersChange={setFilters}
          filterOptions={filterOptions}
          onRefresh={() => { loadData(); refreshKiting(); }}
          isLoading={isLoading || kitingLoading}
        />

        {/* Auction Opportunities Table */}
        {filteredOpportunities.length > 0 && (
          <>
            <h2 className="text-lg font-semibold">Auction Opportunities</h2>
            <OpportunityTable
              opportunities={filteredOpportunities}
              isLoading={isLoading}
            />
          </>
        )}

        {/* Empty state - encourage activation */}
        {!isLoading && !kitingLoading && filteredOpportunities.length === 0 && huntOpportunities.length === 0 && (
          <div className="text-center py-12 border rounded-lg bg-muted/20">
            <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No opportunities yet</h3>
            <p className="text-muted-foreground mb-4 max-w-md mx-auto">
              {kitingLive.active_hunts === 0 
                ? "Log a sale to activate Kiting Mode and start hunting for replicas."
                : "Your hunts are active. Opportunities will appear when price exposure is detected."}
            </p>
            {kitingLive.active_hunts === 0 && (
              <Link to="/log-sale">
                <Button className="gap-2">
                  <Zap className="h-4 w-4" />
                  Log Your First Sale
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
