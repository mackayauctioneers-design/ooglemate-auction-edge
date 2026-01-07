import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// BOB DAILY BRIEF - Market pulse + Stock comparison + Suggested focus
// ============================================================================
// SECURITY: Role determined server-side, never trust isAdmin from request
// Dealer-safe: No raw metrics, no percentages, no sample sizes, no other dealers
// Internal tiers (EARLY_PRIVATE_LED, CONFIRMED_DEALER_VALIDATED) mapped to 
// dealer-safe labels (hot/stable/cooling) only
// ============================================================================

interface MarketPulse {
  category: string;
  status: 'hot' | 'stable' | 'cooling';
  description: string;
}

interface StockComparison {
  category: string;
  status: 'faster' | 'inline' | 'slower';
  description: string;
}

interface DailyBrief {
  greeting: string;
  marketPulse: MarketPulse[];
  stockVsMarket: StockComparison[];
  suggestedFocus: string[];
  slowMoverCount: number;
  opportunityCount: number;
}

// Map internal tier to dealer-safe status (never expose internal tier names)
function tierToDealerSafeStatus(tier: string): 'hot' | 'stable' | 'cooling' {
  switch (tier) {
    case 'EARLY_PRIVATE_LED':
    case 'CONFIRMED_DEALER_VALIDATED':
      return 'hot';
    case 'COOLING':
      return 'cooling';
    default:
      return 'stable';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Service client for data queries
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { 
      dealerName = 'mate', 
      region = 'CENTRAL_COAST_NSW'
    } = body;

    // =========================================================================
    // SECURITY: Determine role server-side from JWT, NOT from request body
    // =========================================================================
    let isAdmin = false;
    const authHeader = req.headers.get('Authorization');
    
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        const token = authHeader.replace('Bearer ', '');
        const { data: claims } = await userClient.auth.getClaims(token);
        
        // Check for admin role in JWT claims or app_metadata
        if (claims?.claims) {
          const role = claims.claims.role || claims.claims.app_metadata?.role;
          isAdmin = role === 'admin';
        }
      } catch (e) {
        console.log('[bob-daily-brief] No valid JWT, treating as dealer');
      }
    }

    console.log(`[bob-daily-brief] Generating brief for ${dealerName}, region: ${region}, admin: ${isAdmin}`);

    // =========================================================================
    // Fetch geo_heat_alerts for market pulse
    // =========================================================================
    const { data: heatAlerts } = await supabase
      .from('geo_heat_alerts')
      .select('make, model, tier')
      .eq('region_id', region)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(10);

    // =========================================================================
    // Fetch fingerprint_outcomes for stock comparison (most recent date)
    // Using correct column names: cleared_total, listing_total, relisted_total
    // =========================================================================
    const { data: outcomes } = await supabase
      .from('fingerprint_outcomes')
      .select('make, model, cleared_total, listing_total, relisted_total, passed_in_total')
      .eq('region_id', region)
      .order('asof_date', { ascending: false })
      .limit(50);

    // =========================================================================
    // Fetch opportunities count (matched lots)
    // =========================================================================
    const { count: opportunityCount } = await supabase
      .from('alert_logs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'new')
      .eq('match_type', 'exact');

    // =========================================================================
    // FIX #1: Slow movers = AGED listings (21+ days old), not recent ones
    // Must be: first_seen_at <= now - 21 days, active/listed, dealer_grade
    // =========================================================================
    const twentyOneDaysAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
    
    const { count: slowMoverCount } = await supabase
      .from('vehicle_listings')
      .select('*', { count: 'exact', head: true })
      .eq('is_dealer_grade', true)
      .lte('first_seen_at', twentyOneDaysAgo)
      .in('status', ['active', 'listed', 'catalogue']);

    console.log(`[bob-daily-brief] Slow movers query: first_seen_at <= ${twentyOneDaysAgo}, found: ${slowMoverCount}`);

    // =========================================================================
    // FIX #2: Build market pulse - map internal tiers to dealer-safe labels only
    // Never expose EARLY_PRIVATE_LED or CONFIRMED_DEALER_VALIDATED to dealers
    // =========================================================================
    const marketPulse: MarketPulse[] = [];
    
    // Group alerts by dealer-safe status
    const statusGroups: Record<'hot' | 'cooling' | 'stable', string[]> = {
      hot: [],
      cooling: [],
      stable: []
    };

    for (const alert of (heatAlerts || [])) {
      const safeStatus = tierToDealerSafeStatus(alert.tier);
      const category = `${alert.make} ${alert.model}`;
      if (!statusGroups[safeStatus].includes(category)) {
        statusGroups[safeStatus].push(category);
      }
    }

    // Add hot categories (max 2)
    for (const cat of statusGroups.hot.slice(0, 2)) {
      marketPulse.push({
        category: cat,
        status: 'hot',
        description: 'Moving well'
      });
    }

    // Add cooling categories (max 2)
    for (const cat of statusGroups.cooling.slice(0, 2)) {
      marketPulse.push({
        category: cat,
        status: 'cooling',
        description: 'Slowing down'
      });
    }

    // Default stable category if nothing specific
    if (marketPulse.length === 0) {
      marketPulse.push({
        category: 'General market',
        status: 'stable',
        description: 'Normal pace'
      });
    }

    // =========================================================================
    // FIX #3: Build stock vs market from fingerprint_outcomes
    // Using correct columns: cleared_total, listing_total (not undefined)
    // =========================================================================
    const stockVsMarket: StockComparison[] = [];
    
    // Group outcomes by make for comparison
    const outcomessByMake: Record<string, typeof outcomes> = {};
    for (const o of (outcomes || [])) {
      if (!outcomessByMake[o.make]) {
        outcomessByMake[o.make] = [];
      }
      outcomessByMake[o.make]!.push(o);
    }

    // Analyze top makes
    const topMakes = Object.keys(outcomessByMake).slice(0, 3);
    for (const make of topMakes) {
      const makeOutcomes = outcomessByMake[make] || [];
      if (makeOutcomes.length === 0) continue;
      
      // Sum totals across all fingerprints for this make
      const totalCleared = makeOutcomes.reduce((sum, o) => sum + (o.cleared_total ?? 0), 0);
      const totalListed = makeOutcomes.reduce((sum, o) => sum + (o.listing_total ?? 0), 0);
      
      // Skip if no data (don't show undefined or zero defaults silently)
      if (totalListed === 0) {
        console.log(`[bob-daily-brief] Skipping ${make}: no listing data`);
        continue;
      }
      
      // Calculate clearance rate (dealer-safe, no raw numbers exposed)
      const clearanceRate = totalCleared / totalListed;
      
      let status: 'faster' | 'inline' | 'slower' = 'inline';
      let description = 'On track';
      
      if (clearanceRate > 0.6) {
        status = 'faster';
        description = 'Clearing quickly';
      } else if (clearanceRate < 0.3) {
        status = 'slower';
        description = 'Taking time';
      }

      stockVsMarket.push({ category: make, status, description });
    }

    if (stockVsMarket.length === 0) {
      stockVsMarket.push({
        category: 'Your stock',
        status: 'inline',
        description: 'Tracking normally'
      });
    }

    // =========================================================================
    // Build suggested focus (gentle prompts only, no judgment)
    // =========================================================================
    const suggestedFocus: string[] = [];
    
    if ((slowMoverCount || 0) > 3) {
      suggestedFocus.push('A few cars have been sitting - worth a look');
    }
    
    // Get first hot category for focus suggestion
    const hotCategories = statusGroups.hot;
    if (hotCategories.length > 0) {
      suggestedFocus.push(`${hotCategories[0]} is moving well in your area`);
    }
    
    if ((opportunityCount || 0) > 0) {
      suggestedFocus.push('New matches waiting in opportunities');
    }

    if (suggestedFocus.length === 0) {
      suggestedFocus.push('Keep an eye on the auction catalogue');
    }

    // Build greeting
    const timeOfDay = new Date().getHours();
    let timeGreeting = 'G\'day';
    if (timeOfDay < 12) timeGreeting = 'Morning';
    else if (timeOfDay < 17) timeGreeting = 'Afternoon';
    else timeGreeting = 'Evening';

    const brief: DailyBrief = {
      greeting: `${timeGreeting} ${dealerName}, here's your daily rundown.`,
      marketPulse,
      stockVsMarket,
      suggestedFocus,
      slowMoverCount: slowMoverCount || 0,
      opportunityCount: opportunityCount || 0
    };

    // Also build legacy briefContext for voice Bob
    const briefContext = buildVoiceBriefContext(brief);

    console.log(`[bob-daily-brief] Brief generated: ${marketPulse.length} pulse items, ${stockVsMarket.length} stock items, ${slowMoverCount} slow movers`);

    return new Response(
      JSON.stringify({ 
        brief,
        briefContext, // Legacy for voice Bob
        hasOpportunities: (opportunityCount || 0) > 0,
        opportunityCount: opportunityCount || 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("[bob-daily-brief] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Build voice context for spoken daily brief
function buildVoiceBriefContext(brief: DailyBrief): string {
  const parts: string[] = [];

  parts.push(brief.greeting);

  // Market pulse (dealer-safe labels only: hot/stable/cooling)
  if (brief.marketPulse.length > 0) {
    parts.push("Market pulse:");
    for (const item of brief.marketPulse) {
      const statusWord = item.status === 'hot' ? 'hot' : item.status === 'cooling' ? 'cooling off' : 'steady';
      parts.push(`${item.category} is ${statusWord}.`);
    }
  }

  // Stock comparison
  if (brief.stockVsMarket.length > 0) {
    parts.push("Your stock:");
    for (const item of brief.stockVsMarket) {
      const statusWord = item.status === 'faster' ? 'moving faster than market' : 
                         item.status === 'slower' ? 'taking a bit longer' : 'tracking with market';
      parts.push(`${item.category}: ${statusWord}.`);
    }
  }

  // Slow movers
  if (brief.slowMoverCount > 0) {
    parts.push(`You have ${brief.slowMoverCount} cars that have been listed for a while.`);
  }

  // Opportunities
  if (brief.opportunityCount > 0) {
    parts.push(`${brief.opportunityCount} new opportunities waiting.`);
  }

  // Suggested focus
  if (brief.suggestedFocus.length > 0) {
    parts.push("Today's focus:");
    for (const focus of brief.suggestedFocus) {
      parts.push(focus);
    }
  }

  return parts.join(' ');
}
