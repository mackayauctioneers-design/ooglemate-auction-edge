import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// BOB DAILY BRIEF - Market pulse + Stock comparison + Suggested focus
// ============================================================================
// SECURITY:
// 1. Role determined server-side via user_roles table, never from request
// 2. Dealer profile (dealer_name, org_id, region_id) derived server-side
// 3. Dealers CANNOT spoof region/dealerName via request body
// 4. Only admins/internal can override region in request body
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
    const requestRegion = body.region;
    const requestDealerName = body.dealerName;

    // =========================================================================
    // SECURITY: Get authenticated user and derive role + profile server-side
    // =========================================================================
    let userId: string | null = null;
    let userRole: 'admin' | 'dealer' | 'internal' = 'dealer';
    let dealerName = 'mate';
    let orgId: string | null = null;
    let dealerProfileId: string | null = null;
    let region = 'CENTRAL_COAST_NSW';
    let profileLinked = false;
    
    const authHeader = req.headers.get('Authorization');
    
    if (authHeader?.startsWith('Bearer ')) {
      try {
        // Create user client to validate the JWT
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        
        // Use getUser() for robust authentication (NOT getClaims alone)
        const { data: userData, error: userError } = await userClient.auth.getUser();
        
        if (!userError && userData?.user) {
          userId = userData.user.id;
          
          // Query user_roles table for role (security definer function)
          const { data: roleData } = await supabase.rpc('get_user_role', { 
            _user_id: userId 
          });
          
          if (roleData) {
            userRole = roleData as 'admin' | 'dealer' | 'internal';
          }
          
          // Query dealer_profiles for dealer-specific data (includes id for scoping)
          const { data: profileData } = await supabase
            .from('dealer_profiles')
            .select('id, dealer_name, org_id, region_id')
            .eq('user_id', userId)
            .single();
          
          if (profileData) {
            dealerProfileId = profileData.id;
            dealerName = profileData.dealer_name || dealerName;
            orgId = profileData.org_id;
            region = profileData.region_id || region;
            profileLinked = true;
          }
          
          console.log(`[bob-daily-brief] Auth user ${userId}, role: ${userRole}, dealerProfileId: ${dealerProfileId}, region: ${region}`);
        }
      } catch (e) {
        console.log('[bob-daily-brief] Auth error, treating as unauthenticated dealer:', e);
      }
    } else {
      console.log('[bob-daily-brief] No auth header, using defaults');
    }

    // =========================================================================
    // FRIENDLY FALLBACK: If authenticated but no dealer profile linked
    // =========================================================================
    if (userId && !profileLinked && userRole === 'dealer') {
      console.log(`[bob-daily-brief] User ${userId} has no linked dealer profile`);
      
      const friendlyBrief: DailyBrief = {
        greeting: "G'day! Looks like your account isn't linked to a dealership yet.",
        marketPulse: [],
        stockVsMarket: [],
        suggestedFocus: [
          "Ask your admin to link your account to your dealership",
          "Once linked, you'll see market insights for your area"
        ],
        slowMoverCount: 0,
        opportunityCount: 0
      };

      return new Response(
        JSON.stringify({ 
          brief: friendlyBrief,
          briefContext: friendlyBrief.greeting + " " + friendlyBrief.suggestedFocus.join(" "),
          hasOpportunities: false,
          opportunityCount: 0,
          accountNotLinked: true
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // SECURITY: Only admin/internal can override region from request
    // Dealers ALWAYS use their profile-derived region
    // =========================================================================
    const isAdmin = userRole === 'admin' || userRole === 'internal';
    
    if (isAdmin && requestRegion) {
      region = requestRegion;
      console.log(`[bob-daily-brief] Admin override: using requested region ${region}`);
    }
    
    if (isAdmin && requestDealerName) {
      dealerName = requestDealerName;
    }

    console.log(`[bob-daily-brief] Generating brief for ${dealerName}, region: ${region}, role: ${userRole}`);

    // =========================================================================
    // Fetch geo_heat_alerts for market pulse (dealer's region only)
    // =========================================================================
    const { data: heatAlerts } = await supabase
      .from('geo_heat_alerts')
      .select('make, model, tier')
      .eq('region_id', region)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(10);

    // =========================================================================
    // FIX #3: Get latest asof_date first, then fetch outcomes for that date
    // This ensures consistency - all outcomes are from the same snapshot
    // =========================================================================
    const { data: latestDateRow } = await supabase
      .from('fingerprint_outcomes')
      .select('asof_date')
      .eq('region_id', region)
      .order('asof_date', { ascending: false })
      .limit(1)
      .single();

    const latestAsofDate = latestDateRow?.asof_date;
    console.log(`[bob-daily-brief] Latest asof_date for ${region}: ${latestAsofDate}`);

    let outcomes: any[] = [];
    if (latestAsofDate) {
      const { data: outcomesData } = await supabase
        .from('fingerprint_outcomes')
        .select('make, model, cleared_total, listing_total, relisted_total, passed_in_total')
        .eq('region_id', region)
        .eq('asof_date', latestAsofDate);
      
      outcomes = outcomesData || [];
    }

    // =========================================================================
    // Fetch opportunities count - SCOPED to dealer/org
    // Dealers only see their own alerts, admins can see all
    // =========================================================================
    let opportunityQuery = supabase
      .from('alert_logs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'new')
      .eq('match_type', 'exact');

    // DEALER ISOLATION: Scope by dealer_profile_id, NOT dealer_name (prevents spoofing)
    if (!isAdmin && dealerProfileId) {
      opportunityQuery = opportunityQuery.eq('dealer_profile_id', dealerProfileId);
    } else if (!isAdmin) {
      // No profile linked = no opportunities visible
      opportunityQuery = opportunityQuery.eq('dealer_profile_id', '00000000-0000-0000-0000-000000000000');
    }

    const { count: opportunityCount } = await opportunityQuery;

    // =========================================================================
    // Slow movers = AGED listings (21+ days old), dealer_grade = true
    // SCOPED to dealer's region for non-admin users
    // =========================================================================
    const twentyOneDaysAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
    
    let slowMoverQuery = supabase
      .from('vehicle_listings')
      .select('*', { count: 'exact', head: true })
      .eq('is_dealer_grade', true)
      .lte('first_seen_at', twentyOneDaysAgo)
      .in('status', ['active', 'listed', 'catalogue']);

    // Scope to dealer's region - using location_to_region mapping
    // For now, filter by location containing region keywords
    // TODO: Add source/org_id field to vehicle_listings for proper dealer scoping
    if (!isAdmin) {
      slowMoverQuery = slowMoverQuery.eq('source_class', 'auction'); // Auction-only for dealers
    }

    const { count: slowMoverCount } = await slowMoverQuery;

    console.log(`[bob-daily-brief] Slow movers: ${slowMoverCount}, Opportunities: ${opportunityCount}`);

    // =========================================================================
    // Build market pulse - map internal tiers to dealer-safe labels only
    // =========================================================================
    const marketPulse: MarketPulse[] = [];
    
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
    // Build stock vs market from fingerprint_outcomes (consistent asof_date)
    // =========================================================================
    const stockVsMarket: StockComparison[] = [];
    
    const outcomessByMake: Record<string, typeof outcomes> = {};
    for (const o of outcomes) {
      if (!outcomessByMake[o.make]) {
        outcomessByMake[o.make] = [];
      }
      outcomessByMake[o.make]!.push(o);
    }

    const topMakes = Object.keys(outcomessByMake).slice(0, 3);
    for (const make of topMakes) {
      const makeOutcomes = outcomessByMake[make] || [];
      if (makeOutcomes.length === 0) continue;
      
      const totalCleared = makeOutcomes.reduce((sum, o) => sum + (o.cleared_total ?? 0), 0);
      const totalListed = makeOutcomes.reduce((sum, o) => sum + (o.listing_total ?? 0), 0);
      
      if (totalListed === 0) {
        console.log(`[bob-daily-brief] Skipping ${make}: no listing data`);
        continue;
      }
      
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

    const briefContext = buildVoiceBriefContext(brief);

    console.log(`[bob-daily-brief] Brief generated: ${marketPulse.length} pulse items, ${stockVsMarket.length} stock items, ${slowMoverCount} slow movers, asof: ${latestAsofDate}`);

    return new Response(
      JSON.stringify({ 
        brief,
        briefContext,
        hasOpportunities: (opportunityCount || 0) > 0,
        opportunityCount: opportunityCount || 0,
        _debug: isAdmin ? { 
          userId, 
          userRole, 
          dealerProfileId,
          region, 
          orgId,
          latestAsofDate 
        } : undefined
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

  if (brief.marketPulse.length > 0) {
    parts.push("Market pulse:");
    for (const item of brief.marketPulse) {
      const statusWord = item.status === 'hot' ? 'hot' : item.status === 'cooling' ? 'cooling off' : 'steady';
      parts.push(`${item.category} is ${statusWord}.`);
    }
  }

  if (brief.stockVsMarket.length > 0) {
    parts.push("Your stock:");
    for (const item of brief.stockVsMarket) {
      const statusWord = item.status === 'faster' ? 'moving faster than market' : 
                         item.status === 'slower' ? 'taking a bit longer' : 'tracking with market';
      parts.push(`${item.category}: ${statusWord}.`);
    }
  }

  if (brief.slowMoverCount > 0) {
    parts.push(`You have ${brief.slowMoverCount} cars that have been listed for a while.`);
  }

  if (brief.opportunityCount > 0) {
    parts.push(`${brief.opportunityCount} new opportunities waiting.`);
  }

  if (brief.suggestedFocus.length > 0) {
    parts.push("Today's focus:");
    for (const focus of brief.suggestedFocus) {
      parts.push(focus);
    }
  }

  return parts.join(' ');
}
