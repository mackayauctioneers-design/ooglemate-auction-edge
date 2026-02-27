import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * trigger-manus-hunt-search v1.0
 *
 * Replaces outward-hunt's Firecrawl adapter system.
 * For a given hunt, fires Manus AI tasks against:
 *   1. All enabled dealer_outbound_sources (manus + firecrawl types)
 *   2. Optionally, marketplace sources from hunt.outward_sources
 *
 * Results flow back via manus-webhook → hunt_external_candidates.
 */

interface HuntRecord {
  id: string;
  make: string;
  model: string;
  year: number | null;
  km: number | null;
  badge: string | null;
  required_badge: string | null;
  body_type: string | null;
  required_body_type: string | null;
  engine_family: string | null;
  required_engine_family: string | null;
  cab_type: string | null;
  variant_family: string | null;
  series_family: string | null;
  required_series_family: string | null;
  proven_exit_value: number | null;
  outward_sources: string[] | null;
  dealer_outbound_enabled: boolean | null;
}

function buildHuntPrompt(hunt: HuntRecord, inventoryUrl: string): string {
  const badge = hunt.required_badge || hunt.badge || "";
  const body = hunt.required_body_type || hunt.body_type || "";
  const engine = hunt.required_engine_family || hunt.engine_family || "";
  const series = hunt.required_series_family || hunt.series_family || "";
  const variant = hunt.variant_family || "";

  const lines = [
    `Search the website ${inventoryUrl} for used cars matching:`,
    `Make: ${hunt.make}`,
    `Model: ${hunt.model}`,
    badge ? `Badge/Variant: ${badge}` : "",
    series ? `Series: ${series}` : "",
    variant ? `Variant family: ${variant}` : "",
    body ? `Body type: ${body}` : "",
    engine ? `Engine: ${engine}` : "",
    hunt.year ? `Year: ${hunt.year} (±1 year tolerance)` : "",
    hunt.km ? `Maximum kilometres: ${hunt.km}` : "",
    hunt.proven_exit_value ? `Target price ceiling: $${Math.round(hunt.proven_exit_value * 0.85)}` : "",
    "",
    "For each matching vehicle found, extract and return a JSON array with these fields:",
    "- price (integer, AUD, exclude govt charges if possible)",
    "- price_type (string: 'drive_away' or 'excl_govt' or 'unknown')",
    "- km (integer)",
    "- year (integer)",
    "- badge (string)",
    "- colour (string)",
    "- location (string, suburb and state)",
    "- dealer_name (string)",
    "- direct_url (string, full URL to the individual listing page)",
    "- stock_no (string, if visible)",
    "- variant_raw (string, the full variant/trim text as shown on the page)",
    "",
    "Return ONLY a JSON array. No commentary. If no matching vehicles are found, return an empty array [].",
  ];

  return lines.filter(Boolean).join("\n");
}

// Marketplace search prompt (Carsales, Autotrader, Drive, etc.)
function buildMarketplacePrompt(hunt: HuntRecord, domain: string): string {
  const badge = hunt.required_badge || hunt.badge || "";
  const makeLower = hunt.make.toLowerCase();
  const modelLower = hunt.model.toLowerCase();

  // Build the most likely search URL pattern for the domain
  let searchUrl = `https://www.${domain}`;
  if (domain.includes("carsales.com.au")) {
    searchUrl = `https://www.carsales.com.au/cars/${makeLower}/${modelLower}/`;
  } else if (domain.includes("autotrader.com.au")) {
    searchUrl = `https://www.autotrader.com.au/cars/${makeLower}/${modelLower}`;
  } else if (domain.includes("drive.com.au")) {
    searchUrl = `https://www.drive.com.au/cars-for-sale/${makeLower}/${modelLower}/`;
  } else if (domain.includes("carsguide.com.au")) {
    searchUrl = `https://www.carsguide.com.au/buy-a-car/${makeLower}/${modelLower}/`;
  }

  const lines = [
    `Go to ${searchUrl} and search for used ${hunt.make} ${hunt.model} vehicles.`,
    badge ? `Filter for badge/variant: ${badge}` : "",
    hunt.year ? `Filter for year: ${hunt.year} (or ${hunt.year - 1} to ${hunt.year + 1})` : "",
    hunt.km ? `Filter for maximum kilometres: ${hunt.km}` : "",
    "",
    "Navigate through the search results and for each matching vehicle, extract a JSON array with:",
    "- price (integer, AUD)",
    "- price_type (string: 'drive_away' or 'excl_govt' or 'unknown')",
    "- km (integer)",
    "- year (integer)",
    "- badge (string)",
    "- colour (string)",
    "- location (string, suburb and state)",
    "- dealer_name (string)",
    "- direct_url (string, full URL to the individual listing detail page)",
    "- stock_no (string, if visible)",
    "- variant_raw (string)",
    "",
    "Return ONLY a JSON array. No commentary. If no matching vehicles are found, return an empty array [].",
    "IMPORTANT: Return the direct_url to each INDIVIDUAL listing detail page, not the search results page.",
  ];

  return lines.filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const MANUS_API_KEY = Deno.env.get("MANUS_API_KEY");
  if (!MANUS_API_KEY) {
    return new Response(JSON.stringify({ error: "MANUS_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const huntId: string | null = body.hunt_id || null;

  if (!huntId) {
    return new Response(JSON.stringify({ error: "hunt_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load hunt
  const { data: hunt, error: huntErr } = await supabase
    .from("sale_hunts")
    .select("*")
    .eq("id", huntId)
    .single();

  if (huntErr || !hunt) {
    return new Response(JSON.stringify({ error: "Hunt not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/manus-webhook`;
  const sessionId = crypto.randomUUID();
  const tasksCreated: { taskId: string; source: string; type: string }[] = [];
  const errors: string[] = [];

  // ── Lane 1: Dealer outbound sources ──
  if (hunt.dealer_outbound_enabled !== false) {
    const { data: sources } = await supabase
      .from("dealer_outbound_sources")
      .select("*")
      .eq("enabled", true);

    for (const source of sources || []) {
      const inventoryUrl = source.inventory_path
        ? `https://${source.dealer_domain}${source.inventory_path}`
        : `https://${source.dealer_domain}`;

      const prompt = buildHuntPrompt(hunt as HuntRecord, inventoryUrl);

      try {
        const res = await fetch("https://api.manus.im/v1/tasks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "API_KEY": MANUS_API_KEY,
            "accept": "application/json",
          },
          body: JSON.stringify({ prompt, webhook_url: webhookUrl }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[MANUS-HUNT] Failed ${source.dealer_domain}: ${res.status} ${errText.slice(0, 200)}`);
          errors.push(`${source.dealer_domain}: ${res.status}`);
          continue;
        }

        const task = await res.json();
        const taskId = task?.id || task?.task_id;

        if (taskId) {
          await supabase.from("manus_search_tasks").insert({
            hunt_id: huntId,
            manus_task_id: taskId,
            source_url: inventoryUrl,
            status: "pending",
            search_session_id: sessionId,
            search_filters: {
              make: hunt.make,
              model: hunt.model,
              badge: hunt.required_badge || hunt.badge,
              year: hunt.year,
              km: hunt.km,
            },
          });

          tasksCreated.push({ taskId, source: source.dealer_domain, type: "dealer_site" });
          console.log(`[MANUS-HUNT] Task ${taskId} → ${source.dealer_domain}`);
        }
      } catch (err) {
        console.error(`[MANUS-HUNT] Error ${source.dealer_domain}:`, err);
        errors.push(`${source.dealer_domain}: ${err}`);
      }
    }
  }

  // ── Lane 2: Marketplace sources (from hunt.outward_sources) ──
  const marketplaceDomains = (hunt.outward_sources as string[] | null) || [
    "carsales.com.au",
    "autotrader.com.au",
    "drive.com.au",
  ];

  for (const domain of marketplaceDomains) {
    const prompt = buildMarketplacePrompt(hunt as HuntRecord, domain);

    try {
      const res = await fetch("https://api.manus.im/v1/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "API_KEY": MANUS_API_KEY,
          "accept": "application/json",
        },
        body: JSON.stringify({ prompt, webhook_url: webhookUrl }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[MANUS-HUNT] Failed marketplace ${domain}: ${res.status} ${errText.slice(0, 200)}`);
        errors.push(`marketplace:${domain}: ${res.status}`);
        continue;
      }

      const task = await res.json();
      const taskId = task?.id || task?.task_id;

      if (taskId) {
        await supabase.from("manus_search_tasks").insert({
          hunt_id: huntId,
          manus_task_id: taskId,
          source_url: `https://www.${domain}`,
          status: "pending",
          search_session_id: sessionId,
          search_filters: {
            make: hunt.make,
            model: hunt.model,
            badge: hunt.required_badge || hunt.badge,
            year: hunt.year,
            km: hunt.km,
            source_type: "marketplace",
          },
        });

        tasksCreated.push({ taskId, source: domain, type: "marketplace" });
        console.log(`[MANUS-HUNT] Task ${taskId} → marketplace:${domain}`);
      }
    } catch (err) {
      console.error(`[MANUS-HUNT] Error marketplace ${domain}:`, err);
      errors.push(`marketplace:${domain}: ${err}`);
    }
  }

  // Update hunt last_outward_scan_at
  await supabase
    .from("sale_hunts")
    .update({ last_outward_scan_at: new Date().toISOString() })
    .eq("id", huntId);

  console.log(`[MANUS-HUNT] Hunt ${huntId}: ${tasksCreated.length} tasks created, ${errors.length} errors`);

  return new Response(
    JSON.stringify({
      session_id: sessionId,
      hunt_id: huntId,
      tasks_created: tasksCreated.length,
      tasks: tasksCreated,
      errors: errors.length > 0 ? errors : undefined,
      dealer_sources: tasksCreated.filter(t => t.type === "dealer_site").length,
      marketplace_sources: tasksCreated.filter(t => t.type === "marketplace").length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
