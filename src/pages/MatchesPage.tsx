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
import { ExternalLink, Target, Crosshair, Loader2, Clock, AlertCircle, RefreshCw, Info, AlertTriangle } from 'lucide-react';
import { getAuctionListingUrl, getSessionWarningTooltip, isSessionBasedAuctionHouse } from '@/utils/auctionLinkHandler';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { isPicklesSource as checkPicklesSource } from '@/utils/variantFamilyExtractor';

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

// Normalize Pickles numeric status codes to string statuses
// Pickles catalogue uses: 0 = catalogue/listed, 2 = passed_in
function normalizeStatus(status: string | undefined): string {
  if (!status) return '';
  const trimmed = status.trim();
  
  // Handle numeric status codes (from Pickles)
  if (trimmed === '0') return 'catalogue';
  if (trimmed === '1') return 'listed';
  if (trimmed === '2') return 'passed_in';
  if (trimmed === '3') return 'sold';
  if (trimmed === '4') return 'withdrawn';
  
  // Already a string status - normalize casing
  const lower = trimmed.toLowerCase();
  if (['catalogue', 'upcoming', 'listed', 'passed_in', 'sold', 'withdrawn'].includes(lower)) {
    return lower;
  }
  
  return trimmed; // Return as-is if unrecognized
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

// ========== PICKLES MATCHING RULES ==========
// 1. KM is OPTIONAL for Pickles - missing KM never blocks matching
// 2. Tier-2 works even without variant_family (make + model + year is enough)
// 3. Pickles defaults to Spec-Only matching until KM is confirmed

function isPicklesLot(lot: AuctionLot): boolean {
  return checkPicklesSource(lot.source_name, lot.auction_house);
}

// Check if lot has confirmed KM (valid, non-placeholder)
function hasConfirmedKm(lot: AuctionLot): boolean {
  return lot.km != null && lot.km > 0 && lot.km < 900000;
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
  
  // Check make/model - must always match
  if (
    lot.make?.toLowerCase().trim() !== fp.make?.toLowerCase().trim() ||
    lot.model?.toLowerCase().trim() !== fp.model?.toLowerCase().trim()
  ) return null;
  
  // ========== PICKLES-SPECIFIC MATCHING ==========
  const isPikles = isPicklesLot(lot);
  const lotHasKm = hasConfirmedKm(lot);
  
  // Year tolerance: ±1 for standard, ±4 for Pickles catalogue (messy data)
  const yearTolerance = isPikles ? 4 : 1;
  if (Math.abs((lot.year || 0) - (fp.year || 0)) > yearTolerance) return null;
  
  // Determine if this is a spec-only fingerprint
  const isSpecOnly = isSpecOnlyFingerprint(fp);
  
  // ========== SPEC-ONLY FINGERPRINTS: Tier-2 only, visibility-only ==========
  if (isSpecOnly) {
    // For Pickles without KM, always match as spec-only Tier-2
    if (isPikles) {
      return {
        fingerprint: fp,
        lot,
        matchType: 'spec_only',
        lane: 'Probable',
        tier: 'tier2',
        matchConfidence: 'probable',
      };
    }
    
    // Exact variant match - still Tier-2 Probable for spec-only
    if (lot.variant_normalised?.toLowerCase().trim() === fp.variant_normalised?.toLowerCase().trim()) {
      return {
        fingerprint: fp,
        lot,
        matchType: 'spec_only',
        lane: 'Probable',
        tier: 'tier2',
        matchConfidence: 'probable',
      };
    }
    
    // Variant family match for spec-only
    const lotFamily = getVariantFamily(lot.variant_family);
    const fpFamily = getVariantFamily(fp.variant_family);
    
    if (lotFamily && fpFamily && lotFamily === fpFamily) {
      return {
        fingerprint: fp,
        lot,
        matchType: 'spec_only',
        lane: 'Probable',
        tier: 'tier2',
        matchConfidence: 'probable',
      };
    }
    
    return null;
  }
  
  // ========== FULL FINGERPRINTS ==========
  
  // ========== TIER 1: Exact variant match (FULL fingerprints only) ==========
  if (lot.variant_normalised?.toLowerCase().trim() === fp.variant_normalised?.toLowerCase().trim()) {
    
    // Full fingerprint: check additional specs
    if (fp.engine && lot.fuel && fp.engine.toLowerCase().trim() !== lot.fuel.toLowerCase().trim()) {
      // Fall through to tier 2
    } else if (fp.drivetrain && lot.drivetrain && fp.drivetrain.toLowerCase().trim() !== lot.drivetrain.toLowerCase().trim()) {
      // Fall through to tier 2
    } else if (fp.transmission && lot.transmission && fp.transmission.toLowerCase().trim() !== lot.transmission.toLowerCase().trim()) {
      // Fall through to tier 2
    } else {
      // KM range check: ONLY for full fingerprints with valid min/max km
      // BUT: For Pickles, KM check is OPTIONAL - if lot has no KM, still match as Tier-2
      const minKm = fp.min_km!;
      const maxKm = fp.max_km!;
      
      if (lotHasKm) {
        // Lot has confirmed KM - check range
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
        // KM out of range - no Tier-1 match
      } else if (isPikles) {
        // Pickles lot WITHOUT confirmed KM - match as Tier-2 spec-only
        return {
          fingerprint: fp,
          lot,
          matchType: 'spec_only',
          lane: 'Probable',
          tier: 'tier2',
          matchConfidence: 'probable',
        };
      }
    }
  }
  
  // ========== TIER 2: Variant family OR make+model+year (for Pickles) ==========
  const lotFamily = getVariantFamily(lot.variant_family);
  const fpFamily = getVariantFamily(fp.variant_family);
  
  // If both have a family and they match
  if (lotFamily && fpFamily && lotFamily === fpFamily) {
    // KM check for full fingerprints - BUT optional for Pickles
    if (!isPikles && lotHasKm) {
      const minKm = fp.min_km!;
      const maxKm = fp.max_km!;
      
      if (lot.km < minKm || lot.km > maxKm) {
        return null; // KM out of range for non-Pickles full fingerprint
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
  
  // ========== TIER 2 FALLBACK: Pickles make+model+year match (NO variant required) ==========
  // For Pickles, allow Tier-2 matching on just make+model+year when variant_family is missing
  if (isPikles) {
    return {
      fingerprint: fp,
      lot,
      matchType: 'spec_only', // Mark as spec-only since no variant match
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
  
  // ========== SCOPING LAYERS ==========
  // Execution Scope (Tier-1 / BUY eligible): status IN ('listed','passed_in'), auction_date <= today
  // Visibility Scope (Tier-2 / Probable only): source='Pickles Catalogue', status IN ('catalogue','upcoming'), auction_date >= today
  
  const isExecutionScope = (lot: AuctionLot): boolean => {
    // Normalize status for comparison
    const status = normalizeStatus(lot.status);
    
    // Must be active status for execution
    if (!['listed', 'passed_in'].includes(status)) return false;
    if (lot.visible_to_dealers !== 'Y') return false;
    
    // Auction date must be today or past (real inventory ready for execution)
    // Future-dated lots go to visibility scope only
    if (lot.auction_datetime) {
      const auctionDate = new Date(lot.auction_datetime);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (auctionDate > today) return false; // Future = visibility only
    }
    
    return true;
  };
  
  // Tolerant check for Pickles source (handles variations like 'Pickles', 'Pickles Catalogue', 'pickles auction')
  const isPicklesSource = (lot: AuctionLot): boolean => {
    const source = (lot.source_name || '').toLowerCase();
    const auctionHouse = (lot.auction_house || '').toLowerCase();
    return source.includes('pickles') || auctionHouse.includes('pickles') || auctionHouse === 'pickles';
  };
  
  // Try to parse date from auction_datetime or auction_date, returns null if unparseable
  const parseAuctionDate = (lot: AuctionLot): { date: Date | null; source: 'datetime' | 'date' | 'none' } => {
    if (lot.auction_datetime) {
      const d = new Date(lot.auction_datetime);
      if (!isNaN(d.getTime())) return { date: d, source: 'datetime' };
    }
    if ((lot as any).auction_date) {
      const d = new Date((lot as any).auction_date);
      if (!isNaN(d.getTime())) return { date: d, source: 'date' };
    }
    return { date: null, source: 'none' };
  };
  
  // Get reason why lot is excluded from visibility scope
  const getVisibilityExclusionReason = (lot: AuctionLot): string | null => {
    const pickles = isPicklesSource(lot);
    
    // Must be either Pickles source OR visible_to_dealers = Y
    if (!pickles && lot.visible_to_dealers !== 'Y') return 'not Pickles and visible_to_dealers != Y';
    
    // Must have valid status (using normalized status)
    const status = normalizeStatus(lot.status);
    const validStatuses = ['catalogue', 'upcoming', 'listed'];
    if (!validStatuses.includes(status)) return `status '${lot.status}' → normalized '${status}' not in [catalogue, upcoming, listed]`;
    
    // Check date - we allow missing/unparseable dates for visibility (labeled "date unknown")
    const { date } = parseAuctionDate(lot);
    if (date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) return `auction date ${date.toISOString().split('T')[0]} is in the past`;
    }
    // If date missing, we still include - no exclusion reason
    
    return null; // Not excluded
  };
  
  const isVisibilityScope = (lot: AuctionLot): boolean => {
    // Visibility scope: Pickles catalogue lots for Tier-2 matching ONLY
    // These NEVER trigger BUY, NEVER trigger alerts
    
    // Include if Pickles source OR visible_to_dealers = Y (Pickles lots don't require visible_to_dealers)
    const pickles = isPicklesSource(lot);
    if (!pickles && lot.visible_to_dealers !== 'Y') return false;
    
    // Must be Pickles source (tolerant check)
    if (!pickles) return false;
    
    // Must have valid status for visibility (using normalized status)
    const status = normalizeStatus(lot.status);
    const validStatuses = ['catalogue', 'upcoming', 'listed'];
    if (!validStatuses.includes(status)) return false;
    
    // Check auction date - include if:
    // 1. Date is in the future
    // 2. OR date is missing/unparseable (labeled "date unknown" in UI)
    const { date } = parseAuctionDate(lot);
    if (date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) return false; // Past date = not visibility scope
    }
    // If no parseable date, still include for visibility
    
    return true;
  };
  
  // ========== PRE-COMPUTE CANDIDATE LOT SETS ==========
  // Split lots into separate candidate pools for Tier-1 vs Tier-2 matching
  const { executionScopeLots, visibilityScopeLots } = useMemo(() => {
    const execution: AuctionLot[] = [];
    const visibility: AuctionLot[] = [];
    
    for (const lot of lots) {
      // Skip sold/withdrawn entirely
      if (lot.status === 'sold' || lot.status === 'withdrawn') continue;
      
      if (isExecutionScope(lot)) {
        execution.push(lot);
      } else if (isVisibilityScope(lot)) {
        visibility.push(lot);
      }
    }
    
    return { executionScopeLots: execution, visibilityScopeLots: visibility };
  }, [lots]);
  
  // ========== COMPUTE MATCHES ==========
  // Tier-1: Uses ONLY execution scope lots (BUY eligible)
  // Tier-2: Uses ONLY visibility scope lots (Probable only, NEVER BUY)
  const allMatches = useMemo(() => {
    const matches: Match[] = [];
    
    // ========== TIER-1 MATCHING: Execution Scope Only ==========
    // These can produce Precision/Advisory matches eligible for BUY
    for (const fp of fingerprints) {
      for (const lot of executionScopeLots) {
        const match = matchLotToFingerprint(lot, fp);
        if (match && match.tier === 'tier1') {
          matches.push(match);
        }
      }
    }
    
    // ========== TIER-2 MATCHING: Visibility Scope ONLY ==========
    // These are VISIBILITY-ONLY: NEVER BUY, NEVER alert
    // Tier-2 candidates come EXCLUSIVELY from visibilityScopeLots
    for (const fp of fingerprints) {
      for (const lot of visibilityScopeLots) {
        const match = matchLotToFingerprint(lot, fp);
        if (match) {
          // Force Tier-2 for visibility scope - safety override
          match.tier = 'tier2';
          match.lane = 'Probable';
          match.matchConfidence = 'probable'; // Ensure never auto-promotes to BUY
          match.matchType = 'variant_family'; // Mark as variant-family type
          
          // Add visibility flag to lot for UI labeling
          (lot as any)._visibilityOnly = true;
          
          matches.push(match);
        }
      }
    }
    
    return matches;
  }, [fingerprints, executionScopeLots, visibilityScopeLots]);
  
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
        toast.success("Matches refreshed", {
          description: `Evaluated ${fps.filter(fp => fp.is_active === 'Y').length} fingerprints against ${allLots.length} lots`,
        });
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      if (showRefreshToast) {
        toast.error("Refresh failed", {
          description: "Could not reload match data",
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
    
    // Use pre-computed scope arrays for accurate counts
    const executionLotsCount = executionScopeLots.length;
    const visibilityLotsCount = visibilityScopeLots.length;
    
    // Combined scope (for display)
    const lotsInScope = executionLotsCount + visibilityLotsCount;
    
    const strictMatches = allMatches.filter(m => m.tier === 'tier1').length;
    const probableMatchCount = allMatches.filter(m => m.tier === 'tier2').length;
    
    // Count visibility-only matches (upcoming)
    const upcomingMatches = allMatches.filter(m => (m.lot as any)._visibilityOnly).length;
    
    // Count records with variant_family populated
    const fingerprintsWithFamily = fingerprints.filter(fp => fp.variant_family).length;
    const lotsWithFamily = lots.filter(l => l.variant_family).length;
    
    // Count full vs spec-only fingerprints
    const fullFingerprints = fingerprints.filter(fp => !isSpecOnlyFingerprint(fp)).length;
    const specOnlyFingerprints = fingerprints.filter(fp => isSpecOnlyFingerprint(fp)).length;
    
    // ========== PICKLES-SPECIFIC DIAGNOSTICS ==========
    const picklesLots = lots.filter(l => isPicklesLot(l));
    const picklesTotal = picklesLots.length;
    const picklesWithVariantFamily = picklesLots.filter(l => l.variant_family).length;
    const picklesMissingKm = picklesLots.filter(l => !hasConfirmedKm(l)).length;
    const picklesInVisibility = visibilityScopeLots.filter(l => isPicklesLot(l)).length;
    const picklesMatches = allMatches.filter(m => isPicklesLot(m.lot)).length;
    
    // ========== VISIBILITY SCOPE DEBUG ==========
    // Analyze the lots with family to understand why they might be excluded
    const lotsWithFamilyList = lots.filter(l => l.variant_family);
    
    // Count by source values (top 10)
    const sourceCountMap: Record<string, number> = {};
    lotsWithFamilyList.forEach(l => {
      const src = l.source_name || l.source || '(empty)';
      sourceCountMap[src] = (sourceCountMap[src] || 0) + 1;
    });
    const sourceCounts = Object.entries(sourceCountMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    // Count by auction_house values
    const auctionHouseCountMap: Record<string, number> = {};
    lotsWithFamilyList.forEach(l => {
      const ah = l.auction_house || '(empty)';
      auctionHouseCountMap[ah] = (auctionHouseCountMap[ah] || 0) + 1;
    });
    const auctionHouseCounts = Object.entries(auctionHouseCountMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    // Count by status values (raw)
    const statusCountMap: Record<string, number> = {};
    lotsWithFamilyList.forEach(l => {
      const st = l.status || '(empty)';
      statusCountMap[st] = (statusCountMap[st] || 0) + 1;
    });
    const statusCounts = Object.entries(statusCountMap)
      .sort((a, b) => b[1] - a[1]);
    
    // Count by normalized status values
    const statusNormalisedCountMap: Record<string, number> = {};
    lotsWithFamilyList.forEach(l => {
      const st = normalizeStatus(l.status) || '(empty)';
      statusNormalisedCountMap[st] = (statusNormalisedCountMap[st] || 0) + 1;
    });
    const statusNormalisedCounts = Object.entries(statusNormalisedCountMap)
      .sort((a, b) => b[1] - a[1]);
    
    // Count parseable dates
    let auctionDatetimeParseable = 0;
    let auctionDateParseable = 0;
    let visibleToDealersY = 0;
    
    lotsWithFamilyList.forEach(l => {
      if (l.auction_datetime) {
        const d = new Date(l.auction_datetime);
        if (!isNaN(d.getTime())) auctionDatetimeParseable++;
      }
      if ((l as any).auction_date) {
        const d = new Date((l as any).auction_date);
        if (!isNaN(d.getTime())) auctionDateParseable++;
      }
      if (l.visible_to_dealers === 'Y') visibleToDealersY++;
    });
    
    // Sample excluded lots (up to 5)
    const excludedSamples: Array<{
      lot_id: string;
      source: string;
      auction_house: string;
      status: string;
      auction_datetime: string;
      auction_date: string;
      visible_to_dealers: string;
      excluded_reason: string;
    }> = [];
    
    for (const lot of lotsWithFamilyList) {
      if (excludedSamples.length >= 5) break;
      const reason = getVisibilityExclusionReason(lot);
      if (reason) {
        excludedSamples.push({
          lot_id: lot.lot_key || lot.listing_key || '(no id)',
          source: lot.source_name || lot.source || '(empty)',
          auction_house: lot.auction_house || '(empty)',
          status: lot.status || '(empty)',
          auction_datetime: lot.auction_datetime || '(empty)',
          auction_date: (lot as any).auction_date || '(empty)',
          visible_to_dealers: lot.visible_to_dealers || '(empty)',
          excluded_reason: reason,
        });
      }
    }
    
    return {
      activeFingerprints,
      lotsInScope,
      executionLotsInScope: executionLotsCount,
      visibilityLotsInScope: visibilityLotsCount,
      strictMatches,
      probableMatchCount,
      upcomingMatches,
      fingerprintsWithFamily,
      lotsWithFamily,
      fullFingerprints,
      specOnlyFingerprints,
      // Pickles-specific
      pickles: {
        total: picklesTotal,
        withVariantFamily: picklesWithVariantFamily,
        missingKm: picklesMissingKm,
        inVisibility: picklesInVisibility,
        matches: picklesMatches,
      },
      // Visibility debug
      visibilityDebug: {
        totalLotsWithFamily: lotsWithFamilyList.length,
        sourceCounts,
        auctionHouseCounts,
        statusCounts,
        statusNormalisedCounts,
        auctionDatetimeParseable,
        auctionDateParseable,
        visibleToDealersY,
        excludedSamples,
      },
    };
  }, [fingerprints, lots, allMatches, executionScopeLots, visibilityScopeLots]);
  
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
          <div className="flex flex-col gap-1">
            <Badge variant={matchType === 'km_bounded' ? 'outline' : matchType === 'variant_family' ? 'secondary' : 'secondary'} className="text-xs">
              {matchType === 'km_bounded' ? 'KM-bounded' : matchType === 'variant_family' ? 'Variant family' : 'Spec-only'}
            </Badge>
            {/* PROBABLE – UPCOMING badge for visibility-scope lots */}
            {(lot as any)._visibilityOnly && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-400 bg-purple-500/10">
                      PROBABLE – UPCOMING
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>Future auction lot. Cannot auto-BUY or trigger alerts.</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {/* SPEC-ONLY / KM UNKNOWN badge */}
            {matchType === 'spec_only' && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs border-orange-500/50 text-orange-400">
                      {isPicklesLot(lot) && !hasConfirmedKm(lot) 
                        ? 'KM unknown (Pickles)' 
                        : 'SPEC-ONLY (km ignored)'}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>
                      {isPicklesLot(lot) && !hasConfirmedKm(lot) 
                        ? 'KM not available from catalogue. Spec-Only matching applied.' 
                        : 'Visibility-only match. Cannot auto-promote to BUY or trigger alerts.'}
                    </span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {/* MANUAL badge for manual fingerprints */}
            {fingerprint.is_manual === 'Y' && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-400">
                      MANUAL
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>Created manually for testing/prospecting. Excluded from profit analytics.</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
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
          {lot.listing_url && lot.invalid_source !== 'Y' ? (() => {
            const linkResult = getAuctionListingUrl(lot.listing_url, lot.auction_house, lot.location);
            const sessionTooltip = getSessionWarningTooltip(lot.auction_house);
            const isSessionBased = isSessionBasedAuctionHouse(lot.auction_house);
            
            const handleClick = () => {
              if (linkResult.message) {
                toast(linkResult.message, { duration: 3000 });
              }
              window.open(linkResult.url, '_blank');
            };
            
            if (sessionTooltip) {
              return (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={handleClick}>
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{sessionTooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            }
            
            return (
              <Button variant="ghost" size="sm" onClick={handleClick}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            );
          })() : lot.listing_url ? (
            <TooltipProvider>
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
            </TooltipProvider>
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
              {isAdmin 
                ? 'Live matches between active fingerprints and current listings'
                : 'Your matched opportunities based on saved preferences'}
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
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
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
                <div className="text-muted-foreground">Execution Scope</div>
                <div className="text-xl font-semibold text-foreground">{diagnostics.executionLotsInScope}</div>
                <div className="text-xs text-muted-foreground">Tier-1 / BUY eligible</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Visibility Scope</div>
                <div className="text-xl font-semibold text-blue-500">{diagnostics.visibilityLotsInScope}</div>
                <div className="text-xs text-muted-foreground">Tier-2 / Probable only</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Tier-1 Matches</div>
                <div className="text-xl font-semibold text-emerald-500">{diagnostics.strictMatches}</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Tier-2 Matches</div>
                <div className="text-xl font-semibold text-blue-500">{diagnostics.probableMatchCount}</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">FP w/ Family</div>
                <div className="text-xl font-semibold text-foreground">{diagnostics.fingerprintsWithFamily}</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Lots w/ Family</div>
                <div className="text-xl font-semibold text-foreground">{diagnostics.lotsWithFamily}</div>
              </div>
            </div>
            
            {/* Pickles-specific diagnostics */}
            {diagnostics.pickles.total > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                  🥒 Pickles Listings
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                  <div className="space-y-1">
                    <div className="text-muted-foreground">Total</div>
                    <div className="text-lg font-semibold text-foreground">{diagnostics.pickles.total}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">With Variant Family</div>
                    <div className="text-lg font-semibold text-emerald-500">{diagnostics.pickles.withVariantFamily}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">KM Unknown (Pickles)</div>
                    <div className="text-lg font-semibold text-amber-500">{diagnostics.pickles.missingKm}</div>
                    <div className="text-xs text-muted-foreground">Spec-Only matching</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">In Visibility Scope</div>
                    <div className="text-lg font-semibold text-blue-500">{diagnostics.pickles.inVisibility}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">Matches Found</div>
                    <div className="text-lg font-semibold text-purple-500">{diagnostics.pickles.matches}</div>
                  </div>
                </div>
              </div>
            )}
            
            {diagnostics.visibilityLotsInScope > 0 && (
              <div className="text-xs text-blue-500 mt-2">
                ℹ️ Visibility scope includes {diagnostics.visibilityLotsInScope} future catalogue lots (Probable matching only – never triggers BUY)
                {diagnostics.upcomingMatches > 0 && (
                  <span className="ml-1">• {diagnostics.upcomingMatches} upcoming matches found</span>
                )}
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
            
            {/* Visibility Scope Debug Panel */}
            {diagnostics.visibilityDebug && diagnostics.lotsWithFamily > 0 && (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mt-3 pt-3 border-t border-border w-full text-left">
                    <ChevronRight className="h-4 w-4" />
                    🔍 Visibility Scope Debug ({diagnostics.visibilityDebug.totalLotsWithFamily} lots w/ family)
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-4">
                  {/* Source counts */}
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Count by source (top 10):</h4>
                    <div className="flex flex-wrap gap-2">
                      {diagnostics.visibilityDebug.sourceCounts.map(([source, count]) => (
                        <Badge key={source} variant="outline" className="text-xs">
                          {source}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  {/* Auction house counts */}
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Count by auction_house:</h4>
                    <div className="flex flex-wrap gap-2">
                      {diagnostics.visibilityDebug.auctionHouseCounts.map(([ah, count]) => (
                        <Badge key={ah} variant="outline" className="text-xs">
                          {ah}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  {/* Status counts (raw) */}
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Count by status (raw):</h4>
                    <div className="flex flex-wrap gap-2">
                      {diagnostics.visibilityDebug.statusCounts.map(([st, count]) => (
                        <Badge key={st} variant="outline" className="text-xs">
                          {st}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  {/* Status counts (normalized) */}
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Count by status (normalized):</h4>
                    <div className="flex flex-wrap gap-2">
                      {diagnostics.visibilityDebug.statusNormalisedCounts.map(([st, count]) => (
                        <Badge key={st} variant="outline" className="text-xs bg-primary/10">
                          {st}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  {/* Date parseable counts */}
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-muted-foreground">auction_datetime parseable:</span>
                      <span className="ml-2 font-medium">{diagnostics.visibilityDebug.auctionDatetimeParseable}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">auction_date parseable:</span>
                      <span className="ml-2 font-medium">{diagnostics.visibilityDebug.auctionDateParseable}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">visible_to_dealers = Y:</span>
                      <span className="ml-2 font-medium">{diagnostics.visibilityDebug.visibleToDealersY}</span>
                    </div>
                  </div>
                  
                  {/* Excluded samples */}
                  {diagnostics.visibilityDebug.excludedSamples.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">Sample excluded lots (first 5):</h4>
                      <div className="overflow-x-auto">
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-1 px-2">lot_id</th>
                              <th className="text-left py-1 px-2">source</th>
                              <th className="text-left py-1 px-2">auction_house</th>
                              <th className="text-left py-1 px-2">status</th>
                              <th className="text-left py-1 px-2">auction_datetime</th>
                              <th className="text-left py-1 px-2">auction_date</th>
                              <th className="text-left py-1 px-2">visible</th>
                              <th className="text-left py-1 px-2 text-red-400">excluded_reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diagnostics.visibilityDebug.excludedSamples.map((sample, i) => (
                              <tr key={i} className="border-b border-border/50">
                                <td className="py-1 px-2 font-mono">{sample.lot_id}</td>
                                <td className="py-1 px-2">{sample.source}</td>
                                <td className="py-1 px-2">{sample.auction_house}</td>
                                <td className="py-1 px-2">{sample.status}</td>
                                <td className="py-1 px-2 font-mono text-[10px]">{sample.auction_datetime}</td>
                                <td className="py-1 px-2 font-mono text-[10px]">{sample.auction_date}</td>
                                <td className="py-1 px-2">{sample.visible_to_dealers}</td>
                                <td className="py-1 px-2 text-red-400">{sample.excluded_reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
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
