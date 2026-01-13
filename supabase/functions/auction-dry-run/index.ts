import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AuctionSource = {
  source_key: string;
  display_name: string;
  enabled: boolean;
  platform: string;
  preflight_status: string | null;
  parser_profile: string | null;
};

// deno-lint-ignore no-explicit-any
async function invokeCrawler(supabase: any, src: AuctionSource) {
  const platform = (src.platform || "").toLowerCase();
  const profile = (src.parser_profile || "").toLowerCase();

  if (platform.includes("asp") || profile.includes("asp")) {
    return await supabase.functions.invoke("asp-auction-crawl", { 
      body: { source_key: src.source_key, debug: true } 
    });
  }
  if (platform.includes("bidsonline")) {
    return await supabase.functions.invoke("bidsonline-crawl", { 
      body: { source_key: src.source_key, debug: true } 
    });
  }

  return await supabase.functions.invoke("custom-auction-crawl", { 
    body: { source_key: src.source_key, debug: true } 
  });
}

// deno-lint-ignore no-explicit-any
function yearGateStats(items: any[]): { kept: number; dropped: number; minYear: number } {
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 10;

  let kept = 0;
  let dropped = 0;

  for (const it of items) {
    const y = Number(it.year ?? it.Year ?? it.year_model ?? 0);
    if (!y) continue;
    if (y >= minYear) kept++;
    else dropped++;
  }
  return { kept, dropped, minYear };
}

// deno-lint-ignore no-explicit-any
function extractParsedLots(debugData: any): any[] {
  if (!debugData) return [];
  
  // Try common debug payload shapes
  if (Array.isArray(debugData.diagnostics?.sample_vehicles)) {
    return debugData.diagnostics.sample_vehicles;
  }
  if (Array.isArray(debugData.parsedLots)) {
    return debugData.parsedLots;
  }
  if (Array.isArray(debugData.diagnostics?.parsedLots)) {
    return debugData.diagnostics.parsedLots;
  }
  if (Array.isArray(debugData.lots)) {
    return debugData.lots;
  }
  if (Array.isArray(debugData.vehicles)) {
    return debugData.vehicles;
  }
  
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => ({}));
    const source_key = body.source_key as string | undefined;

    if (!source_key) {
      return new Response(JSON.stringify({ error: "source_key is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: src, error } = await supabase
      .from("auction_sources")
      .select("source_key,display_name,enabled,platform,preflight_status,parser_profile")
      .eq("source_key", source_key)
      .single();

    if (error || !src) throw error || new Error("source not found");

    const t0 = Date.now();
    const { data: debugData, error: runErr } = await invokeCrawler(supabase, src as AuctionSource);
    const ms = Date.now() - t0;

    if (runErr) throw new Error(runErr.message || "crawl invoke error");

    const parsedLots = extractParsedLots(debugData);
    const stats = yearGateStats(parsedLots);

    // Log event
    await supabase.from("auction_source_events").insert({
      source_key,
      event_type: "dry_run",
      message: `Dry run completed`,
      meta: { 
        ms, 
        sample_count: parsedLots.length, 
        year_gate: stats,
        debug_keys: Object.keys(debugData || {}) 
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        source_key,
        ms,
        debug_shape_keys: Object.keys(debugData || {}),
        sample_count: parsedLots.length,
        year_gate: stats,
        sample: parsedLots.slice(0, 10),
        raw: debugData,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
