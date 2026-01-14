import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ============================================================================
// BOB SITE TOOLS - Read-only tools for site-aware Bob
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase credentials" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { tool, params, context } = await req.json();
    
    console.log(`[BOB-TOOLS] Tool: ${tool}, Params:`, params);

    let result: unknown;

    switch (tool) {
      case 'get_dealer_profile':
        result = await supabase.rpc('rpc_get_dealer_profile', {
          p_dealer_id: params.dealer_id
        });
        break;

      case 'get_today_opportunities':
        result = await supabase.rpc('rpc_get_today_opportunities', {
          p_dealer_id: params.dealer_id,
          p_filters: params.filters || {}
        });
        break;

      case 'get_upcoming_auction_cards':
        result = await supabase.rpc('rpc_get_upcoming_auction_cards', {
          p_dealer_id: params.dealer_id,
          p_filters: params.filters || {}
        });
        break;

      case 'get_auction_lots':
        result = await supabase.rpc('rpc_get_auction_lots', {
          p_dealer_id: params.dealer_id,
          p_auction_event_id: params.auction_event_id,
          p_mode: params.mode || 'all'
        });
        break;

      case 'get_watchlist':
        result = await supabase.rpc('rpc_get_watchlist', {
          p_dealer_id: params.dealer_id
        });
        break;

      case 'explain_why_listed':
        result = await supabase.rpc('rpc_explain_why_listed', {
          p_dealer_id: params.dealer_id,
          p_lot_id: params.lot_id
        });
        break;

      // Log context for debugging (optional)
      case 'log_context':
        if (context?.dealer_id) {
          const { error } = await supabase
            .from('bob_chat_context_log')
            .insert({
              dealer_id: context.dealer_id,
              route: context.route,
              filters: context.filters,
              selected_auction_event_id: context.selection?.auction_event_id,
              selected_lot_id: context.selection?.lot_id,
              page_summary: context.page_summary,
            });
          if (error) console.error('[BOB-TOOLS] Context log error:', error);
          result = { data: { logged: true }, error: null };
        } else {
          result = { data: { logged: false }, error: null };
        }
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Unknown tool: ${tool}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const { data, error } = result as { data: unknown; error: unknown };

    if (error) {
      console.error(`[BOB-TOOLS] RPC error for ${tool}:`, error);
      return new Response(
        JSON.stringify({ error: (error as Error).message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[BOB-TOOLS] ${tool} success`);
    return new Response(
      JSON.stringify({ data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[BOB-TOOLS] Error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
