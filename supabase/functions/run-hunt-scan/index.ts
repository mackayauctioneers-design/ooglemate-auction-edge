import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Hunt {
  id: string;
  dealer_id: string;
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
}

interface Listing {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
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
  supabase: ReturnType<typeof createClient>,
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
  
  return data?.exit_value || null;
}

function makeDecision(
  hunt: Hunt,
  listing: Listing,
  score: number,
  provenExitValue: number | null,
  listingAgeDays: number
): { decision: 'buy' | 'watch' | 'ignore' | 'no_evidence'; gap_dollars: number | null; gap_pct: number | null } {
  // No evidence case
  if (!provenExitValue || !listing.asking_price) {
    return { decision: 'no_evidence', gap_dollars: null, gap_pct: null };
  }
  
  const gap_dollars = provenExitValue - listing.asking_price;
  const gap_pct = (gap_dollars / provenExitValue) * 100;
  
  // Check BUY criteria
  const canBuy = 
    score >= 7.5 &&
    listingAgeDays <= hunt.max_listing_age_days_buy &&
    gap_dollars >= hunt.min_gap_abs_buy &&
    gap_pct >= hunt.min_gap_pct_buy &&
    listing.km !== null && // Must have km for BUY
    (listing.source || '').toLowerCase() !== 'gumtree_private'; // No private for BUY
  
  if (canBuy) {
    return { decision: 'buy', gap_dollars, gap_pct };
  }
  
  // Check WATCH criteria
  const canWatch = 
    score >= 6.5 &&
    listingAgeDays <= hunt.max_listing_age_days_watch &&
    (gap_dollars >= hunt.min_gap_abs_watch || gap_pct >= hunt.min_gap_pct_watch);
  
  if (canWatch) {
    return { decision: 'watch', gap_dollars, gap_pct };
  }
  
  return { decision: 'ignore', gap_dollars, gap_pct };
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
      // Get specific hunt
      const { data: hunt, error } = await supabase
        .from('sale_hunts')
        .select('*')
        .eq('id', hunt_id)
        .single();
      
      if (error) throw error;
      if (hunt) huntsToScan = [hunt];
    }

    const results: { hunt_id: string; matches: number; alerts: number }[] = [];

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
        // Build sources array
        const sources = [...hunt.sources_enabled];
        if (hunt.include_private && !sources.includes('gumtree_private')) {
          sources.push('gumtree_private');
        }

        // Query retail_listings for candidates
        let query = supabase
          .from('retail_listings')
          .select('*')
          .eq('make', hunt.make)
          .eq('model', hunt.model)
          .gte('year', hunt.year - 1)
          .lte('year', hunt.year + 1)
          .is('delisted_at', null)
          .in('source', sources)
          .gte('first_seen_at', new Date(Date.now() - hunt.max_listing_age_days_watch * 24 * 60 * 60 * 1000).toISOString())
          .limit(500);

        const { data: candidates, error: candErr } = await query;
        
        if (candErr) throw candErr;

        const matches: MatchResult[] = [];
        let alertsEmitted = 0;

        for (const listing of (candidates || [])) {
          const { score, reasons } = scoreMatch(hunt, listing);
          
          // Only process if above minimum threshold
          if (score < 6.0) continue;
          
          const provenExitValue = await getProvenExitValue(supabase, hunt, listing);
          const listingAgeDays = Math.floor((Date.now() - new Date(listing.first_seen_at).getTime()) / (24 * 60 * 60 * 1000));
          const { decision, gap_dollars, gap_pct } = makeDecision(hunt, listing, score, provenExitValue, listingAgeDays);
          
          const confidence = getConfidence(score);

          // Check for existing match to dedupe
          const { data: existingMatch } = await supabase
            .from('hunt_matches')
            .select('id')
            .eq('hunt_id', hunt.id)
            .eq('listing_id', listing.id)
            .maybeSingle();

          if (!existingMatch) {
            // Insert new match
            await supabase.from('hunt_matches').insert({
              hunt_id: hunt.id,
              listing_id: listing.id,
              match_score: score,
              confidence_label: confidence,
              reasons,
              asking_price: listing.asking_price,
              proven_exit_value: provenExitValue,
              gap_dollars,
              gap_pct,
              decision
            });

            matches.push({
              listing,
              score,
              reasons,
              confidence,
              decision,
              gap_dollars,
              gap_pct,
              proven_exit_value: provenExitValue
            });

            // Create alert if BUY or WATCH
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
                    reasons
                  }
                });
                alertsEmitted++;
              }
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
              scores: matches.map(m => ({ score: m.score, decision: m.decision }))
            }
          })
          .eq('id', scan.id);

        // Update hunt last_scan_at
        await supabase
          .from('sale_hunts')
          .update({ last_scan_at: new Date().toISOString() })
          .eq('id', hunt.id);

        results.push({
          hunt_id: hunt.id,
          matches: matches.length,
          alerts: alertsEmitted
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
