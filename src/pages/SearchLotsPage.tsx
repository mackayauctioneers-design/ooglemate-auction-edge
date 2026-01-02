import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { format, parseISO, addDays, isAfter, isBefore, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { Search, Plus, Upload, Loader2, ExternalLink, FlaskConical, Clock, FileSpreadsheet } from 'lucide-react';
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

const AEST_TIMEZONE = 'Australia/Sydney';

type DateRangeFilter = 'today' | 'next7' | 'next14' | 'all';

export default function SearchLotsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  // Get initial filters from URL params (for linking from Upcoming Auctions)
  const initialAuctionHouse = searchParams.get('auction_house') || 'all';
  const initialLocation = searchParams.get('location') || 'all';
  const initialDate = searchParams.get('date') || '';

  const [searchQuery, setSearchQuery] = useState('');
  const [auctionHouseFilter, setAuctionHouseFilter] = useState(initialAuctionHouse);
  const [locationFilter, setLocationFilter] = useState(initialLocation);
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>(initialDate ? 'all' : 'all');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [kmMax, setKmMax] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [passCountFilter, setPassCountFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [marginMin, setMarginMin] = useState('1000');
  // Multi-source filters
  const [sourceTypeFilter, setSourceTypeFilter] = useState('all');
  const [sourceNameFilter, setSourceNameFilter] = useState('all');

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

  // Filter and sort lots
  const filteredLots = useMemo(() => {
    const now = startOfDay(new Date());
    const minMargin = parseInt(marginMin) || 0;
    const minYear = parseInt(yearMin) || 0;
    const maxYear = parseInt(yearMax) || 9999;
    const maxKm = parseInt(kmMax) || Infinity;

    return lots
      .filter((lot) => {
        // Margin filter (default 1000)
        if (lot.estimated_margin < minMargin) return false;

        // Search query - include source fields
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const searchFields = [
            lot.make, lot.model, lot.variant_raw, lot.variant_normalised,
            lot.source_type, lot.source_name
          ].join(' ').toLowerCase();
          if (!searchFields.includes(q)) return false;
        }

        // Date range filter
        if (lot.auction_datetime) {
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

        // Other filters
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
        // Sort by auction_datetime ascending, then estimated_margin descending
        const dateA = a.auction_datetime ? parseISO(a.auction_datetime).getTime() : 0;
        const dateB = b.auction_datetime ? parseISO(b.auction_datetime).getTime() : 0;
        if (dateA !== dateB) return dateA - dateB;
        return b.estimated_margin - a.estimated_margin;
      });
  }, [lots, searchQuery, auctionHouseFilter, locationFilter, dateRangeFilter, yearMin, yearMax, kmMax, statusFilter, passCountFilter, actionFilter, marginMin, sourceTypeFilter, sourceNameFilter]);

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
            <p className="text-sm text-muted-foreground">{filteredLots.length} lots found</p>
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
              placeholder="Min margin (default 1000)"
              value={marginMin}
              onChange={(e) => setMarginMin(e.target.value)}
              className="text-xs sm:text-sm"
            />
          </div>
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
                    <TableHead className="text-xs whitespace-nowrap"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLots.map((lot) => (
                    <TableRow
                      key={lot.lot_key || lot.listing_key || lot.lot_id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setSelectedLot(lot)}
                    >
                      <TableCell className="text-xs whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-medium">{lot.source_name || lot.auction_house}</span>
                          <span className="text-muted-foreground capitalize">{lot.source_type || 'auction'}</span>
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
                      <TableCell className="text-xs text-right font-medium text-emerald-500">{formatCurrency(lot.estimated_margin)}</TableCell>
                      <TableCell className="text-xs text-center">{lot.confidence_score}</TableCell>
                      <TableCell className="text-center">
                        {(() => {
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
                      <TableCell>
                        {lot.listing_url && lot.invalid_source !== 'Y' ? (
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
                        ) : lot.listing_url ? (
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
                  ))}</TableBody>
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
