import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// BOB DAILY BRIEF - Market pulse + Stock comparison + Suggested focus
// ============================================================================
// Dealer-safe: No raw metrics, no percentages, no sample sizes, no other dealers
// Internal: Full detail available when isAdmin=true
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const { 
      dealerName = 'mate', 
      region = 'CENTRAL_COAST_NSW',
      isAdmin = false 
    } = body;

    console.log(`[bob-daily-brief] Generating brief for ${dealerName}, region: ${region}, admin: ${isAdmin}`);

    // Fetch geo_heat_alerts for market pulse
    const { data: heatAlerts } = await supabase
      .from('geo_heat_alerts')
      .select('*')
      .eq('region_id', region)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(10);

    // Fetch fingerprint_outcomes for stock comparison (most recent date)
    const { data: outcomes } = await supabase
      .from('fingerprint_outcomes')
      .select('*')
      .eq('region_id', region)
      .order('asof_date', { ascending: false })
      .limit(50);

    // Fetch opportunities count (matched lots)
    const { count: opportunityCount } = await supabase
      .from('alert_logs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'new')
      .eq('match_type', 'exact');

    // Fetch slow movers (fatigue listings)
    const { count: slowMoverCount } = await supabase
      .from('vehicle_listings')
      .select('*', { count: 'exact', head: true })
      .eq('is_dealer_grade', true)
      .gte('first_seen_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .eq('status', 'listed');

    // Build market pulse from heat alerts (dealer-safe language)
    const marketPulse: MarketPulse[] = [];
    
    // Group alerts by tier
    const hotAlerts = (heatAlerts || []).filter(a => 
      a.tier === 'EARLY_PRIVATE_LED' || a.tier === 'CONFIRMED_DEALER_VALIDATED'
    );
    const coolingAlerts = (heatAlerts || []).filter(a => a.tier === 'COOLING');

    // Summarize by category (make-model groups)
    const hotCategories = new Set(hotAlerts.map(a => `${a.make} ${a.model}`));
    const coolingCategories = new Set(coolingAlerts.map(a => `${a.make} ${a.model}`));

    // Add hot categories
    for (const cat of Array.from(hotCategories).slice(0, 2)) {
      marketPulse.push({
        category: cat,
        status: 'hot',
        description: 'Moving well'
      });
    }

    // Add cooling categories
    for (const cat of Array.from(coolingCategories).slice(0, 2)) {
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

    // Build stock vs market comparison from fingerprint outcomes
    const stockVsMarket: StockComparison[] = [];
    
    // Group outcomes by make for comparison
    const outcomessByMake: Record<string, NonNullable<typeof outcomes>> = {};
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
      
      const avgCleared = makeOutcomes.reduce((sum, o) => sum + (o.cleared_total || 0), 0) / makeOutcomes.length;
      const avgListed = makeOutcomes.reduce((sum, o) => sum + (o.listing_total || 0), 0) / makeOutcomes.length;
      
      // Calculate clearance rate (dealer-safe, no raw numbers)
      const clearanceRate = avgListed > 0 ? avgCleared / avgListed : 0;
      
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

    // Build suggested focus (gentle prompts only, no judgment)
    const suggestedFocus: string[] = [];
    
    if ((slowMoverCount || 0) > 3) {
      suggestedFocus.push('A few cars have been sitting - worth a look');
    }
    
    if (hotAlerts.length > 0) {
      suggestedFocus.push(`${hotAlerts[0].make} ${hotAlerts[0].model} is moving well in your area`);
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

    console.log(`[bob-daily-brief] Brief generated: ${marketPulse.length} pulse items, ${stockVsMarket.length} stock items`);

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

  // Market pulse
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
      const statusWord = item.status === 'faster' ? 'moving well' : item.status === 'slower' ? 'taking its time' : 'on track';
      parts.push(`${item.category} is ${statusWord}.`);
    }
  }

  // Focus
  if (brief.suggestedFocus.length > 0) {
    parts.push("Quick focus: " + brief.suggestedFocus[0]);
  }

  // Closing
  parts.push("That's the rundown. Ask me anything.");

  return parts.join(' ');
}
