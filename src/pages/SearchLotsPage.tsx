import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { format, parseISO, addDays, isAfter, isBefore, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { Search, Plus, Upload, Loader2, ExternalLink, FlaskConical, Clock, FileSpreadsheet, Ban, X, Bug, RotateCcw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/contexts/AuthContext';
import { AuctionLot, formatCurrency, formatNumber, getPressureSignals } from '@/types';
import { LotDetailDrawer } from '@/components/lots/LotDetailDrawer';
import { LotEditor } from '@/components/lots/LotEditor';
import { LotCsvImport } from '@/components/lots/LotCsvImport';
import { PicklesCatalogueImport } from '@/components/lots/PicklesCatalogueImport';
import { LifecycleTest } from '@/components/lots/LifecycleTest';
import { ValoButton } from '@/components/valo/ValoButton';

const AEST_TIMEZONE = 'Australia/Sydney';

type DateRangeFilter = 'today' | 'next7' | 'next14' | 'all';

// Interface for active filters display
interface ActiveFilter {
  key: string;
  label: string;
  value: string;
  onClear: () => void;
}

export default function SearchLotsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  // Get initial filters from URL params (for linking from Upcoming Auctions)
  const initialAuctionHouse = searchParams.get('auction_house') || 'all';
  const initialLocation = searchParams.get('location') || 'all';
  const initialSpecificDate = searchParams.get('date') || ''; // Specific date from Upcoming Auctions

  const [searchQuery, setSearchQuery] = useState('');
  const [auctionHouseFilter, setAuctionHouseFilter] = useState(initialAuctionHouse);
  const [locationFilter, setLocationFilter] = useState(initialLocation);
  const [specificDateFilter, setSpecificDateFilter] = useState(initialSpecificDate); // yyyy-MM-dd format
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>(initialSpecificDate ? 'all' : 'all');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [kmMax, setKmMax] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [passCountFilter, setPassCountFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [marginMin, setMarginMin] = useState('');
  const [showDebug, setShowDebug] = useState(false); // Admin debug toggle
  // Multi-source filters
  const [sourceTypeFilter, setSourceTypeFilter] = useState('all');
  const [sourceNameFilter, setSourceNameFilter] = useState('all');
  const [showExcluded, setShowExcluded] = useState(false); // Admin only - show excluded lots

  const [selectedLot, setSelectedLot] = useState<AuctionLot | null>(null);
  const [editingLot, setEditingLot] = useState<AuctionLot | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportingCatalogue, setIsImportingCatalogue] = useState(false);
  const [showLifecycleTest, setShowLifecycleTest] = useState(false);

  const { data: lots = [], isLoading } = useQuery({
    queryKey: ['auctionLots', isAdmin],
    queryFn: () => dataService.getLots(isAdmin),
  });

  const { data: filterOptions } = useQuery({
    queryKey: ['lotFilterOptions'],
    queryFn: () => dataService.getLotFilterOptions(),
  });

  // Clear all filters and reload data
  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setAuctionHouseFilter('all');
    setLocationFilter('all');
    setSpecificDateFilter('');
    setDateRangeFilter('all');
    setYearMin('');
    setYearMax('');
    setKmMax('');
    setStatusFilter('all');
    setPassCountFilter('all');
    setActionFilter('all');
    setMarginMin('');
    setSourceTypeFilter('all');
    setSourceNameFilter('all');
    setShowExcluded(false);
  }, []);

  const resetAndReload = useCallback(() => {
    clearAllFilters();
    queryClient.invalidateQueries({ queryKey: ['auctionLots'] });
    queryClient.invalidateQueries({ queryKey: ['lotFilterOptions'] });
  }, [clearAllFilters, queryClient]);

  // Get list of active filters for chips display
  const activeFilters = useMemo((): ActiveFilter[] => {
    const filters: ActiveFilter[] = [];
    
    if (searchQuery) {
      filters.push({ key: 'search', label: 'Search', value: `"${searchQuery}"`, onClear: () => setSearchQuery('') });
    }
    if (sourceTypeFilter !== 'all') {
      filters.push({ key: 'sourceType', label: 'Type', value: sourceTypeFilter, onClear: () => setSourceTypeFilter('all') });
    }
    if (sourceNameFilter !== 'all') {
      filters.push({ key: 'sourceName', label: 'Source', value: sourceNameFilter, onClear: () => setSourceNameFilter('all') });
    }
    if (locationFilter !== 'all') {
      filters.push({ key: 'location', label: 'Location', value: locationFilter, onClear: () => setLocationFilter('all') });
    }
    if (auctionHouseFilter !== 'all') {
      filters.push({ key: 'auctionHouse', label: 'Auction', value: auctionHouseFilter, onClear: () => setAuctionHouseFilter('all') });
    }
    if (specificDateFilter) {
      filters.push({ key: 'specificDate', label: 'Date', value: specificDateFilter, onClear: () => setSpecificDateFilter('') });
    } else if (dateRangeFilter !== 'all') {
      const dateLabels = { today: 'Today', next7: 'Next 7 Days', next14: 'Next 14 Days' };
      filters.push({ key: 'date', label: 'Date', value: dateLabels[dateRangeFilter], onClear: () => setDateRangeFilter('all') });
    }
    if (statusFilter !== 'all') {
      filters.push({ key: 'status', label: 'Status', value: statusFilter, onClear: () => setStatusFilter('all') });
    }
    if (passCountFilter !== 'all') {
      filters.push({ key: 'passCount', label: 'Passes', value: passCountFilter === '2plus' ? '2+' : '3+', onClear: () => setPassCountFilter('all') });
    }
    if (actionFilter !== 'all') {
      filters.push({ key: 'action', label: 'Action', value: actionFilter, onClear: () => setActionFilter('all') });
    }
    if (yearMin) {
      filters.push({ key: 'yearMin', label: 'Min Year', value: yearMin, onClear: () => setYearMin('') });
    }
    if (yearMax) {
      filters.push({ key: 'yearMax', label: 'Max Year', value: yearMax, onClear: () => setYearMax('') });
    }
    if (kmMax) {
      filters.push({ key: 'kmMax', label: 'Max KM', value: formatNumber(parseInt(kmMax)), onClear: () => setKmMax('') });
    }
    if (marginMin) {
      filters.push({ key: 'marginMin', label: 'Min Margin', value: `$${marginMin}`, onClear: () => setMarginMin('') });
    }
    if (showExcluded) {
      filters.push({ key: 'showExcluded', label: 'Showing Excluded', value: 'Yes', onClear: () => setShowExcluded(false) });
    }
    
    return filters;
  }, [searchQuery, sourceTypeFilter, sourceNameFilter, auctionHouseFilter, locationFilter, specificDateFilter, dateRangeFilter, statusFilter, passCountFilter, actionFilter, yearMin, yearMax, kmMax, marginMin, showExcluded]);

  // Filter and sort lots
  const filteredLots = useMemo(() => {
    const now = startOfDay(new Date());
    const minMargin = parseInt(marginMin) || 0;
    const minYear = parseInt(yearMin) || 0;
    const maxYear = parseInt(yearMax) || 9999;
    const maxKm = parseInt(kmMax) || Infinity;

    return lots
      .filter((lot) => {
        // Exclusion filter: hide excluded lots from dealers, show for admins only if toggled
        if (lot.excluded_reason) {
          if (!isAdmin) return false; // Dealers never see excluded lots
          if (!showExcluded) return false; // Admin toggle to show/hide
        }
        
        // Margin filter (default 1000) - skip for excluded lots being shown
        if (!lot.excluded_reason && lot.estimated_margin < minMargin) return false;

        // FIXED: Keyword search - case-insensitive match across multiple fields
        if (searchQuery) {
          const q = searchQuery.toLowerCase().trim();
          const searchableFields = [
            lot.lot_id,
            lot.auction_house,
            lot.location,
            lot.make,
            lot.model,
            lot.variant_raw,
            lot.variant_normalised,
            lot.source,
            lot.source_site,
            lot.source_type,
            lot.source_name
          ];
          
          // Normalize and trim all fields, then check if query matches any
          const matchFound = searchableFields.some(field => {
            if (!field) return false;
            return field.toString().toLowerCase().trim().includes(q);
          });
          
          if (!matchFound) return false;
        }

        // Specific date filter (from Upcoming Auctions linking)
        if (specificDateFilter && lot.auction_datetime) {
          const lotDate = parseISO(lot.auction_datetime);
          const lotDateKey = format(toZonedTime(lotDate, AEST_TIMEZONE), 'yyyy-MM-dd');
          if (lotDateKey !== specificDateFilter) return false;
        }
        
        // Date range filter (only applies if no specific date is set)
        if (!specificDateFilter && lot.auction_datetime) {
          const lotDate = parseISO(lot.auction_datetime);
          if (dateRangeFilter === 'today') {
            const tomorrow = addDays(now, 1);
            if (isBefore(lotDate, now) || isAfter(lotDate, tomorrow)) return false;
          } else if (dateRangeFilter === 'next7') {
            const cutoff = addDays(now, 7);
            if (isBefore(lotDate, now) || isAfter(lotDate, cutoff)) return false;
          } else if (dateRangeFilter === 'next14') {
            const cutoff = addDays(now, 14);
            if (isBefore(lotDate, now) || isAfter(lotDate, cutoff)) return false;
          }
        }

        // Other filters - only apply if not set to 'all'
        if (auctionHouseFilter !== 'all' && lot.auction_house !== auctionHouseFilter) return false;
        if (locationFilter !== 'all' && lot.location !== locationFilter) return false;
        if (statusFilter !== 'all' && lot.status !== statusFilter) return false;
        if (actionFilter !== 'all' && lot.action !== actionFilter) return false;

        // Source filters
        if (sourceTypeFilter !== 'all' && lot.source_type !== sourceTypeFilter) return false;
        if (sourceNameFilter !== 'all' && lot.source_name !== sourceNameFilter) return false;

        // Pass count filter - only relevant for auctions
        if (passCountFilter !== 'all') {
          if (sourceTypeFilter === 'all' || sourceTypeFilter === 'auction') {
            if (passCountFilter === '2plus' && lot.pass_count < 2) return false;
            if (passCountFilter === '3plus' && lot.pass_count < 3) return false;
          }
        }

        if (lot.year < minYear || lot.year > maxYear) return false;
        if (lot.km > maxKm) return false;

        return true;
      })
      .sort((a, b) => {
        // Excluded lots sort last
        if (a.excluded_reason && !b.excluded_reason) return 1;
        if (!a.excluded_reason && b.excluded_reason) return -1;
        // Sort by auction_datetime ascending, then estimated_margin descending
        const dateA = a.auction_datetime ? parseISO(a.auction_datetime).getTime() : 0;
        const dateB = b.auction_datetime ? parseISO(b.auction_datetime).getTime() : 0;
        if (dateA !== dateB) return dateA - dateB;
        return b.estimated_margin - a.estimated_margin;
      });
  }, [lots, searchQuery, auctionHouseFilter, locationFilter, specificDateFilter, dateRangeFilter, yearMin, yearMax, kmMax, statusFilter, passCountFilter, actionFilter, marginMin, sourceTypeFilter, sourceNameFilter, isAdmin, showExcluded]);

  // Count excluded lots for admin indicator
  const excludedCount = useMemo(() => lots.filter(l => l.excluded_reason).length, [lots]);

  // Determine if auction-specific filters should be shown
  const showAuctionFilters = sourceTypeFilter === 'all' || sourceTypeFilter === 'auction';

  const handleDataChanged = () => {
    queryClient.invalidateQueries({ queryKey: ['auctionLots'] });
    queryClient.invalidateQueries({ queryKey: ['lotFilterOptions'] });
    setEditingLot(null);
    setIsCreating(false);
    setIsImporting(false);
    setIsImportingCatalogue(false);
  };

  const formatLotDate = (datetime: string) => {
    if (!datetime) return '-';
    try {
      const date = parseISO(datetime);
      const aestDate = toZonedTime(date, AEST_TIMEZONE);
      return format(aestDate, 'dd/MM/yy HH:mm');
    } catch {
      return datetime;
    }
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Search Lots</h1>
            <p className="text-sm text-muted-foreground">
              {filteredLots.length} lots found
              {isAdmin && excludedCount > 0 && (
                <span className="ml-2 text-destructive">({excludedCount} excluded)</span>
              )}
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => setShowLifecycleTest(true)} 
                className="gap-2"
                title="Run Lifecycle Test"
              >
                <FlaskConical className="h-4 w-4" />
                <span className="hidden sm:inline">Run Lifecycle Test</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Upload className="h-4 w-4" />
                    <span className="hidden sm:inline">Import</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setIsImporting(true)} className="gap-2">
                    <Upload className="h-4 w-4" />
                    CSV Import
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsImportingCatalogue(true)} className="gap-2">
                    <FileSpreadsheet className="h-4 w-4" />
                    Pickles Catalogue
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={() => setIsCreating(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Add Lot</span>
              </Button>
            </div>
          )}
        </div>

        {/* Search & Filters */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search make, model, variant..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {/* Source Type Filter */}
            <Select value={sourceTypeFilter} onValueChange={setSourceTypeFilter}>
              <SelectTrigger className="w-full text-xs sm:text-sm">
                <SelectValue placeholder="Source Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {filterOptions?.source_types.map((t) => (
                  <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Source Name Filter */}
            <Select value={sourceNameFilter} onValueChange={setSourceNameFilter}>
              <SelectTrigger className="w-full text-xs sm:text-sm">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {filterOptions?.source_names.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-full text-xs sm:text-sm">
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {filterOptions?.locations.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={dateRangeFilter} onValueChange={(v) => setDateRangeFilter(v as DateRangeFilter)}>
              <SelectTrigger className="w-full text-xs sm:text-sm">
                <SelectValue placeholder="Date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="next7">Next 7 Days</SelectItem>
                <SelectItem value="next14">Next 14 Days</SelectItem>
                <SelectItem value="all">All Dates</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full text-xs sm:text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="listed">Listed</SelectItem>
                <SelectItem value="passed_in">Passed In</SelectItem>
                <SelectItem value="sold">Sold</SelectItem>
                <SelectItem value="withdrawn">Withdrawn</SelectItem>
              </SelectContent>
            </Select>

            {/* Pass count filter - only show for auctions or all */}
            {showAuctionFilters && (
              <Select value={passCountFilter} onValueChange={setPassCountFilter}>
                <SelectTrigger className="w-full text-xs sm:text-sm">
                  <SelectValue placeholder="Pass Count" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Passes</SelectItem>
                  <SelectItem value="2plus">2+ Passes</SelectItem>
                  <SelectItem value="3plus">3+ Passes</SelectItem>
                </SelectContent>
              </Select>
            )}

            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-full text-xs sm:text-sm">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="Buy">Buy</SelectItem>
                <SelectItem value="Watch">Watch</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Input
              type="number"
              placeholder="Min year"
              value={yearMin}
              onChange={(e) => setYearMin(e.target.value)}
              className="text-xs sm:text-sm"
            />
            <Input
              type="number"
              placeholder="Max year"
              value={yearMax}
              onChange={(e) => setYearMax(e.target.value)}
              className="text-xs sm:text-sm"
            />
            <Input
              type="number"
              placeholder="Max km"
              value={kmMax}
              onChange={(e) => setKmMax(e.target.value)}
              className="text-xs sm:text-sm"
            />
            <Input
              type="number"
              placeholder="Min margin"
              value={marginMin}
              onChange={(e) => setMarginMin(e.target.value)}
              className="text-xs sm:text-sm"
            />
          </div>
          
          {/* Active Filters Chips + Clear All */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Active filters:</span>
              {activeFilters.map((filter) => (
                <Badge 
                  key={filter.key} 
                  variant="secondary" 
                  className="gap-1 pl-2 pr-1 py-1 cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors"
                  onClick={filter.onClear}
                >
                  <span className="text-xs font-normal">{filter.label}:</span>
                  <span className="text-xs font-medium">{filter.value}</span>
                  <X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                Clear all
              </Button>
            </div>
          )}
          
          {/* Admin: Show Excluded Toggle + Debug Toggle */}
          {isAdmin && (
            <div className="flex items-center gap-2">
              {excludedCount > 0 && (
                <Button
                  variant={showExcluded ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => setShowExcluded(!showExcluded)}
                  className="gap-2"
                >
                  <Ban className="h-4 w-4" />
                  {showExcluded ? `Hide ${excludedCount} Excluded` : `Show ${excludedCount} Excluded`}
                </Button>
              )}
              <Button
                variant={showDebug ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setShowDebug(!showDebug)}
                className="gap-2"
              >
                <Bug className="h-4 w-4" />
                Debug
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={resetAndReload}
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Reset & Reload
              </Button>
            </div>
          )}

          {/* Admin Debug Panel */}
          {isAdmin && showDebug && (
            <div className="bg-muted/50 border rounded-lg p-4 space-y-3 text-sm font-mono">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Bug className="h-4 w-4" />
                Debug Panel
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground mb-1">Total lots loaded (before filters):</p>
                  <p className="text-lg font-bold text-foreground">{lots.length}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Filtered results:</p>
                  <p className="text-lg font-bold text-foreground">{filteredLots.length}</p>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Active filter state:</p>
                <pre className="bg-background p-2 rounded border text-xs overflow-x-auto">
{JSON.stringify({
  searchQuery: searchQuery || '(empty)',
  sourceTypeFilter,
  sourceNameFilter,
  locationFilter,
  dateRangeFilter,
  statusFilter,
  passCountFilter,
  actionFilter,
  yearMin: yearMin || '(any)',
  yearMax: yearMax || '(any)',
  kmMax: kmMax || '(any)',
  marginMin: marginMin || '(any)',
  showExcluded
}, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">First 10 loaded lots (make/model/variant):</p>
                <div className="bg-background p-2 rounded border text-xs max-h-40 overflow-y-auto">
                  {lots.slice(0, 10).map((lot, i) => (
                    <div key={lot.lot_key || lot.listing_key || i} className="py-0.5">
                      <span className="text-primary">{i + 1}.</span> {lot.make} {lot.model} {lot.variant_normalised || lot.variant_raw || '-'} (margin: {lot.estimated_margin})
                    </div>
                  ))}
                  {lots.length === 0 && <span className="text-muted-foreground">No lots loaded</span>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Lots Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredLots.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No lots found for the selected filters.
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs whitespace-nowrap">Source</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Date</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Location</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Make</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Model</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Variant</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-right">Year</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-right">KM</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-right">Price</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-right">Margin</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-center">Score</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-center">Action</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-center">VALO</TableHead>
                    <TableHead className="text-xs whitespace-nowrap"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLots.map((lot) => {
                    const isExcluded = !!lot.excluded_reason;
                    
                    return (
                      <TableRow
                        key={lot.lot_key || lot.listing_key || lot.lot_id}
                        className={`cursor-pointer hover:bg-muted/30 ${isExcluded ? 'opacity-50 bg-muted/20' : ''}`}
                        onClick={() => setSelectedLot(lot)}
                      >
                        <TableCell className="text-xs whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-col">
                              <span className="font-medium">{lot.source_name || lot.auction_house}</span>
                              <span className="text-muted-foreground capitalize">{lot.source_type || 'auction'}</span>
                            </div>
                            {isExcluded && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="destructive" className="gap-1 text-[10px] px-1.5 py-0">
                                      <Ban className="h-2.5 w-2.5" />
                                      EXCLUDED
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <span>Excluded: {lot.excluded_keyword || 'condition risk'}</span>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatLotDate(lot.auction_datetime)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{lot.location}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap font-medium">{lot.make}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{lot.model}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap max-w-[120px] truncate">{lot.variant_normalised || lot.variant_raw}</TableCell>
                        <TableCell className="text-xs text-right">{lot.year || '-'}</TableCell>
                        <TableCell className="text-xs text-right">{lot.km ? formatNumber(lot.km) : '-'}</TableCell>
                        <TableCell className="text-xs text-right">{lot.price_current || lot.reserve ? formatCurrency(lot.price_current || lot.reserve) : '-'}</TableCell>
                        <TableCell className="text-xs text-right font-medium text-emerald-500">{isExcluded ? '-' : formatCurrency(lot.estimated_margin)}</TableCell>
                        <TableCell className="text-xs text-center">{isExcluded ? '-' : lot.confidence_score}</TableCell>
                        <TableCell className="text-center">
                          {isExcluded ? (
                            <Badge variant="outline" className="text-muted-foreground border-muted">N/A</Badge>
                          ) : (() => {
                            const isWaitingForPressure = lot.confidence_score >= 4 && lot.action === 'Watch' && !getPressureSignals(lot).hasPressure;
                            
                            if (isWaitingForPressure) {
                              return (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-500">
                                        <Clock className="h-3 w-3" />
                                        Watch
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <span>Waiting for pressure signal (pass ≥2, days ≥14, or reserve drop ≥5%)</span>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              );
                            }
                            
                            return (
                              <Badge
                                variant={lot.action === 'Buy' ? 'default' : 'secondary'}
                                className={lot.action === 'Buy' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}
                              >
                                {lot.action}
                              </Badge>
                            );
                          })()}
                        </TableCell>
                        {/* VALO Button */}
                        <TableCell className="text-center">
                          {!isExcluded && (
                            <ValoButton lot={lot} />
                          )}
                        </TableCell>
                        {/* External Link */}
                        <TableCell>
                          {lot.listing_url && lot.invalid_source !== 'Y' && !isExcluded ? (
                            <Button
                              variant="ghost"
                              size="iconSm"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(lot.listing_url, '_blank');
                              }}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          ) : lot.listing_url && !isExcluded ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="iconSm"
                                    className="opacity-50 cursor-not-allowed"
                                    disabled
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Source link unavailable</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}</TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Detail Drawer */}
        {selectedLot && (
          <LotDetailDrawer
            lot={selectedLot}
            isAdmin={isAdmin}
            onClose={() => setSelectedLot(null)}
            onEdit={() => {
              setEditingLot(selectedLot);
              setSelectedLot(null);
            }}
            onUpdated={handleDataChanged}
          />
        )}

        {/* Lot Editor */}
        {(editingLot || isCreating) && (
          <LotEditor
            lot={editingLot}
            onClose={() => {
              setEditingLot(null);
              setIsCreating(false);
            }}
            onSaved={handleDataChanged}
          />
        )}

        {/* CSV Import */}
        {isImporting && (
          <LotCsvImport
            onClose={() => setIsImporting(false)}
            onImported={handleDataChanged}
          />
        )}

        {/* Pickles Catalogue Import */}
        {isImportingCatalogue && (
          <PicklesCatalogueImport
            onClose={() => setIsImportingCatalogue(false)}
            onImported={handleDataChanged}
          />
        )}

        {/* Lifecycle Test (Admin Only) */}
        <LifecycleTest
          open={showLifecycleTest}
          onOpenChange={setShowLifecycleTest}
          onComplete={handleDataChanged}
        />
      </div>
    </AppLayout>
  );
}
