import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Hunt {
  id: string;
  dealer_id: string;
  status: string;
  year: number;
  make: string;
  model: string;
  variant_family: string | null;
  fuel: string | null;
  transmission: string | null;
  drivetrain: string | null;
  km: number | null;
  km_band: string | null;
  km_tolerance_pct: number;
  proven_exit_method: string;
  proven_exit_value: number | null;
  min_gap_abs_buy: number;
  min_gap_pct_buy: number;
  min_gap_abs_watch: number;
  min_gap_pct_watch: number;
  sources_enabled: string[];
  include_private: boolean;
  states: string[] | null;
  geo_mode: string;
  max_listing_age_days_buy: number;
  max_listing_age_days_watch: number;
  // Badge Authority Layer fields
  model_root: string | null;
  series_family: string | null;
  badge: string | null;
  badge_tier: number | null;
  body_type: string | null;
  engine_family: string | null;
  // LC79 Precision Pack fields
  cab_type: string | null;
  engine_code: string | null;
  engine_litres: number | null;
  cylinders: number | null;
  // Must-have keywords for picky buyers
  must_have_raw: string | null;
  must_have_tokens: string[] | null;
  must_have_mode: 'soft' | 'strict' | null;
  // New required fields for enrichment-based hard gates
  required_badge: string | null;
  required_body_type: string | null;
  required_engine_family: string | null;
  required_engine_size_l: number | null;
  // Criteria versioning
  criteria_version: number;
}

interface Listing {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  variant_raw: string | null; // Raw variant from source
  variant_family: string | null;
  fuel: string | null;
  transmission: string | null;
  drivetrain: string | null;
  km: number | null;
  asking_price: number | null;
  state: string | null;
  source: string | null;
  first_seen_at: string;
  listing_url: string | null;
  dealer_name: string | null;
  // Badge Authority Layer fields
  model_root: string | null;
  series_family: string | null;
  badge: string | null;
  badge_tier: number | null;
  body_type: string | null;
  engine_family: string | null;
  variant_confidence: string | null;
  // LC79 Precision Pack fields
  cab_type: string | null;
  engine_code: string | null;
  engine_litres: number | null;
  cylinders: number | null;
  // Text fields for must-have matching
  title: string | null;
  description: string | null;
  // Enrichment fields
  engine_size_l: number | null;
  fuel_type: string | null;
  enrichment_status: string | null;
}

interface MatchResult {
  listing: Listing;
  score: number;
  reasons: string[];
  confidence: 'high' | 'medium' | 'low';
  decision: 'buy' | 'watch' | 'ignore' | 'no_evidence';
  gap_dollars: number | null;
  gap_pct: number | null;
  proven_exit_value: number | null;
  rejection_reason?: string;
}

// Hard gate types for Badge Authority Layer + LC79 Precision Pack + Must-have keywords
type RejectionReason = 'SERIES_MISMATCH' | 'BODY_MISMATCH' | 'ENGINE_MISMATCH' | 'BADGE_MISMATCH' | 'BADGE_TIER_MISMATCH' | 'CAB_MISMATCH' | 'MISSING_REQUIRED_TOKEN';

interface GateResult {
  passed: boolean;
  rejection_reason?: RejectionReason;
  downgrade_to_watch?: boolean;
  downgrade_reason?: string;
  missing_token?: string;
}

// ============================================
// Must-Have Token Matching
// ============================================
interface MustHaveResult {
  passed: boolean;
  matched_tokens: string[];
  missing_tokens: string[];
  score_bonus: number;
}

function checkMustHaveTokens(hunt: Hunt, listing: Listing): MustHaveResult {
  const tokens = hunt.must_have_tokens || [];
  if (tokens.length === 0) {
    return { passed: true, matched_tokens: [], missing_tokens: [], score_bonus: 0 };
  }
  
  // Build listing text blob from all available text fields
  const textBlob = [
    listing.title || '',
    listing.description || '',
    listing.variant || '',
    listing.dealer_name || ''
  ].join(' ').toUpperCase();
  
  const matched_tokens: string[] = [];
  const missing_tokens: string[] = [];
  
  for (const token of tokens) {
    if (textBlob.includes(token)) {
      matched_tokens.push(token);
    } else {
      missing_tokens.push(token);
    }
  }
  
  // Score bonus: 0.3 per matched token (up to 1.5 max)
  const score_bonus = Math.min(matched_tokens.length * 0.3, 1.5);
  
  return {
    passed: missing_tokens.length === 0,
    matched_tokens,
    missing_tokens,
    score_bonus
  };
}

// ============================================
// Badge Authority Layer - Hard Gates (with Enrichment Support)
// ============================================
function applyHardGates(hunt: Hunt, listing: Listing): GateResult {
  // ============================================
  // Badge matching - check required_badge first, then legacy badge field
  // ============================================
  
  // Determine which badge to enforce (required_badge takes priority, then legacy badge)
  const huntBadge = hunt.required_badge || hunt.badge;
  
  if (huntBadge) {
    // ALWAYS extract badge from variant_raw - stored badge field may be wrong
    // (e.g., "N PREMIUM" incorrectly stored as "PREMIUM")
    let listingBadge: string | null = null;
    
    // Extract from variant_raw (or variant) - IMPORTANT: Order matters - compound badges FIRST
    const variantText = listing.variant_raw || listing.variant;
    if (variantText) {
      const variantUpper = variantText.toUpperCase();
      // Compound badges first (most specific), then simple badges
      const badges = [
        // Hyundai i30 compound badges (order matters!)
        'N LINE PREMIUM', 'N-LINE PREMIUM', 'N LINE PRM',  // N Line with Premium package
        'N PREMIUM',                                        // i30 N with Premium trim
        'N LINE', 'N-LINE',                                 // N Line (sport appearance)
        'HEV',                                              // Hybrid Electric Vehicle
        'BEV',                                              // Battery Electric Vehicle
        'PREMIUM',                                          // Regular Premium
        'ELITE',                                            // Elite
        'ACTIVE',                                           // Active
        // Toyota badges
        'GXL', 'GX', 'VX', 'SAHARA', 'SR5', 'SR', 'WORKMATE',
        // Ford badges
        'WILDTRAK', 'XLT', 'ROGUE', 'RUGGED',
        // Generic
        'BASE'
      ];
      for (const b of badges) {
        if (variantUpper.includes(b)) {
          listingBadge = b.replace(/-/g, ' ').replace(' PRM', ' PREMIUM'); // Normalize
          break;
        }
      }
    }
    
    if (listingBadge) {
      // Normalize for comparison
      const huntBadgeNorm = huntBadge.toUpperCase().replace(/-/g, ' ').trim();
      const listingBadgeNorm = listingBadge.toUpperCase().replace(/-/g, ' ').trim();
      
      if (listingBadgeNorm !== huntBadgeNorm) {
        return { passed: false, rejection_reason: 'BADGE_MISMATCH' };
      }
    } else {
      // Badge required but listing badge unknown - downgrade to WATCH
      return { passed: true, downgrade_to_watch: true, downgrade_reason: 'BADGE_UNKNOWN_NEEDS_VERIFY' };
    }
  }
  
  // Gate: Required body type mismatch - REJECT immediately
  if (hunt.required_body_type && listing.body_type) {
    if (listing.body_type.toUpperCase() !== hunt.required_body_type.toUpperCase()) {
      return { passed: false, rejection_reason: 'BODY_MISMATCH' };
    }
  }
  // If required body but listing unknown - downgrade to WATCH, needs enrichment
  if (hunt.required_body_type && !listing.body_type) {
    return { passed: true, downgrade_to_watch: true, downgrade_reason: 'BODY_UNKNOWN_NEEDS_VERIFY' };
  }
  
  // Gate: Required engine family mismatch - REJECT immediately
  if (hunt.required_engine_family && listing.engine_family) {
    if (listing.engine_family.toUpperCase() !== hunt.required_engine_family.toUpperCase()) {
      return { passed: false, rejection_reason: 'ENGINE_MISMATCH' };
    }
  }
  // If required engine but listing unknown - downgrade to WATCH, needs enrichment
  if (hunt.required_engine_family && !listing.engine_family) {
    return { passed: true, downgrade_to_watch: true, downgrade_reason: 'ENGINE_UNKNOWN_NEEDS_VERIFY' };
  }
  
  // ============================================
  // Legacy gates (for backward compatibility)
  // ============================================
  
  // Gate A: Series mismatch - IGNORE immediately
  if (hunt.series_family && listing.series_family && 
      hunt.series_family !== listing.series_family) {
    return { passed: false, rejection_reason: 'SERIES_MISMATCH' };
  }
  
  // Gate B: Body type mismatch (legacy) - IGNORE immediately
  if (!hunt.required_body_type && hunt.body_type && listing.body_type && 
      hunt.body_type !== listing.body_type) {
    return { passed: false, rejection_reason: 'BODY_MISMATCH' };
  }
  
  // Gate C: Engine mismatch (legacy) - IGNORE immediately (or downgrade if listing unknown)
  if (!hunt.required_engine_family && hunt.engine_family && listing.engine_family && 
      hunt.engine_family !== listing.engine_family) {
    return { passed: false, rejection_reason: 'ENGINE_MISMATCH' };
  }
  // If hunt requires specific engine but listing is UNKNOWN - block BUY, allow WATCH
  if (!hunt.required_engine_family && hunt.engine_family && hunt.engine_code && 
      (!listing.engine_family || listing.engine_code === 'UNKNOWN')) {
    return { passed: true, downgrade_to_watch: true, downgrade_reason: 'ENGINE_UNKNOWN_NEEDS_VERIFY' };
  }
  
  // Gate D: Cab type mismatch (LC79 Precision Pack)
  const lockedCabTypes = ['SINGLE', 'DUAL', 'EXTRA'];
  if (hunt.cab_type && lockedCabTypes.includes(hunt.cab_type) &&
      listing.cab_type && lockedCabTypes.includes(listing.cab_type) &&
      hunt.cab_type !== listing.cab_type) {
    return { passed: false, rejection_reason: 'CAB_MISMATCH' };
  }
  // If hunt requires specific cab but listing is UNKNOWN - block BUY, allow WATCH
  if (hunt.cab_type && lockedCabTypes.includes(hunt.cab_type) &&
      (!listing.cab_type || listing.cab_type === 'UNKNOWN')) {
    return { passed: true, downgrade_to_watch: true, downgrade_reason: 'CAB_UNKNOWN_NEEDS_VERIFY' };
  }
  
  // Gate E: Badge tier mismatch > 1 - downgrade BUY to WATCH
  if (hunt.badge_tier && listing.badge_tier) {
    const tierDiff = Math.abs(hunt.badge_tier - listing.badge_tier);
    if (tierDiff > 1) {
      return { passed: true, downgrade_to_watch: true, rejection_reason: 'BADGE_TIER_MISMATCH' };
    }
  }
  
  return { passed: true };
}

// Check if listing needs deep enrichment (has required fields missing)
function needsDeepEnrichment(hunt: Hunt, listing: Listing): boolean {
  if (hunt.required_badge && !listing.badge) return true;
  if (hunt.required_body_type && !listing.body_type) return true;
  if (hunt.required_engine_family && !listing.engine_family) return true;
  if (hunt.engine_family && !listing.engine_family) return true;
  if (hunt.cab_type && !listing.cab_type) return true;
  return false;
}

// Scoring weights (total max ~10)
function scoreMatch(hunt: Hunt, listing: Listing): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  
  // Year match (0-1.5)
  if (listing.year !== null) {
    if (listing.year === hunt.year) {
      score += 1.5;
      reasons.push('year_exact');
    } else if (Math.abs(listing.year - hunt.year) === 1) {
      score += 1.0;
      reasons.push('year_adjacent');
    }
  }
  
  // Make/Model match (0-2.0)
  const listingMake = (listing.make || '').toLowerCase();
  const listingModel = (listing.model || '').toLowerCase();
  const huntMake = hunt.make.toLowerCase();
  const huntModel = hunt.model.toLowerCase();
  
  if (listingMake === huntMake && listingModel === huntModel) {
    score += 2.0;
    reasons.push('make_model_exact');
  }
  
  // Variant family match (0-1.0)
  if (hunt.variant_family && listing.variant_family) {
    const huntVf = hunt.variant_family.toLowerCase();
    const listingVf = listing.variant_family.toLowerCase();
    if (listingVf === huntVf || listingVf.includes(huntVf) || huntVf.includes(listingVf)) {
      score += 1.0;
      reasons.push('variant_family_match');
    }
  } else if (!hunt.variant_family) {
    score += 0.3; // No variant specified, partial credit
    reasons.push('variant_unknown');
  }
  
  // Series family match bonus (Badge Authority Layer)
  if (hunt.series_family && listing.series_family && 
      hunt.series_family === listing.series_family) {
    score += 0.5;
    reasons.push('series_family_match');
  }
  
  // Engine family match bonus
  if (hunt.engine_family && listing.engine_family && 
      hunt.engine_family === listing.engine_family) {
    score += 0.3;
    reasons.push('engine_family_match');
  }
  
  // Body type match bonus
  if (hunt.body_type && listing.body_type && 
      hunt.body_type === listing.body_type) {
    score += 0.2;
    reasons.push('body_type_match');
  }
  
  // Fuel/Trans/Drivetrain match (0-0.5)
  if (hunt.fuel && listing.fuel && hunt.fuel.toLowerCase() === listing.fuel.toLowerCase()) {
    score += 0.15;
    reasons.push('fuel_match');
  }
  if (hunt.transmission && listing.transmission && 
      hunt.transmission.toLowerCase() === listing.transmission.toLowerCase()) {
    score += 0.2;
    reasons.push('trans_match');
  }
  if (hunt.drivetrain && listing.drivetrain && 
      hunt.drivetrain.toLowerCase() === listing.drivetrain.toLowerCase()) {
    score += 0.15;
    reasons.push('drive_match');
  }
  
  // KM match (0-2.0)
  if (hunt.km && listing.km) {
    const tolerance = hunt.km * (hunt.km_tolerance_pct / 100);
    if (Math.abs(listing.km - hunt.km) <= tolerance) {
      score += 2.0;
      reasons.push('km_in_tolerance');
    } else {
      score += 0.5;
      reasons.push('km_out_tolerance');
    }
  } else if (listing.km) {
    score += 0.5; // Has km but no target
    reasons.push('km_present');
  }
  
  // Geo match (0-1.0)
  if (hunt.geo_mode === 'national') {
    score += 0.5;
    reasons.push('geo_national');
  } else if (hunt.states && listing.state) {
    const listingState = listing.state.toUpperCase();
    if (hunt.states.map(s => s.toUpperCase()).includes(listingState)) {
      score += 1.0;
      reasons.push('geo_state_match');
    }
  } else {
    score += 0.5; // No geo filter
    reasons.push('geo_unknown');
  }
  
  // Listing quality (0-1.0)
  if (listing.km) {
    score += 0.5;
    reasons.push('has_km');
  }
  if (listing.variant) {
    score += 0.3;
    reasons.push('has_variant');
  }
  if (listing.dealer_name || listing.state) {
    score += 0.2;
    reasons.push('has_location');
  }
  
  // Source reliability (0-1.0)
  const source = (listing.source || '').toLowerCase();
  if (source === 'autotrader' || source === 'drive') {
    score += 1.0;
    reasons.push('source_premium');
  } else if (source === 'gumtree_dealer') {
    score += 0.7;
    reasons.push('source_dealer');
  } else if (source === 'gumtree_private') {
    score += 0.4;
    reasons.push('source_private');
  }
  
  return { score: Math.round(score * 100) / 100, reasons };
}

function getConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 7.5) return 'high';
  if (score >= 6.0) return 'medium';
  return 'low';
}

async function getProvenExitValue(
  supabase: any,
  hunt: Hunt,
  listing: Listing
): Promise<number | null> {
  // First try hunt snapshot
  if (hunt.proven_exit_value) {
    return hunt.proven_exit_value;
  }
  
  // Then try proven_exits table
  const { data } = await supabase
    .from('proven_exits')
    .select('exit_value')
    .eq('make', hunt.make)
    .eq('model', hunt.model)
    .gte('year_min', hunt.year - 1)
    .lte('year_max', hunt.year + 1)
    .limit(1)
    .maybeSingle();
  
  return (data as { exit_value?: number } | null)?.exit_value || null;
}

function makeDecision(
  hunt: Hunt,
  listing: Listing,
  score: number,
  provenExitValue: number | null,
  listingAgeDays: number,
  gateResult: GateResult
): { decision: 'buy' | 'watch' | 'ignore' | 'no_evidence'; gap_dollars: number | null; gap_pct: number | null } {
  // No evidence case - still show as WATCH so user sees cheapest available
  if (!provenExitValue || !listing.asking_price) {
    return { decision: 'no_evidence', gap_dollars: null, gap_pct: null };
  }
  
  const gap_dollars = provenExitValue - listing.asking_price;
  const gap_pct = (gap_dollars / provenExitValue) * 100;
  
  // Check BUY criteria - strict thresholds
  const canBuy = 
    score >= 7.5 &&
    listingAgeDays <= hunt.max_listing_age_days_buy &&
    gap_dollars >= hunt.min_gap_abs_buy &&
    gap_pct >= hunt.min_gap_pct_buy &&
    listing.km !== null && // Must have km for BUY
    (listing.source || '').toLowerCase() !== 'gumtree_private' && // No private for BUY
    !gateResult.downgrade_to_watch; // Badge tier gate check
  
  if (canBuy) {
    return { decision: 'buy', gap_dollars, gap_pct };
  }
  
  // CRITICAL: Never ignore just because of price!
  // The user wants to see the "cheapest, closest" match even if overpriced
  // WATCH is the fallback for anything that passes hard gates
  // Only apply age filter very loosely for WATCH
  const canWatch = 
    score >= 5.0 && // Lower threshold
    listingAgeDays <= Math.max(hunt.max_listing_age_days_watch, 30); // More lenient age
  
  if (canWatch) {
    return { decision: 'watch', gap_dollars, gap_pct };
  }
  
  // Only IGNORE for very stale listings or very low match scores
  return { decision: 'ignore', gap_dollars, gap_pct };
}

// NOTE: Classification is now done in a separate batch process
// We skip inline classification to avoid timeout issues

// Ensure hunt is classified
async function ensureHuntClassified(supabase: any, huntId: string): Promise<Hunt> {
  const { data: hunt, error } = await supabase
    .from('sale_hunts')
    .select('*')
    .eq('id', huntId)
    .single();
  
  if (error) throw error;
  
  if (!hunt.series_family && hunt.make === 'TOYOTA') {
    // Classify the hunt
    await supabase.rpc('rpc_classify_hunt', { p_hunt_id: huntId });
    // Refetch
    const { data: refreshedHunt } = await supabase
      .from('sale_hunts')
      .select('*')
      .eq('id', huntId)
      .single();
    return refreshedHunt;
  }
  
  return hunt;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { hunt_id, run_all_due } = await req.json();

    let huntsToScan: Hunt[] = [];

    if (run_all_due) {
      // Get all due hunts
      const { data: dueHunts, error } = await supabase
        .from('sale_hunts')
        .select('*')
        .eq('status', 'active')
        .or(`last_scan_at.is.null,last_scan_at.lt.${new Date(Date.now() - 60 * 60 * 1000).toISOString()}`)
        .order('priority', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      huntsToScan = dueHunts || [];
    } else if (hunt_id) {
      // Get specific hunt (with classification)
      const hunt = await ensureHuntClassified(supabase, hunt_id);
      if (hunt) huntsToScan = [hunt];
    }

    const results: { hunt_id: string; matches: number; alerts: number; rejected: number }[] = [];

    for (const hunt of huntsToScan) {
      // Create scan record
      const { data: scan, error: scanErr } = await supabase
        .from('hunt_scans')
        .insert({
          hunt_id: hunt.id,
          status: 'running'
        })
        .select()
        .single();
      
      if (scanErr) {
        console.error('Failed to create scan record:', scanErr);
        continue;
      }

      try {
        // ============================================
        // REBUILD MODE: Delete stale matches before scanning
        // This ensures only current scan results are shown
        // ============================================
        const { error: deleteMatchErr } = await supabase
          .from('hunt_matches')
          .delete()
          .eq('hunt_id', hunt.id);
        
        if (deleteMatchErr) {
          console.warn(`Failed to delete old matches for hunt ${hunt.id}:`, deleteMatchErr);
        }
        
        // Build sources array
        const sources = [...hunt.sources_enabled];
        if (hunt.include_private && !sources.includes('gumtree_private')) {
          sources.push('gumtree_private');
        }

        // Query retail_listings for candidates (case-insensitive match)
        const makeUpper = hunt.make.toUpperCase();
        const modelUpper = hunt.model.toUpperCase();
        
        let query = supabase
          .from('retail_listings')
          .select('*')
          .ilike('make', makeUpper)
          .ilike('model', `${modelUpper}%`) // Allow model prefix match
          .gte('year', hunt.year - 1)
          .lte('year', hunt.year + 1)
          .is('delisted_at', null)
          .gte('first_seen_at', new Date(Date.now() - hunt.max_listing_age_days_watch * 24 * 60 * 60 * 1000).toISOString())
          .limit(500);
        
        // Filter sources client-side to handle case variations
        const { data: rawCandidates, error: candErr } = await query;
        
        // Filter by source (case-insensitive)
        const sourcesLower = sources.map(s => s.toLowerCase());
        const candidates = (rawCandidates || []).filter(c => 
          sourcesLower.includes((c.source || '').toLowerCase())
        );
        
        if (candErr) throw candErr;

        console.log(`Found ${candidates.length} candidates for hunt ${hunt.id}`);

        // ============================================
        // BATCH CLASSIFY unclassified TOYOTA LANDCRUISER listings
        // This populates series_family, body_type, cab_type, engine_family
        // ============================================
        if (makeUpper === 'TOYOTA' && modelUpper.includes('LANDCRUISER')) {
          const unclassifiedIds = candidates
            .filter((c: Listing) => !c.series_family && !c.cab_type)
            .map((c: Listing) => c.id);
          
          if (unclassifiedIds.length > 0) {
            console.log(`Classifying ${unclassifiedIds.length} unclassified Toyota LandCruiser listings...`);
            
            // Batch classify in groups of 20 to avoid timeout
            const batchSize = 20;
            for (let i = 0; i < Math.min(unclassifiedIds.length, 100); i += batchSize) {
              const batch = unclassifiedIds.slice(i, i + batchSize);
              await Promise.all(batch.map((listingId: string) =>
                supabase.rpc('rpc_classify_listing', { p_listing_id: listingId })
              ));
            }
            
            // Refetch candidates with updated classification
            const { data: refreshedCandidates } = await query;
            const refreshedFiltered = (refreshedCandidates || []).filter((c: any) => 
              sourcesLower.includes((c.source || '').toLowerCase())
            );
            // Replace candidates array with refreshed data
            candidates.length = 0;
            candidates.push(...refreshedFiltered);
            console.log(`Classification complete, ${candidates.length} candidates after refresh`);
          }
        }

        const matches: MatchResult[] = [];
        let alertsEmitted = 0;
        let rejectedCount = 0;

        // Since we delete matches at start, existingListingIds is empty
        const existingListingIds = new Set<string>();

        for (const listing of (candidates || [])) {
          // Use listing directly - classification should be done in a separate batch process
          // This avoids N+1 queries and timeout issues
          
          // Skip if already matched
          if (existingListingIds.has(listing.id)) {
            continue;
          }
          
          // ============================================
          // BADGE AUTHORITY LAYER - HARD GATES
          // Apply BEFORE scoring to reject early
          // ============================================
          const gateResult = applyHardGates(hunt, listing);
          
          // ============================================
          // DEEP ENRICHMENT: Enqueue listings with unknown required fields
          // Priority 10 = will be scraped with Firecrawl
          // ============================================
          if (needsDeepEnrichment(hunt, listing)) {
            // Enqueue for deep enrichment (high priority)
            await supabase.from('listing_enrichment_queue').upsert({
              listing_id: listing.id,
              source: listing.source || 'unknown',
              priority: 10,  // High priority = will be scraped
              status: 'queued',
              attempts: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'listing_id',
              ignoreDuplicates: false,
            });
          }
          
          if (!gateResult.passed) {
            // Store IGNORE match with rejection reason
            await supabase.from('hunt_matches').insert({
              hunt_id: hunt.id,
              listing_id: listing.id,
              match_score: 0,
              confidence_label: 'low',
              reasons: [gateResult.rejection_reason],
              asking_price: listing.asking_price,
              decision: 'ignore'
            });
            existingListingIds.add(listing.id);
            rejectedCount++;
            continue; // Skip to next listing - hard gate failed
          }
          
          // ============================================
          // MUST-HAVE KEYWORD MATCHING
          // ============================================
          const mustHaveResult = checkMustHaveTokens(hunt, listing);
          
          // In strict mode, missing tokens = IGNORE
          if (hunt.must_have_mode === 'strict' && !mustHaveResult.passed) {
            await supabase.from('hunt_matches').insert({
              hunt_id: hunt.id,
              listing_id: listing.id,
              match_score: 0,
              confidence_label: 'low',
              reasons: [`missing_required_token:${mustHaveResult.missing_tokens[0]}`],
              asking_price: listing.asking_price,
              decision: 'ignore'
            });
            existingListingIds.add(listing.id);
            rejectedCount++;
            continue; // Skip - strict mode and missing token
          }
          
          let { score, reasons } = scoreMatch(hunt, listing);
          
          // Add must-have bonus in soft mode (or matched tokens in strict)
          if (mustHaveResult.matched_tokens.length > 0) {
            score += mustHaveResult.score_bonus;
            for (const token of mustHaveResult.matched_tokens) {
              reasons.push(`must_have:${token.toLowerCase()}`);
            }
          }
          
          // Only process if above minimum threshold
          if (score < 6.0) continue;
          
          // Add gate warning to reasons if downgraded
          const finalReasons = gateResult.downgrade_to_watch 
            ? [...reasons, gateResult.rejection_reason!]
            : reasons;
          
          const provenExitValue = await getProvenExitValue(supabase, hunt, listing);
          const listingAgeDays = Math.floor((Date.now() - new Date(listing.first_seen_at).getTime()) / (24 * 60 * 60 * 1000));
          const { decision, gap_dollars, gap_pct } = makeDecision(hunt, listing, score, provenExitValue, listingAgeDays, gateResult);
          
          const confidence = getConfidence(score);

        // Insert new match with criteria_version
          await supabase.from('hunt_matches').insert({
            hunt_id: hunt.id,
            listing_id: listing.id,
            match_score: score,
            confidence_label: confidence,
            reasons: finalReasons,
            asking_price: listing.asking_price,
            proven_exit_value: provenExitValue,
            gap_dollars,
            gap_pct,
            decision,
            criteria_version: hunt.criteria_version || 1
          });
          existingListingIds.add(listing.id);

          matches.push({
            listing,
            score,
            reasons: finalReasons,
            confidence,
            decision,
            gap_dollars,
            gap_pct,
            proven_exit_value: provenExitValue,
            rejection_reason: gateResult.rejection_reason
          });

          // Create alert if BUY or WATCH (no alerts for gate-rejected)
          if (decision === 'buy' || decision === 'watch') {
            // Check if already alerted recently
            const { data: recentAlert } = await supabase
              .from('hunt_alerts')
              .select('id')
              .eq('hunt_id', hunt.id)
              .eq('listing_id', listing.id)
              .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
              .maybeSingle();

            if (!recentAlert) {
              await supabase.from('hunt_alerts').insert({
                hunt_id: hunt.id,
                listing_id: listing.id,
                alert_type: decision === 'buy' ? 'BUY' : 'WATCH',
                criteria_version: hunt.criteria_version || 1,
                payload: {
                  year: listing.year,
                  make: listing.make,
                  model: listing.model,
                  variant: listing.variant,
                  km: listing.km,
                  asking_price: listing.asking_price,
                  proven_exit_value: provenExitValue,
                  gap_dollars,
                  gap_pct,
                  source: listing.source,
                  listing_url: listing.listing_url,
                  match_score: score,
                  reasons: finalReasons,
                  // Badge Authority Layer fields
                  series_family: listing.series_family,
                  body_type: listing.body_type,
                  engine_family: listing.engine_family,
                  badge: listing.badge,
                  variant_confidence: listing.variant_confidence
                }
              });
              alertsEmitted++;
            }
          }
        }

        // Update scan record
        await supabase
          .from('hunt_scans')
          .update({
            completed_at: new Date().toISOString(),
            status: 'ok',
            candidates_checked: candidates?.length || 0,
            matches_found: matches.length,
            alerts_emitted: alertsEmitted,
            metadata: {
              sources_scanned: sources,
              rejected_by_gates: rejectedCount,
              scores: matches.map(m => ({ score: m.score, decision: m.decision }))
            }
          })
          .eq('id', scan.id);

        // Update hunt last_scan_at
        await supabase
          .from('sale_hunts')
          .update({ last_scan_at: new Date().toISOString() })
          .eq('id', hunt.id);

        // ============================================
        // TRIGGER OUTWARD HUNT (Web Discovery)
        // Always run outward search for active hunts
        // ============================================
        if (hunt.status === 'active') {
          try {
            const funcUrl = `${supabaseUrl}/functions/v1/outward-hunt`;
            await fetch(funcUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ hunt_id: hunt.id, max_results: 15 }),
            });
            console.log(`Triggered outward hunt for ${hunt.id}`);
          } catch (outwardErr) {
            console.warn(`Failed to trigger outward hunt: ${outwardErr}`);
          }
        }

        // ============================================
        // BUILD UNIFIED CANDIDATES
        // Merge internal + outward into single ranked list
        // ============================================
        try {
          const { data: unifiedResult, error: unifiedErr } = await supabase.rpc(
            'rpc_build_unified_candidates',
            { p_hunt_id: hunt.id }
          );
          if (unifiedErr) {
            console.warn(`Failed to build unified candidates: ${unifiedErr.message}`);
          } else {
            console.log(`Unified candidates built:`, unifiedResult);
          }
        } catch (unifyErr) {
          console.warn(`Unified build error: ${unifyErr}`);
        }

        results.push({
          hunt_id: hunt.id,
          matches: matches.length,
          alerts: alertsEmitted,
          rejected: rejectedCount
        });

      } catch (err) {
        // Update scan with error
        await supabase
          .from('hunt_scans')
          .update({
            completed_at: new Date().toISOString(),
            status: 'error',
            error: String(err)
          })
          .eq('id', scan.id);
        
        console.error(`Hunt ${hunt.id} failed:`, err);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        hunts_scanned: results.length,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Hunt scan error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
