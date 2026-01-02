import { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { dataService } from '@/services/dataService';
import { SaleFingerprint, AuctionLot, formatNumber, formatCurrency } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ExternalLink, Target, Crosshair, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Match {
  fingerprint: SaleFingerprint;
  lot: AuctionLot;
  matchType: 'km_bounded' | 'spec_only';
  lane: 'Precision' | 'Advisory';
}

interface MatchFilters {
  lane: 'all' | 'Precision' | 'Advisory';
  auctionHouse: string;
  action: 'all' | 'Watch' | 'Buy';
  minConfidence: number;
}

// Match a lot against a fingerprint using the matching rules
function matchLotToFingerprint(lot: AuctionLot, fp: SaleFingerprint): Match | null {
  // Check if fingerprint is active
  if (fp.is_active !== 'Y') return null;
  
  // Check expiry
  const today = new Date();
  const expiresAt = new Date(fp.expires_at);
  if (today > expiresAt) return null;
  
  // Check make/model/variant - all must match
  if (
    lot.make?.toLowerCase().trim() !== fp.make?.toLowerCase().trim() ||
    lot.model?.toLowerCase().trim() !== fp.model?.toLowerCase().trim() ||
    lot.variant_normalised?.toLowerCase().trim() !== fp.variant_normalised?.toLowerCase().trim()
  ) return null;
  
  // Year tolerance: ±1
  if (Math.abs((lot.year || 0) - (fp.year || 0)) > 1) return null;
  
  // Determine if this is a spec-only fingerprint
  const isSpecOnly = fp.fingerprint_type === 'spec_only' || !fp.sale_km;
  
  if (isSpecOnly) {
    // Spec-only: skip KM, engine, drivetrain, transmission checks
    return {
      fingerprint: fp,
      lot,
      matchType: 'spec_only',
      lane: 'Advisory',
    };
  }
  
  // Full fingerprint: check additional specs
  if (fp.engine && lot.fuel && fp.engine.toLowerCase().trim() !== lot.fuel.toLowerCase().trim()) return null;
  if (fp.drivetrain && lot.drivetrain && fp.drivetrain.toLowerCase().trim() !== lot.drivetrain.toLowerCase().trim()) return null;
  if (fp.transmission && lot.transmission && fp.transmission.toLowerCase().trim() !== lot.transmission.toLowerCase().trim()) return null;
  
  // KM range check: symmetric range (sale_km ± 15000)
  const minKm = fp.min_km ?? Math.max(0, (fp.sale_km || 0) - 15000);
  const maxKm = fp.max_km ?? (fp.sale_km || 0) + 15000;
  
  if (lot.km < minKm || lot.km > maxKm) return null;
  
  return {
    fingerprint: fp,
    lot,
    matchType: 'km_bounded',
    lane: 'Precision',
  };
}

export default function MatchesPage() {
  useDocumentTitle(0);
  
  const [fingerprints, setFingerprints] = useState<SaleFingerprint[]>([]);
  const [lots, setLots] = useState<AuctionLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<MatchFilters>({
    lane: 'all',
    auctionHouse: 'all',
    action: 'all',
    minConfidence: 0,
  });
  const [advisoryOpen, setAdvisoryOpen] = useState(true);
  
  // Get unique auction houses from lots
  const auctionHouses = useMemo(() => {
    const houses = new Set(lots.map(l => l.source_name || l.auction_house).filter(Boolean));
    return Array.from(houses).sort();
  }, [lots]);
  
  // Compute all matches
  const allMatches = useMemo(() => {
    const matches: Match[] = [];
    for (const fp of fingerprints) {
      for (const lot of lots) {
        // Only consider active lots
        if (lot.status === 'sold' || lot.status === 'withdrawn') continue;
        if (lot.visible_to_dealers !== 'Y') continue;
        
        const match = matchLotToFingerprint(lot, fp);
        if (match) {
          matches.push(match);
        }
      }
    }
    
    return matches;
  }, [fingerprints, lots]);
  
  // Filter and sort matches
  const filteredMatches = useMemo(() => {
    let result = [...allMatches];
    
    // Apply filters
    if (filters.lane !== 'all') {
      result = result.filter(m => m.lane === filters.lane);
    }
    
    if (filters.auctionHouse !== 'all') {
      result = result.filter(m => 
        (m.lot.source_name || m.lot.auction_house) === filters.auctionHouse
      );
    }
    
    if (filters.action !== 'all') {
      result = result.filter(m => m.lot.action === filters.action);
    }
    
    if (filters.minConfidence > 0) {
      result = result.filter(m => m.lot.confidence_score >= filters.minConfidence);
    }
    
    // Sort: Precision first, then by confidence DESC, then by auction date ASC
    result.sort((a, b) => {
      if (a.lane !== b.lane) {
        return a.lane === 'Precision' ? -1 : 1;
      }
      if (b.lot.confidence_score !== a.lot.confidence_score) {
        return b.lot.confidence_score - a.lot.confidence_score;
      }
      return (a.lot.auction_datetime || '').localeCompare(b.lot.auction_datetime || '');
    });
    
    return result;
  }, [allMatches, filters]);
  
  // Split into Precision and Advisory
  const precisionMatches = filteredMatches.filter(m => m.lane === 'Precision');
  const advisoryMatches = filteredMatches.filter(m => m.lane === 'Advisory');
  
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [fps, allLots] = await Promise.all([
          dataService.getFingerprints(),
          dataService.getLots(true), // Get all lots for matching
        ]);
        setFingerprints(fps.filter(fp => fp.is_active === 'Y'));
        setLots(allLots);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);
  
  const renderMatchRow = (match: Match) => {
    const { fingerprint, lot, matchType, lane } = match;
    const vehicleDesc = `${fingerprint.year} ${fingerprint.make} ${fingerprint.model} ${fingerprint.variant_normalised}`;
    const source = lot.source_name || lot.auction_house || 'Unknown';
    const auctionDate = lot.auction_datetime 
      ? new Date(lot.auction_datetime).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
      : '—';
    
    return (
      <TableRow key={`${fingerprint.fingerprint_id}-${lot.lot_key || lot.listing_key}`}>
        <TableCell className="font-medium">
          <div className="flex flex-col">
            <span className="text-foreground">{vehicleDesc}</span>
            <span className="text-xs text-muted-foreground">Dealer: {fingerprint.dealer_name}</span>
          </div>
        </TableCell>
        <TableCell>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                {lane === 'Precision' ? (
                  <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">
                    <Crosshair className="h-3 w-3 mr-1" />
                    Precision
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-amber-600/20 text-amber-400 hover:bg-amber-600/30">
                    <Target className="h-3 w-3 mr-1" />
                    Advisory
                  </Badge>
                )}
              </TooltipTrigger>
              <TooltipContent>
                {lane === 'Precision' 
                  ? 'KM-bounded match with full specs verified'
                  : 'Spec-only match – KM not enforced, manual judgment applies'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>
        <TableCell>{lot.year || '—'}</TableCell>
        <TableCell>{lot.km ? formatNumber(lot.km) : '—'}</TableCell>
        <TableCell>
          <span className="text-muted-foreground">{source}</span>
        </TableCell>
        <TableCell>{auctionDate}</TableCell>
        <TableCell>
          <Badge variant={matchType === 'km_bounded' ? 'outline' : 'secondary'} className="text-xs">
            {matchType === 'km_bounded' ? 'KM-bounded' : 'Spec-only'}
          </Badge>
        </TableCell>
        <TableCell className="text-center">
          <Badge variant="outline">{lot.confidence_score}</Badge>
        </TableCell>
        <TableCell>
          <Badge 
            variant={lot.action === 'Buy' ? 'default' : 'secondary'}
            className={lot.action === 'Buy' ? 'bg-emerald-600' : ''}
          >
            {lot.action}
          </Badge>
        </TableCell>
        <TableCell>
          {lot.listing_url && lot.invalid_source !== 'Y' ? (
            <Button variant="ghost" size="sm" asChild>
              <a href={lot.listing_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          ) : lot.listing_url ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
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
          ) : null}
        </TableCell>
      </TableRow>
    );
  };
  
  const tableHeaders = (
    <TableRow>
      <TableHead className="w-[250px]">Vehicle (Fingerprint)</TableHead>
      <TableHead>Lane</TableHead>
      <TableHead>Year</TableHead>
      <TableHead>KM</TableHead>
      <TableHead>Source</TableHead>
      <TableHead>Date</TableHead>
      <TableHead>Match Type</TableHead>
      <TableHead className="text-center">Conf.</TableHead>
      <TableHead>Action</TableHead>
      <TableHead className="w-[50px]"></TableHead>
    </TableRow>
  );
  
  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Matches</h1>
          <p className="text-muted-foreground">
            Live matches between active fingerprints and current listings
          </p>
        </div>
        
        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center bg-card p-4 rounded-lg border border-border">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Lane:</label>
            <Select 
              value={filters.lane} 
              onValueChange={(v) => setFilters(f => ({ ...f, lane: v as MatchFilters['lane'] }))}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="Precision">Precision</SelectItem>
                <SelectItem value="Advisory">Advisory</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Source:</label>
            <Select 
              value={filters.auctionHouse} 
              onValueChange={(v) => setFilters(f => ({ ...f, auctionHouse: v }))}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {auctionHouses.map(house => (
                  <SelectItem key={house} value={house}>{house}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Action:</label>
            <Select 
              value={filters.action} 
              onValueChange={(v) => setFilters(f => ({ ...f, action: v as MatchFilters['action'] }))}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="Buy">Buy</SelectItem>
                <SelectItem value="Watch">Watch</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Min Confidence:</label>
            <Input
              type="number"
              min={0}
              max={5}
              value={filters.minConfidence}
              onChange={(e) => setFilters(f => ({ ...f, minConfidence: parseInt(e.target.value) || 0 }))}
              className="w-[80px]"
            />
          </div>
          
          <div className="ml-auto text-sm text-muted-foreground">
            {filteredMatches.length} match{filteredMatches.length !== 1 ? 'es' : ''} found
          </div>
        </div>
        
        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredMatches.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No matches found. Active fingerprints will match against current listings automatically.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Precision Matches */}
            {(filters.lane === 'all' || filters.lane === 'Precision') && precisionMatches.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Crosshair className="h-5 w-5 text-emerald-500" />
                  Precision Matches
                  <Badge variant="outline" className="ml-2">{precisionMatches.length}</Badge>
                </h2>
                <div className="border border-border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>{tableHeaders}</TableHeader>
                    <TableBody>
                      {precisionMatches.map(renderMatchRow)}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            
            {/* Advisory Matches - Collapsible */}
            {(filters.lane === 'all' || filters.lane === 'Advisory') && advisoryMatches.length > 0 && (
              <Collapsible open={advisoryOpen} onOpenChange={setAdvisoryOpen}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-lg font-semibold text-foreground hover:text-foreground/80 transition-colors">
                    {advisoryOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                    <Target className="h-5 w-5 text-amber-500" />
                    Advisory Matches
                    <Badge variant="outline" className="ml-2">{advisoryMatches.length}</Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="border border-border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>{tableHeaders}</TableHeader>
                      <TableBody>
                        {advisoryMatches.map(renderMatchRow)}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
