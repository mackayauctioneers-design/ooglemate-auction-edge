import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Outward Hunt v2 - Firecrawl-Powered Web Discovery
 * 
 * When a dealer logs a sale, this searches the ENTIRE internet for replicas.
 * Uses Firecrawl search API - not site-limited, not just our feeds.
 * 
 * Flow:
 * 1. Build intelligent search queries from hunt fingerprint
 * 2. Run Firecrawl web search for each query
 * 3. Extract & classify candidates
 * 4. Apply hard gates (series/engine/cab/body)
 * 5. Emit BUY/WATCH alerts
 */

interface Hunt {
  id: string;
  dealer_id: string;
  make: string;
  model: string;
  year: number;
  variant_family: string | null;
  series_family: string | null;
  engine_code: string | null;
  engine_family: string | null;
  body_type: string | null;
  cab_type: string | null;
  badge: string | null;
  km: number | null;
  proven_exit_value: number | null;
  min_gap_abs_buy: number;
  min_gap_pct_buy: number;
  min_gap_abs_watch: number;
  min_gap_pct_watch: number;
  must_have_tokens: string[] | null;
  must_have_mode: string | null;
}

interface IdKit {
  vin: string | null;
  rego: string | null;
  stock_no: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  badge: string | null;
  variant: string | null;
  km: number | null;
  price: number | null;
  location: string | null;
  state: string | null;
  colour: string | null;
  body: string | null;
  cab: string | null;
  engine: string | null;
  how_to_find: string;
  photo_clues: string[];
  search_string: string;
}

interface ExtractedCandidate {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  km: number | null;
  asking_price: number | null;
  location: string | null;
  engine_markers: string[];
  cab_markers: string[];
  confidence: 'high' | 'medium' | 'low';
  // ID Kit fields for blocked sources
  id_kit: IdKit;
  blocked_reason: string | null;
  requires_manual_check: boolean;
}

interface ClassificationResult {
  series_family: string | null;
  engine_family: string | null;
  body_type: string | null;
  cab_type: string | null;
  badge: string | null;
}

// Extract domain from URL
function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace('www.', '');
  } catch {
    return 'unknown';
  }
}

// Classify candidate based on text analysis
function classifyCandidate(text: string, hunt: Hunt): ClassificationResult {
  const upper = text.toUpperCase();
  
  const result: ClassificationResult = {
    series_family: null,
    engine_family: null,
    body_type: null,
    cab_type: null,
    badge: null,
  };
  
  // Series family detection (LandCruiser specific)
  if (upper.includes('LC79') || upper.includes('79 SERIES') || upper.includes('GDJ79') || upper.includes('VDJ79')) {
    result.series_family = 'LC70';
  } else if (upper.includes('LC300') || upper.includes('300 SERIES')) {
    result.series_family = 'LC300';
  } else if (upper.includes('LC200') || upper.includes('200 SERIES')) {
    result.series_family = 'LC200';
  } else if (upper.includes('LC76') || upper.includes('76 SERIES')) {
    result.series_family = 'LC70';
  }
  
  // Engine family detection
  if (upper.includes('VDJ') || upper.includes('V8 DIESEL') || upper.includes('4.5L DIESEL') || upper.includes('4.5 DIESEL')) {
    result.engine_family = 'V8_DIESEL';
  } else if (upper.includes('GDJ') || upper.includes('2.8L') || upper.includes('2.8 DIESEL') || upper.includes('4CYL DIESEL') || upper.includes('4 CYL DIESEL')) {
    result.engine_family = 'I4_DIESEL';
  } else if (upper.includes('V6 PETROL') || upper.includes('4.0L PETROL') || upper.includes('GRJ')) {
    result.engine_family = 'V6_PETROL';
  } else if (upper.includes('TWIN TURBO') || upper.includes('3.3L DIESEL') || upper.includes('3.3 DIESEL')) {
    result.engine_family = 'V6_DIESEL_TT';
  }
  
  // Cab type detection
  if (upper.includes('DUAL CAB') || upper.includes('DOUBLE CAB') || upper.includes('D/CAB')) {
    result.cab_type = 'DUAL';
  } else if (upper.includes('SINGLE CAB') || upper.includes('S/CAB')) {
    result.cab_type = 'SINGLE';
  } else if (upper.includes('EXTRA CAB') || upper.includes('KING CAB') || upper.includes('SPACE CAB')) {
    result.cab_type = 'EXTRA';
  }
  
  // Body type detection
  if (upper.includes('CAB CHASSIS') || upper.includes('TRAY') || upper.includes('UTE')) {
    result.body_type = 'CAB_CHASSIS';
  } else if (upper.includes('WAGON') || upper.includes('SUV')) {
    result.body_type = 'WAGON';
  }
  
  // Badge detection
  const badges = ['WORKMATE', 'GXL', 'GX', 'VX', 'SAHARA', 'SR5', 'SR', 'WILDTRAK', 'XLT', 'ROGUE', 'RUGGED'];
  for (const badge of badges) {
    if (upper.includes(badge)) {
      result.badge = badge;
      break;
    }
  }
  
  return result;
}

// Apply hard gates - returns reject reasons or empty array if passes
function applyHardGates(
  classification: ClassificationResult,
  hunt: Hunt,
  candidateText: string
): string[] {
  const rejectReasons: string[] = [];
  const upper = candidateText.toUpperCase();
  
  // Series mismatch
  if (hunt.series_family && classification.series_family && 
      hunt.series_family !== classification.series_family) {
    rejectReasons.push(`SERIES_MISMATCH:${classification.series_family}`);
  }
  
  // Engine mismatch (critical for LC79)
  if (hunt.engine_family && classification.engine_family &&
      hunt.engine_family !== classification.engine_family) {
    rejectReasons.push(`ENGINE_MISMATCH:${classification.engine_family}`);
  }
  
  // Cab type mismatch
  if (hunt.cab_type && classification.cab_type &&
      hunt.cab_type !== classification.cab_type) {
    rejectReasons.push(`CAB_MISMATCH:${classification.cab_type}`);
  }
  
  // Body type mismatch
  if (hunt.body_type && classification.body_type &&
      hunt.body_type !== classification.body_type) {
    rejectReasons.push(`BODY_MISMATCH:${classification.body_type}`);
  }
  
  // Must-have tokens (strict mode)
  if (hunt.must_have_mode === 'strict' && hunt.must_have_tokens && hunt.must_have_tokens.length > 0) {
    for (const token of hunt.must_have_tokens) {
      if (!upper.includes(token.toUpperCase())) {
        rejectReasons.push(`MISSING_REQUIRED_TOKEN:${token}`);
      }
    }
  }
  
  return rejectReasons;
}

// Sites that block direct access
const BLOCKED_DOMAINS = ['carsales.com.au', 'carsales.com'];

// Extract VIN from text (17 character alphanumeric, no I/O/Q)
function extractVin(text: string): string | null {
  const vinMatch = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i);
  return vinMatch ? vinMatch[0].toUpperCase() : null;
}

// Extract Australian registration plate from text
function extractRego(text: string): string | null {
  // Common AU formats: ABC123, ABC12A, 123ABC, 1ABC23, etc.
  // Also capture "rego:" or "registration:" prefixes
  const regoPatterns = [
    /(?:rego|registration|plate)[:\s]*([A-Z0-9]{1,3}[\s-]?[A-Z0-9]{2,4})/i,
    /\b([A-Z]{2,3}[\s-]?[0-9]{2,3}[\s-]?[A-Z0-9]{0,3})\b/i,
    /\b([0-9]{1,3}[\s-]?[A-Z]{2,3}[\s-]?[0-9]{0,3})\b/i,
  ];
  
  for (const pattern of regoPatterns) {
    const match = text.match(pattern);
    if (match) {
      const rego = match[1].replace(/[\s-]/g, '').toUpperCase();
      // Validate: 4-7 characters, alphanumeric
      if (rego.length >= 4 && rego.length <= 7 && /^[A-Z0-9]+$/.test(rego)) {
        return rego;
      }
    }
  }
  return null;
}

// Extract stock number from text
function extractStockNo(text: string): string | null {
  const stockPatterns = [
    /(?:stock\s*(?:no|number|#|id))[:\s]*([A-Z0-9-]+)/i,
    /(?:stk)[:\s]*([A-Z0-9-]+)/i,
  ];
  
  for (const pattern of stockPatterns) {
    const match = text.match(pattern);
    if (match && match[1].length >= 3 && match[1].length <= 20) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

// Extract location/state from text
function extractLocation(text: string): { location: string | null; state: string | null } {
  const states = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
  const stateMatch = text.match(new RegExp(`\\b(${states.join('|')})\\b`, 'i'));
  const state = stateMatch ? stateMatch[1].toUpperCase() : null;
  
  // Try to find suburb/city before state
  const locationPatterns = [
    /(?:located?\s*(?:in|at)?|location)[:\s]*([A-Za-z\s]+?)(?:,|\s+(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT))/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i,
  ];
  
  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match) {
      const loc = match[1].trim();
      if (loc.length >= 3 && loc.length <= 30) {
        return { location: loc, state };
      }
    }
  }
  
  return { location: null, state };
}

// Extract colour from text
function extractColour(text: string): string | null {
  const colours = ['white', 'black', 'silver', 'grey', 'gray', 'blue', 'red', 'green', 
                   'bronze', 'gold', 'brown', 'beige', 'orange', 'yellow', 'burgundy'];
  for (const colour of colours) {
    if (text.toLowerCase().includes(colour)) {
      return colour.charAt(0).toUpperCase() + colour.slice(1);
    }
  }
  return null;
}

// Extract photo clues from text
function extractPhotoClues(text: string): string[] {
  const clues: string[] = [];
  const textUpper = text.toUpperCase();
  
  // Tray/accessories
  if (/NORWELD/i.test(text)) clues.push('Norweld tray');
  if (/BULLBAR|BULL\s*BAR/i.test(text)) clues.push('Bullbar');
  if (/SNORKEL/i.test(text)) clues.push('Snorkel');
  if (/WINCH/i.test(text)) clues.push('Winch');
  if (/CANOPY/i.test(text)) clues.push('Canopy');
  if (/TRAY/i.test(text)) clues.push('Tray');
  if (/TOOLBOX/i.test(text)) clues.push('Toolbox');
  if (/ROOF\s*RACK/i.test(text)) clues.push('Roof rack');
  if (/LIFT\s*KIT|LIFTED/i.test(text)) clues.push('Lifted');
  
  // Cab/body
  if (textUpper.includes('DUAL CAB')) clues.push('Dual cab');
  if (textUpper.includes('SINGLE CAB')) clues.push('Single cab');
  if (textUpper.includes('UTE')) clues.push('Ute');
  if (textUpper.includes('WAGON')) clues.push('Wagon');
  
  // Colour
  const colour = extractColour(text);
  if (colour) clues.push(colour);
  
  return clues;
}

// Extract candidate data from search result
function extractCandidate(
  result: { url: string; title?: string; description?: string; markdown?: string },
  hunt: Hunt
): ExtractedCandidate | null {
  const url = result.url;
  const title = result.title || '';
  const snippet = result.description || result.markdown?.slice(0, 500) || '';
  const fullText = `${title} ${snippet}`;
  
  // Skip non-listing pages
  if (url.includes('/search') || url.includes('/login') || url.includes('/category') || 
      url.includes('/about') || url.includes('/contact') || url.includes('/help')) {
    return null;
  }
  
  const domain = extractDomain(url);
  const isBlocked = BLOCKED_DOMAINS.some(d => domain.includes(d));
  
  // Extract year
  const yearMatch = fullText.match(/\b(20[1-2][0-9])\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  
  // Skip if year too far from hunt year
  if (year && Math.abs(year - hunt.year) > 3) {
    return null;
  }
  
  // Check if make/model mentioned
  const textLower = fullText.toLowerCase();
  const huntMakeLower = hunt.make.toLowerCase();
  const huntModelLower = hunt.model.toLowerCase();
  
  if (!textLower.includes(huntMakeLower) && !textLower.includes(huntModelLower)) {
    return null;
  }
  
  // CRITICAL: Exclude Prado if hunting LandCruiser, and vice versa
  // They share "LandCruiser" in name but are completely different vehicles
  if (huntModelLower === 'landcruiser') {
    if (textLower.includes('prado') || textLower.includes('land cruiser prado')) {
      return null; // Skip Prado results when hunting for LandCruiser
    }
  }
  if (huntModelLower === 'prado' || huntModelLower === 'landcruiser prado') {
    // For Prado hunts, require "prado" in the text
    if (!textLower.includes('prado')) {
      return null;
    }
  }
  
  // Extract price
  const priceMatch = fullText.match(/\$\s*([\d,]+)/);
  let asking_price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
  
  // Skip unrealistic prices
  if (asking_price && (asking_price < 5000 || asking_price > 500000)) {
    asking_price = null;
  }
  
  // Extract km
  const kmMatch = fullText.match(/([\d,]+)\s*k?m/i);
  const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, ''), 10) : null;
  
  // Engine markers
  const engineMarkers: string[] = [];
  if (/V8|VDJ|4\.5L/i.test(fullText)) engineMarkers.push('V8');
  if (/2\.8L?|GDJ|4CYL/i.test(fullText)) engineMarkers.push('4CYL');
  if (/V6|GRJ|4\.0L/i.test(fullText)) engineMarkers.push('V6');
  
  // Cab markers
  const cabMarkers: string[] = [];
  if (/DUAL\s*CAB|DOUBLE\s*CAB|D\/CAB/i.test(fullText)) cabMarkers.push('DUAL');
  if (/SINGLE\s*CAB|S\/CAB/i.test(fullText)) cabMarkers.push('SINGLE');
  
  // Confidence scoring
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (year && asking_price && textLower.includes(huntMakeLower) && textLower.includes(huntModelLower)) {
    confidence = 'high';
  } else if ((year || asking_price) && (textLower.includes(huntMakeLower) || textLower.includes(huntModelLower))) {
    confidence = 'medium';
  }
  
  // Extract ID Kit fields
  const vin = extractVin(fullText);
  const rego = extractRego(fullText);
  const stock_no = extractStockNo(fullText);
  const { location, state } = extractLocation(fullText);
  const colour = extractColour(fullText);
  const photo_clues = extractPhotoClues(fullText);
  
  // Detect badge
  const badges = ['WORKMATE', 'GXL', 'GX', 'VX', 'SAHARA', 'SR5', 'SR', 'WILDTRAK', 'XLT', 'ROGUE', 'RUGGED'];
  let badge: string | null = null;
  for (const b of badges) {
    if (fullText.toUpperCase().includes(b)) {
      badge = b;
      break;
    }
  }
  
  // Detect body/cab
  let body: string | null = null;
  if (fullText.toUpperCase().includes('CAB CHASSIS') || fullText.toUpperCase().includes('TRAY') || fullText.toUpperCase().includes('UTE')) {
    body = 'CAB_CHASSIS';
  } else if (fullText.toUpperCase().includes('WAGON') || fullText.toUpperCase().includes('SUV')) {
    body = 'WAGON';
  }
  
  let cab: string | null = cabMarkers[0] || null;
  
  // Build search string
  const searchParts: string[] = [];
  if (year) searchParts.push(String(year));
  if (hunt.make) searchParts.push(hunt.make);
  if (hunt.model) searchParts.push(hunt.model);
  if (badge) searchParts.push(badge);
  if (km) searchParts.push(`${km.toLocaleString()}km`);
  if (location) searchParts.push(location);
  if (state) searchParts.push(state);
  
  const id_kit: IdKit = {
    vin,
    rego,
    stock_no,
    year,
    make: textLower.includes(huntMakeLower) ? hunt.make : null,
    model: textLower.includes(huntModelLower) ? hunt.model : null,
    badge,
    variant: null,
    km,
    price: asking_price,
    location,
    state,
    colour,
    body,
    cab,
    engine: engineMarkers[0] || null,
    how_to_find: vin ? 'Search by VIN' : rego ? 'Search by Rego' : 'Search by filters',
    photo_clues,
    search_string: searchParts.join(' '),
  };
  
  return {
    url,
    domain,
    title: title.slice(0, 200),
    snippet: snippet.slice(0, 500),
    year,
    make: textLower.includes(huntMakeLower) ? hunt.make : null,
    model: textLower.includes(huntModelLower) ? hunt.model : null,
    variant_raw: null,
    km,
    asking_price,
    location,
    engine_markers: engineMarkers,
    cab_markers: cabMarkers,
    confidence,
    id_kit,
    blocked_reason: isBlocked ? 'anti-scraping' : null,
    requires_manual_check: isBlocked,
  };
}

// Score candidate and determine decision
function scoreAndDecide(
  candidate: ExtractedCandidate,
  classification: ClassificationResult,
  hunt: Hunt
): { score: number; decision: 'BUY' | 'WATCH' | 'IGNORE'; reasons: string[] } {
  let score = 5.0;
  const reasons: string[] = [];
  
  // Year match
  if (candidate.year) {
    if (candidate.year === hunt.year) {
      score += 1.5;
      reasons.push('exact_year_match');
    } else if (Math.abs(candidate.year - hunt.year) === 1) {
      score += 0.5;
      reasons.push('adjacent_year');
    }
  }
  
  // Make/model match
  if (candidate.make?.toUpperCase() === hunt.make.toUpperCase()) score += 1.0;
  if (candidate.model?.toUpperCase() === hunt.model.toUpperCase()) score += 1.0;
  
  // Classification matches
  if (classification.series_family === hunt.series_family) {
    score += 0.5;
    reasons.push('series_match');
  }
  if (classification.engine_family === hunt.engine_family) {
    score += 0.5;
    reasons.push('engine_match');
  }
  
  // Price gap calculation
  let gap_dollars = 0;
  let gap_pct = 0;
  
  if (candidate.asking_price && hunt.proven_exit_value) {
    gap_dollars = hunt.proven_exit_value - candidate.asking_price;
    gap_pct = (gap_dollars / hunt.proven_exit_value) * 100;
    
    if (gap_pct >= 10) {
      score += 1.5;
      reasons.push(`gap_${gap_pct.toFixed(0)}pct`);
    } else if (gap_pct >= 5) {
      score += 1.0;
      reasons.push(`gap_${gap_pct.toFixed(0)}pct`);
    } else if (gap_pct >= 0) {
      score += 0.5;
    } else {
      score -= 1.0;
      reasons.push('overpriced');
    }
  }
  
  // Confidence boost
  if (candidate.confidence === 'high') {
    score += 0.5;
    reasons.push('high_confidence');
  }
  
  // Source boost for auctions
  if (['pickles.com.au', 'manheim.com.au', 'grays.com', 'lloydsauctions.com.au'].includes(candidate.domain)) {
    score += 0.5;
    reasons.push('auction_source');
  }
  
  // Cap score
  score = Math.min(10, Math.max(0, score));
  
  // Decision logic - NEVER ignore just because of price
  // The user wants to see the "cheapest, closest" match even if overpriced
  const canBuy = 
    score >= 7.0 &&
    gap_dollars >= hunt.min_gap_abs_buy &&
    gap_pct >= hunt.min_gap_pct_buy &&
    candidate.confidence !== 'low';
  
  // WATCH is the fallback for anything that passes hard gates
  // Price doesn't disqualify - we want to show "best available" even if overpriced
  const canWatch = score >= 5.0; // Lower threshold - show more results
  
  if (canBuy) return { score, decision: 'BUY', reasons };
  if (canWatch) return { score, decision: 'WATCH', reasons };
  return { score, decision: 'IGNORE', reasons }; // Only for very low scores (wrong make/model)
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    
    if (!firecrawlKey) {
      throw new Error("FIRECRAWL_API_KEY not configured. Connect Firecrawl in Settings → Connectors.");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { hunt_id, max_results = 10 } = await req.json().catch(() => ({}));
    
    if (!hunt_id) {
      throw new Error("hunt_id is required");
    }
    
    // Get hunt details
    const { data: hunt, error: huntError } = await supabase
      .from('sale_hunts')
      .select('*')
      .eq('id', hunt_id)
      .single();
    
    if (huntError || !hunt) {
      throw new Error(`Hunt not found: ${huntError?.message || 'unknown'}`);
    }
    
    // Build search queries using the RPC
    const { data: queries, error: queriesError } = await supabase
      .rpc('rpc_build_outward_queries', { p_hunt_id: hunt_id });
    
    if (queriesError || !queries || queries.length === 0) {
      console.log('No queries generated, using fallback');
    }
    
    const searchQueries: string[] = queries || [
      `${hunt.year} ${hunt.make} ${hunt.model} for sale Australia`
    ];
    
    console.log(`Outward hunt for ${hunt_id}: ${searchQueries.length} queries`);
    
    // Create run record
    const { data: run, error: runError } = await supabase
      .from('outward_hunt_runs')
      .insert({
        hunt_id,
        dealer_id: hunt.dealer_id,
        status: 'running',
        provider: 'firecrawl',
        queries: searchQueries,
      })
      .select()
      .single();
    
    if (runError) {
      console.error('Failed to create run record:', runError);
    }
    
    const results = {
      queries_run: 0,
      results_found: 0,
      candidates_created: 0,
      candidates_rejected: 0,
      alerts_emitted: 0,
      reject_reasons: {} as Record<string, number>,
      errors: [] as string[],
    };
    
    // Run Firecrawl search for each query (limit to first 4 for speed)
    const queriesToRun = searchQueries.slice(0, 4);
    
    for (const query of queriesToRun) {
      try {
        console.log(`Searching: ${query}`);
        
        const searchRes = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            limit: max_results,
            lang: "en",
            country: "AU",
            scrapeOptions: {
              formats: ["markdown"],
            },
          }),
        });
        
        results.queries_run++;
        
        if (!searchRes.ok) {
          const errText = await searchRes.text();
          console.error(`Firecrawl search error:`, errText);
          results.errors.push(`Search error: ${errText.slice(0, 100)}`);
          continue;
        }
        
        const searchData = await searchRes.json();
        const searchResults = searchData.data || [];
        results.results_found += searchResults.length;
        
        console.log(`Query "${query.slice(0, 50)}..." returned ${searchResults.length} results`);
        
        // Process each search result
        for (const result of searchResults) {
          try {
            // Extract candidate
            const candidate = extractCandidate(result, hunt as Hunt);
            if (!candidate) continue;
            
            const fullText = `${candidate.title} ${candidate.snippet}`;
            
            // Classify
            const classification = classifyCandidate(fullText, hunt as Hunt);
            
            // Apply hard gates
            const rejectReasons = applyHardGates(classification, hunt as Hunt, fullText);
            
            // Track rejection reasons
            for (const reason of rejectReasons) {
              const key = reason.split(':')[0];
              results.reject_reasons[key] = (results.reject_reasons[key] || 0) + 1;
            }
            
            if (rejectReasons.length > 0) {
              results.candidates_rejected++;
              
              // Still save to outward_candidates but as IGNORE
              await supabase
                .from('outward_candidates')
                .upsert({
                  hunt_id,
                  url: candidate.url,
                  domain: candidate.domain,
                  title: candidate.title,
                  snippet: candidate.snippet,
                  provider: 'firecrawl',
                  extracted: {
                    year: candidate.year,
                    make: candidate.make,
                    model: candidate.model,
                    km: candidate.km,
                    asking_price: candidate.asking_price,
                  },
                  classification,
                  match_score: 0,
                  decision: 'IGNORE',
                  reasons: rejectReasons,
                  // ID Kit fields for blocked sources
                  id_kit: candidate.id_kit,
                  blocked_reason: candidate.blocked_reason,
                  requires_manual_check: candidate.requires_manual_check,
                }, { onConflict: 'hunt_id,url' });
              
              continue;
            }
            
            // Score and decide
            const { score, decision, reasons } = scoreAndDecide(candidate, classification, hunt as Hunt);
            
            // Upsert to outward_candidates and get the ID
            const { data: upsertedCandidate, error: upsertError } = await supabase
              .from('outward_candidates')
              .upsert({
                hunt_id,
                url: candidate.url,
                domain: candidate.domain,
                title: candidate.title,
                snippet: candidate.snippet,
                provider: 'firecrawl',
                source: 'outward_web',
                extracted: {
                  year: candidate.year,
                  make: candidate.make,
                  model: candidate.model,
                  km: candidate.km,
                  asking_price: candidate.asking_price,
                  confidence: candidate.confidence,
                },
                classification,
                match_score: score,
                decision,
                reasons,
                alert_emitted: false,
                // ID Kit fields for blocked sources
                id_kit: candidate.id_kit,
                blocked_reason: candidate.blocked_reason,
                requires_manual_check: candidate.requires_manual_check,
              }, { onConflict: 'hunt_id,url' })
              .select('id, alert_emitted')
              .single();
            
            if (!upsertError && upsertedCandidate) {
              results.candidates_created++;
              
              // Emit alert for BUY/WATCH
              if ((decision === 'BUY' || decision === 'WATCH') && !upsertedCandidate.alert_emitted) {
                const alertPayload = {
                  year: candidate.year,
                  make: candidate.make,
                  model: candidate.model,
                  variant: candidate.variant_raw,
                  km: candidate.km,
                  asking_price: candidate.asking_price,
                  proven_exit_value: hunt.proven_exit_value,
                  gap_dollars: hunt.proven_exit_value && candidate.asking_price 
                    ? hunt.proven_exit_value - candidate.asking_price 
                    : null,
                  gap_pct: hunt.proven_exit_value && candidate.asking_price 
                    ? ((hunt.proven_exit_value - candidate.asking_price) / hunt.proven_exit_value) * 100 
                    : null,
                  match_score: score,
                  source: `Web Discovery (${candidate.domain})`,
                  source_type: 'outward',
                  listing_url: candidate.url,
                  classification,
                  reasons,
                };
                
                // Use the outward_candidate UUID as the listing_id
                const { error: alertErr } = await supabase.from('hunt_alerts').insert({
                  hunt_id,
                  listing_id: upsertedCandidate.id,  // Use the actual UUID
                  alert_type: decision,
                  payload: alertPayload,
                });
                
                if (!alertErr) {
                  await supabase
                    .from('outward_candidates')
                    .update({ alert_emitted: true })
                    .eq('id', upsertedCandidate.id);
                  
                  results.alerts_emitted++;
                } else {
                  console.error('Failed to insert alert:', alertErr.message);
                }
              }
            }
          } catch (err) {
            console.error('Error processing result:', err);
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Error with query:`, errMsg);
        results.errors.push(errMsg);
      }
    }
    
    // Update run record
    if (run?.id) {
      await supabase
        .from('outward_hunt_runs')
        .update({
          status: results.errors.length === 0 ? 'success' : 'partial',
          finished_at: new Date().toISOString(),
          results_found: results.results_found,
          candidates_created: results.candidates_created,
          error: results.errors.length > 0 ? results.errors.join('; ') : null,
        })
        .eq('id', run.id);
    }
    
    // Update hunt last_outward_scan_at
    await supabase
      .from('sale_hunts')
      .update({ last_outward_scan_at: new Date().toISOString() })
      .eq('id', hunt_id);
    
    // ============================================
    // BUILD UNIFIED CANDIDATES after outward search
    // This merges outward candidates with internal matches
    // ============================================
    try {
      const { data: unifiedResult, error: unifiedErr } = await supabase.rpc(
        'rpc_build_unified_candidates',
        { p_hunt_id: hunt_id }
      );
      if (unifiedErr) {
        console.warn(`Failed to build unified candidates: ${unifiedErr.message}`);
      } else {
        console.log(`Unified candidates built after outward:`, unifiedResult);
      }
    } catch (unifyErr) {
      console.warn(`Unified build error: ${unifyErr}`);
    }
    
    console.log('Outward hunt complete:', results);
    
    return new Response(JSON.stringify({
      success: true,
      ...results,
      duration_ms: Date.now() - startTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    
  } catch (error) {
    console.error("Outward hunt error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    }), { 
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});