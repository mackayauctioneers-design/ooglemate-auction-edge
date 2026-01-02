import { useState, useEffect, useMemo, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { dataService } from '@/services/dataService';
import { SaleFingerprint, AuctionLot, formatNumber, formatCurrency, getPressureSignals } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ExternalLink, Target, Crosshair, Loader2, Clock, AlertCircle, RefreshCw, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

// Match tiers: Tier 1 (Exact) = Precision, Tier 2 (Variant Family) = Probable
type MatchTier = 'tier1' | 'tier2';
type MatchLane = 'Precision' | 'Advisory' | 'Probable';

interface Match {
  fingerprint: SaleFingerprint;
  lot: AuctionLot;
  matchType: 'km_bounded' | 'spec_only' | 'variant_family';
  lane: MatchLane;
  tier: MatchTier;
  matchConfidence: 'exact' | 'probable';
}

interface MatchFilters {
  lane: 'all' | 'Precision' | 'Advisory' | 'Probable';
  auctionHouse: string;
  action: 'all' | 'Watch' | 'Buy';
  minConfidence: number;
}

// Get variant family for matching - ONLY use stored value, don't derive on-the-fly
// Derivation should only happen during backfill, not during matching
function getVariantFamily(storedFamily: string | undefined): string | undefined {
  if (storedFamily && storedFamily.trim()) return storedFamily.toUpperCase().trim();
  return undefined;
}

// Helper: Check if fingerprint is spec-only (should ignore KM)
function isSpecOnlyFingerprint(fp: SaleFingerprint): boolean {
  // Explicit spec_only type
  if (fp.fingerprint_type === 'spec_only') return true;
  // No sale_km means spec-only
  if (!fp.sale_km) return true;
  // NULL min/max km means spec-only (properly backfilled)
  if (fp.min_km === null || fp.min_km === undefined) return true;
  if (fp.max_km === null || fp.max_km === undefined) return true;
  return false;
}

// Match a lot against a fingerprint using the matching rules
// Returns Match with tier information for sorting
function matchLotToFingerprint(lot: AuctionLot, fp: SaleFingerprint): Match | null {
  // Check if fingerprint is active
  if (fp.is_active !== 'Y') return null;
  
  // Check if fingerprint is marked as do_not_buy
  if (fp.do_not_buy === 'Y') return null;
  
  // Check if lot is excluded (condition risk - damaged/mining/write-off)
  if (lot.excluded_reason) return null;
  
  // Check expiry
  const today = new Date();
  const expiresAt = new Date(fp.expires_at);
  if (today > expiresAt) return null;
  
  // Year tolerance: ±1
  if (Math.abs((lot.year || 0) - (fp.year || 0)) > 1) return null;
  
  // Check make/model - must always match
  if (
    lot.make?.toLowerCase().trim() !== fp.make?.toLowerCase().trim() ||
    lot.model?.toLowerCase().trim() !== fp.model?.toLowerCase().trim()
  ) return null;
  
  // Determine if this is a spec-only fingerprint
  const isSpecOnly = isSpecOnlyFingerprint(fp);
  
  // ========== TIER 1: Exact variant match ==========
  if (lot.variant_normalised?.toLowerCase().trim() === fp.variant_normalised?.toLowerCase().trim()) {
    if (isSpecOnly) {
      // Spec-only: skip KM, engine, drivetrain, transmission checks
      return {
        fingerprint: fp,
        lot,
        matchType: 'spec_only',
        lane: 'Advisory',
        tier: 'tier1',
        matchConfidence: 'exact',
      };
    }
    
    // Full fingerprint: check additional specs
    if (fp.engine && lot.fuel && fp.engine.toLowerCase().trim() !== lot.fuel.toLowerCase().trim()) {
      // Fall through to tier 2
    } else if (fp.drivetrain && lot.drivetrain && fp.drivetrain.toLowerCase().trim() !== lot.drivetrain.toLowerCase().trim()) {
      // Fall through to tier 2
    } else if (fp.transmission && lot.transmission && fp.transmission.toLowerCase().trim() !== lot.transmission.toLowerCase().trim()) {
      // Fall through to tier 2
    } else {
      // KM range check: ONLY for full fingerprints with valid min/max km
      const minKm = fp.min_km!;
      const maxKm = fp.max_km!;
      
      if (lot.km >= minKm && lot.km <= maxKm) {
        return {
          fingerprint: fp,
          lot,
          matchType: 'km_bounded',
          lane: 'Precision',
          tier: 'tier1',
          matchConfidence: 'exact',
        };
      }
    }
  }
  
  // ========== TIER 2: Variant family match ==========
  // Use ONLY stored variant_family values - no on-the-fly derivation
  const lotFamily = getVariantFamily(lot.variant_family);
  const fpFamily = getVariantFamily(fp.variant_family);
  
  // If both have a family and they match
  if (lotFamily && fpFamily && lotFamily === fpFamily) {
    // For Tier 2, KM check only applies to full fingerprints with valid km bounds
    if (!isSpecOnly) {
      const minKm = fp.min_km!;
      const maxKm = fp.max_km!;
      
      if (lot.km < minKm || lot.km > maxKm) {
        return null; // KM out of range for full fingerprint
      }
    }
    
    return {
      fingerprint: fp,
      lot,
      matchType: 'variant_family',
      lane: 'Probable',
      tier: 'tier2',
      matchConfidence: 'probable',
    };
  }
  
  return null;
}

export default function MatchesPage() {
  useDocumentTitle(0);
  const { isAdmin } = useAuth();
  
  const [fingerprints, setFingerprints] = useState<SaleFingerprint[]>([]);
  const [lots, setLots] = useState<AuctionLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastEvaluation, setLastEvaluation] = useState<Date | null>(null);
  const [filters, setFilters] = useState<MatchFilters>({
    lane: 'all',
    auctionHouse: 'all',
    action: 'all',
    minConfidence: 0,
  });
  const [advisoryOpen, setAdvisoryOpen] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  
  // Get unique auction houses from lots
  const auctionHouses = useMemo(() => {
    const houses = new Set(lots.map(l => l.source_name || l.auction_house).filter(Boolean));
    return Array.from(houses).sort();
  }, [lots]);
  
  // Helper: Check if a lot is a future catalogue lot (Pickles upcoming)
  const isFutureCatalogueLot = (lot: AuctionLot): boolean => {
    if (!['catalogue', 'upcoming'].includes(lot.status || '')) return false;
    if (!lot.auction_datetime) return false;
    const auctionDate = new Date(lot.auction_datetime);
    return auctionDate > new Date();
  };
  
  // Compute all matches
  const allMatches = useMemo(() => {
    const matches: Match[] = [];
    for (const fp of fingerprints) {
      for (const lot of lots) {
        // Only consider active lots
        if (lot.status === 'sold' || lot.status === 'withdrawn') continue;
        if (lot.visible_to_dealers !== 'Y') continue;
        
        // Future catalogue lots are only eligible for Tier-2 (Probable) matching
        const isCatalogueLot = isFutureCatalogueLot(lot);
        
        const match = matchLotToFingerprint(lot, fp);
        if (match) {
          // If it's a catalogue lot, only include Tier-2 matches
          if (isCatalogueLot && match.tier !== 'tier2') continue;
          
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
    
    // Sort: Tier 1 first, then by lane (Precision > Advisory > Probable), then by confidence DESC, then by auction date ASC
    result.sort((a, b) => {
      // Tier first
      if (a.tier !== b.tier) {
        return a.tier === 'tier1' ? -1 : 1;
      }
      // Then lane priority: Precision > Advisory > Probable
      const laneOrder: Record<MatchLane, number> = { 'Precision': 0, 'Advisory': 1, 'Probable': 2 };
      if (laneOrder[a.lane] !== laneOrder[b.lane]) {
        return laneOrder[a.lane] - laneOrder[b.lane];
      }
      // Then confidence
      if (b.lot.confidence_score !== a.lot.confidence_score) {
        return b.lot.confidence_score - a.lot.confidence_score;
      }
      // Then date
      return (a.lot.auction_datetime || '').localeCompare(b.lot.auction_datetime || '');
    });
    
    return result;
  }, [allMatches, filters]);
  
  // Split into lanes
  const precisionMatches = filteredMatches.filter(m => m.lane === 'Precision');
  const advisoryMatches = filteredMatches.filter(m => m.lane === 'Advisory');
  const probableMatches = filteredMatches.filter(m => m.lane === 'Probable');
  
  // Load data function
  const loadData = useCallback(async (showRefreshToast = false) => {
    if (showRefreshToast) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const [fps, allLots] = await Promise.all([
        dataService.getFingerprints(),
        dataService.getLots(true), // Get all lots for matching
      ]);
      setFingerprints(fps.filter(fp => fp.is_active === 'Y'));
      setLots(allLots);
      setLastEvaluation(new Date());
      
      if (showRefreshToast) {
        toast({
          title: "Matches refreshed",
          description: `Evaluated ${fps.filter(fp => fp.is_active === 'Y').length} fingerprints against ${allLots.length} lots`,
        });
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      if (showRefreshToast) {
        toast({
          title: "Refresh failed",
          description: "Could not reload match data",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  
  useEffect(() => {
    loadData();
  }, [loadData]);
  
  // Diagnostic counts for admin panel
  const diagnostics = useMemo(() => {
    const activeFingerprints = fingerprints.length;
    
    // Count lots in scope: standard lots + future catalogue lots (for Tier-2)
    const standardLotsInScope = lots.filter(l => 
      l.status !== 'sold' && 
      l.status !== 'withdrawn' && 
      l.status !== 'catalogue' &&
      l.status !== 'upcoming' &&
      l.visible_to_dealers === 'Y'
    ).length;
    
    const catalogueLotsInScope = lots.filter(l => {
      if (!['catalogue', 'upcoming'].includes(l.status || '')) return false;
      if (l.visible_to_dealers !== 'Y') return false;
      if (!l.auction_datetime) return false;
      const auctionDate = new Date(l.auction_datetime);
      return auctionDate > new Date();
    }).length;
    
    const lotsInScope = standardLotsInScope + catalogueLotsInScope;
    const strictMatches = allMatches.filter(m => m.tier === 'tier1').length;
    const probableMatchCount = allMatches.filter(m => m.tier === 'tier2').length;
    
    // Count records with variant_family populated
    const fingerprintsWithFamily = fingerprints.filter(fp => fp.variant_family).length;
    const lotsWithFamily = lots.filter(l => l.variant_family).length;
    
    // Count full vs spec-only fingerprints
    const fullFingerprints = fingerprints.filter(fp => !isSpecOnlyFingerprint(fp)).length;
    const specOnlyFingerprints = fingerprints.filter(fp => isSpecOnlyFingerprint(fp)).length;
    
    return {
      activeFingerprints,
      lotsInScope,
      catalogueLotsInScope,
      strictMatches,
      probableMatchCount,
      fingerprintsWithFamily,
      lotsWithFamily,
      fullFingerprints,
      specOnlyFingerprints,
    };
  }, [fingerprints, lots, allMatches]);
  
  const renderMatchRow = (match: Match) => {
    const { fingerprint, lot, matchType, lane, matchConfidence } = match;
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
                ) : lane === 'Probable' ? (
                  <Badge variant="secondary" className="bg-blue-600/20 text-blue-400 hover:bg-blue-600/30">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Probable
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
                  : lane === 'Probable'
                  ? 'Variant family match (e.g., SR5 ↔ SR5) – requires additional pressure signals before promotion to BUY'
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
          <Badge variant={matchType === 'km_bounded' ? 'outline' : matchType === 'variant_family' ? 'secondary' : 'secondary'} className="text-xs">
            {matchType === 'km_bounded' ? 'KM-bounded' : matchType === 'variant_family' ? 'Variant family' : 'Spec-only'}
          </Badge>
        </TableCell>
        <TableCell className="text-center">
          <Badge variant="outline">{lot.confidence_score}</Badge>
        </TableCell>
        <TableCell>
          {(() => {
            // Tier 2 (Probable) matches never auto-upgrade to BUY
            if (matchConfidence === 'probable') {
              return (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="gap-1 border-blue-500/50 text-blue-500">
                        <Clock className="h-3 w-3" />
                        Watch
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span>Probable match – requires additional pressure signals before BUY promotion</span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            }
            
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
                className={lot.action === 'Buy' ? 'bg-emerald-600' : ''}
              >
                {lot.action}
              </Badge>
            );
          })()}
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
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Matches</h1>
            <p className="text-muted-foreground">
              Live matches between active fingerprints and current listings
            </p>
          </div>
          
          {/* Admin controls */}
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDiagnostics(!showDiagnostics)}
                className="gap-1"
              >
                <Info className="h-4 w-4" />
                {showDiagnostics ? 'Hide' : 'Why no matches?'}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => loadData(true)}
                disabled={refreshing}
                className="gap-1"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh Matches
              </Button>
            </div>
          )}
        </div>
        
        {/* Admin diagnostics panel */}
        {isAdmin && showDiagnostics && (
          <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3">
            <h3 className="font-medium text-foreground flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              Match Evaluation Diagnostics
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4 text-sm">
              <div className="space-y-1">
                <div className="text-muted-foreground">Active Fingerprints</div>
                <div className="text-xl font-semibold text-foreground">{diagnostics.activeFingerprints}</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Full (KM enforced)</div>
                <div className="text-xl font-semibold text-emerald-500">{diagnostics.fullFingerprints}</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Spec-Only (KM ignored)</div>
                <div className="text-xl font-semibold text-amber-500">{diagnostics.specOnlyFingerprints}</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Lots in Scope</div>
                <div className="text-xl font-semibold text-foreground">{diagnostics.lotsInScope}</div>
                {diagnostics.catalogueLotsInScope > 0 && (
                  <div className="text-xs text-blue-500">incl. {diagnostics.catalogueLotsInScope} catalogue</div>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Strict Matches (Tier 1)</div>
                <div className="text-xl font-semibold text-emerald-500">{diagnostics.strictMatches}</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Probable Matches (Tier 2)</div>
                <div className="text-xl font-semibold text-blue-500">{diagnostics.probableMatchCount}</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Fingerprints w/ Family</div>
                <div className="text-xl font-semibold text-foreground">{diagnostics.fingerprintsWithFamily}</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Lots w/ Family</div>
                <div className="text-xl font-semibold text-foreground">{diagnostics.lotsWithFamily}</div>
              </div>
            </div>
            {diagnostics.catalogueLotsInScope > 0 && (
              <div className="text-xs text-blue-500 mt-2">
                ℹ️ Includes future catalogue lots (Probable matching only – never triggers BUY)
              </div>
            )}
            {lastEvaluation && (
              <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                Last evaluated: {lastEvaluation.toLocaleString('en-AU', { 
                  dateStyle: 'medium', 
                  timeStyle: 'short' 
                })}
              </div>
            )}
            {diagnostics.activeFingerprints === 0 && (
              <div className="text-sm text-amber-500 mt-2">
                ⚠️ No active fingerprints. Create fingerprints from sales data to enable matching.
              </div>
            )}
            {diagnostics.lotsInScope === 0 && (
              <div className="text-sm text-amber-500 mt-2">
                ⚠️ No lots in scope. Import listings from Pickles or other sources.
              </div>
            )}
            {(diagnostics.fingerprintsWithFamily === 0 || diagnostics.lotsWithFamily === 0) && (
              <div className="text-sm text-amber-500 mt-2">
                ⚠️ Tier-2 matching requires variant_family. Run "Backfill Variant Family" in Admin Tools.
              </div>
            )}
          </div>
        )}
        
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
                <SelectItem value="Probable">Probable</SelectItem>
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
            
            {/* Probable Matches (Tier 2 - Variant Family) - Collapsible */}
            {(filters.lane === 'all' || filters.lane === 'Probable') && probableMatches.length > 0 && (
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-lg font-semibold text-foreground hover:text-foreground/80 transition-colors">
                    <ChevronRight className="h-5 w-5 group-data-[state=open]:hidden" />
                    <ChevronDown className="h-5 w-5 hidden group-data-[state=open]:block" />
                    <AlertCircle className="h-5 w-5 text-blue-500" />
                    Probable Matches (Variant Family)
                    <Badge variant="outline" className="ml-2">{probableMatches.length}</Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="border border-border rounded-lg overflow-hidden">
                    <p className="text-xs text-muted-foreground bg-muted/50 px-4 py-2 border-b border-border">
                      These matches are based on variant family (e.g., SR5, XLT) rather than exact variant. They do NOT auto-upgrade to BUY and require additional pressure signals.
                    </p>
                    <Table>
                      <TableHeader>{tableHeaders}</TableHeader>
                      <TableBody>
                        {probableMatches.map(renderMatchRow)}
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
