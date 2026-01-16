import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO, startOfDay, addDays } from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { Loader2, Search, Calendar, MapPin, AlertCircle } from 'lucide-react';
import { KitingWingMarkVideo } from '@/components/kiting';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { ProfitScoreBadge } from '@/components/auction/ProfitScoreBadge';
import { 
  HeatBadge, 
  HeatStrip, 
  getHeatCardClasses,
  LocationWarningBadge,
  LocationWarningMarker,
} from '@/components/auction/AuctionHeatIndicator';

const AEST_TIMEZONE = 'Australia/Sydney';
const MAX_DAYS_AHEAD = 14;

interface AuctionSummary {
  auction_house: string;
  auction_date: string;
  location: string | null;
  total_lots: number;
  eligible_lots: number;
  matching_lots: number;
  // Profit scoring fields (when feature enabled)
  profit_score?: number;
  profit_dense_count?: number;
  sample_size?: number;
  median_gp?: number | null;
  fingerprints?: string[];
  location_unknown?: boolean;
}

export default function UpcomingAuctionsPage() {
  const { dealerProfile } = useAuth();
  const navigate = useNavigate();
  const { isFeatureVisible } = useFeatureFlags();
  const profitScoringEnabled = isFeatureVisible('auctionProfitScoring');
  
  const [auctionHouseFilter, setAuctionHouseFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');

  // Fetch upcoming auction summaries directly from vehicle_listings
  const { data: auctions = [], isLoading, error } = useQuery({
    queryKey: ['upcomingAuctionSummaries', dealerProfile?.dealer_name],
    queryFn: async () => {
      // Get the current date in AEST
      const nowAest = toZonedTime(new Date(), AEST_TIMEZONE);
      const todayStart = startOfDay(nowAest);
      const maxDate = addDays(todayStart, MAX_DAYS_AHEAD);
      
      // Format dates for SQL query
      const todayIso = todayStart.toISOString();
      const maxDateIso = maxDate.toISOString();

      // Query vehicle_listings for auction summaries
      const { data, error } = await supabase
        .from('vehicle_listings')
        .select('auction_house, auction_datetime, location, is_dealer_grade, lifecycle_state, excluded_reason, make, model, year')
        .eq('source_class', 'auction')
        .gte('auction_datetime', todayIso)
        .lte('auction_datetime', maxDateIso)
        .not('auction_datetime', 'is', null);

      if (error) throw error;

      // Aggregate by auction_house + date + location
      const summaryMap = new Map<string, AuctionSummary>();
      
      (data || []).forEach((lot) => {
        if (!lot.auction_datetime || !lot.auction_house) return;
        
        // Parse auction date in AEST
        const auctionDate = parseISO(lot.auction_datetime);
        const dateKey = formatInTimeZone(auctionDate, AEST_TIMEZONE, 'yyyy-MM-dd');
        const location = lot.location || 'Unknown';
        const key = `${lot.auction_house}|${dateKey}|${location}`;
        
        if (!summaryMap.has(key)) {
          summaryMap.set(key, {
            auction_house: lot.auction_house,
            auction_date: dateKey,
            location: location,
            total_lots: 0,
            eligible_lots: 0,
            matching_lots: 0,
          });
        }
        
        const summary = summaryMap.get(key)!;
        summary.total_lots++;
        
        // Check if lot is eligible (dealer-grade, not excluded, not in terminal state)
        const isEligible = 
          lot.is_dealer_grade === true &&
          !lot.excluded_reason &&
          !['AVOID', 'SOLD', 'CLEARED'].includes(lot.lifecycle_state || '');
        
        if (isEligible) {
          summary.eligible_lots++;
          
          // TODO: Check if lot matches dealer fingerprints (simplified for now)
          // For now, count all eligible as matching
          summary.matching_lots++;
        }
      });

      return Array.from(summaryMap.values()).sort((a, b) => {
        // Sort by date first, then auction house, then location
        const dateCompare = a.auction_date.localeCompare(b.auction_date);
        if (dateCompare !== 0) return dateCompare;
        const houseCompare = a.auction_house.localeCompare(b.auction_house);
        if (houseCompare !== 0) return houseCompare;
        return (a.location || '').localeCompare(b.location || '');
      });
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const houses = new Set<string>();
    const locations = new Set<string>();
    
    auctions.forEach((a) => {
      houses.add(a.auction_house);
      if (a.location) locations.add(a.location);
    });
    
    return {
      auctionHouses: Array.from(houses).sort(),
      locations: Array.from(locations).sort(),
    };
  }, [auctions]);

  // Filter auctions
  const filteredAuctions = useMemo(() => {
    return auctions.filter((auction) => {
      if (auctionHouseFilter !== 'all' && auction.auction_house !== auctionHouseFilter) return false;
      if (locationFilter !== 'all' && auction.location !== locationFilter) return false;
      return true;
    });
  }, [auctions, auctionHouseFilter, locationFilter]);

  // Group auctions by date
  const groupedAuctions = useMemo(() => {
    const groups: Record<string, AuctionSummary[]> = {};
    
    filteredAuctions.forEach((auction) => {
      if (!groups[auction.auction_date]) {
        groups[auction.auction_date] = [];
      }
      groups[auction.auction_date].push(auction);
    });
    
    return groups;
  }, [filteredAuctions]);

  const formatDateHeader = (dateKey: string) => {
    const date = parseISO(dateKey);
    const today = startOfDay(toZonedTime(new Date(), AEST_TIMEZONE));
    const tomorrow = addDays(today, 1);
    
    if (format(date, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd')) {
      return 'Today';
    }
    if (format(date, 'yyyy-MM-dd') === format(tomorrow, 'yyyy-MM-dd')) {
      return 'Tomorrow';
    }
    return format(date, 'EEEE, d MMMM');
  };

  const handleViewLots = (auction: AuctionSummary) => {
    const params = new URLSearchParams();
    params.set('auction_house', auction.auction_house);
    if (auction.location) params.set('location', auction.location);
    params.set('date', auction.auction_date);
    navigate(`/search-lots?${params.toString()}`);
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <KitingWingMarkVideo size={48} />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Upcoming Auctions</h1>
              <p className="text-sm text-muted-foreground">
                Next {MAX_DAYS_AHEAD} days • {filteredAuctions.length} auction{filteredAuctions.length !== 1 ? 's' : ''} found
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
          <Select value={auctionHouseFilter} onValueChange={setAuctionHouseFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Auction House" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Auction Houses</SelectItem>
              {filterOptions.auctionHouses.map((house) => (
                <SelectItem key={house} value={house}>{house}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {filterOptions.locations.map((loc) => (
                <SelectItem key={loc} value={loc}>{loc}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-destructive gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>Failed to load auctions</p>
          </div>
        ) : Object.keys(groupedAuctions).length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No upcoming auctions in your active window
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                There are no auctions scheduled in the next {MAX_DAYS_AHEAD} days matching your filters.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedAuctions).map(([dateKey, dayAuctions]) => (
              <div key={dateKey} className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground border-b border-border pb-2 flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  {formatDateHeader(dateKey)}
                  <Badge variant="secondary" className="ml-auto">
                    {dayAuctions.reduce((sum, a) => sum + a.eligible_lots, 0)} eligible lots
                  </Badge>
                </h2>
                
                <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {dayAuctions.map((auction) => {
                    const hasLots = auction.eligible_lots > 0;
                    const isUnknownLocation = auction.location === 'Unknown' || !auction.location;
                    const heatGlow = getHeatCardClasses(auction.matching_lots);
                    
                    return (
                      <Card 
                        key={`${auction.auction_house}-${auction.auction_date}-${auction.location}`}
                        className={`relative overflow-hidden ${!hasLots ? 'opacity-60' : ''} ${heatGlow}`}
                      >
                        {/* Heat strip - left border indicator */}
                        <HeatStrip relevantCount={auction.matching_lots} />
                        
                        {/* Unknown location corner marker */}
                        <LocationWarningMarker location={auction.location} />
                        
                        <CardContent className="p-3 sm:p-4 pl-5 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-foreground text-sm sm:text-base truncate">
                                {auction.auction_house}
                              </h3>
                              <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                                <MapPin className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{auction.location || 'Unknown'}</span>
                              </div>
                              {/* Unknown location warning badge */}
                              {isUnknownLocation && (
                                <div className="mt-1.5">
                                  <LocationWarningBadge location={auction.location} />
                                </div>
                              )}
                            </div>
                            {/* Heat indicator - profit-weighted or tier-based */}
                            {profitScoringEnabled && auction.profit_score !== undefined ? (
                              <ProfitScoreBadge
                                score={auction.profit_score}
                                profitDenseCount={auction.profit_dense_count || 0}
                                sampleSize={auction.sample_size || 0}
                                medianGp={auction.median_gp}
                                compact
                              />
                            ) : (
                              <HeatBadge relevantCount={auction.matching_lots} />
                            )}
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge variant="outline" className="text-xs">
                              {auction.total_lots} total
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {auction.eligible_lots} eligible
                            </Badge>
                            {profitScoringEnabled && auction.profit_dense_count !== undefined && auction.profit_dense_count > 0 && (
                              <Badge variant="default" className="text-xs">
                                {auction.profit_dense_count} high-profit
                              </Badge>
                            )}
                          </div>
                          
                          <div className="flex gap-2">
                            {hasLots ? (
                              <Button
                                variant="default"
                                size="sm"
                                className="flex-1 gap-2"
                                onClick={() => handleViewLots(auction)}
                              >
                                <Search className="h-4 w-4" />
                                View Lots
                              </Button>
                            ) : (
                              <div className="flex-1 text-center text-sm text-muted-foreground py-2">
                                No eligible lots
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
