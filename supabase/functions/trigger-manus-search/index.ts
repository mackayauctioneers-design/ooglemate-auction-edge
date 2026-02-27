import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const MANUS_API_KEY = Deno.env.get("MANUS_API_KEY");
  if (!MANUS_API_KEY) {
    return new Response(JSON.stringify({ error: "MANUS_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const body = await req.json();

  // Support two modes: hunt_id (from hunts) or filters (from OogleBot)
  const huntId: string | null = body.hunt_id || null;
  const filters: { make?: string; model?: string; badge?: string; year_min?: number; year_max?: number; max_km?: number; price_max?: number } | null = body.filters || null;

  let make = "", model = "", badge = "", yearLine = "", kmLine = "", priceLine = "";

  if (huntId) {
    const { data: hunt, error: huntError } = await supabase
      .from("sale_hunts")
      .select("*")
      .eq("id", huntId)
      .single();
    if (huntError || !hunt) {
      return new Response(JSON.stringify({ error: "Hunt not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    make = hunt.make || "";
    model = hunt.model || "";
    badge = hunt.required_badge || "";
    yearLine = hunt.year ? `Year: ${hunt.year}` : "";
    kmLine = hunt.km ? `Maximum kilometres: ${hunt.km}` : "";
  } else if (filters?.make) {
    make = filters.make;
    model = filters.model || "";
    badge = filters.badge || "";
    if (filters.year_min && filters.year_max) {
      yearLine = `Year range: ${filters.year_min}–${filters.year_max}`;
    } else if (filters.year_min) {
      yearLine = `Year from: ${filters.year_min}`;
    }
    kmLine = filters.max_km ? `Maximum kilometres: ${filters.max_km}` : "";
    priceLine = filters.price_max ? `Maximum price: $${filters.price_max}` : "";
  } else {
    return new Response(JSON.stringify({ error: "hunt_id or filters.make required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Generate a session_id for grouping (used by OogleBot frontend to poll)
  const sessionId = crypto.randomUUID();

  // Get Manus-type sources
  const { data: sources } = await supabase
    .from("dealer_outbound_sources")
    .select("*")
    .eq("adapter_type", "manus")
    .eq("enabled", true);

  if (!sources || sources.length === 0) {
    return new Response(JSON.stringify({ session_id: sessionId, message: "No Manus sources configured", tasks_created: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/manus-webhook`;
  const tasksCreated: string[] = [];

  for (const source of sources) {
    const inventoryUrl = source.inventory_path
      ? `https://${source.dealer_domain}${source.inventory_path}`
      : `https://${source.dealer_domain}`;

    const prompt = [
      `Search the website ${inventoryUrl} for used cars matching:`,
      `Make: ${make}`,
      model ? `Model: ${model}` : "",
      badge ? `Badge/Variant: ${badge}` : "",
      yearLine,
      kmLine,
      priceLine,
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
      "",
      "Return ONLY a JSON array. No commentary. If no matching vehicles are found, return an empty array [].",
    ].filter(Boolean).join("\n");

    try {
      const res = await fetch("https://api.manus.im/v1/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "API_KEY": MANUS_API_KEY,
          "accept": "application/json",
        },
        body: JSON.stringify({
          prompt,
          webhook_url: webhookUrl,
        }),
      });

      if (!res.ok) {
        console.error(`[MANUS] Failed to create task for ${source.dealer_domain}: ${res.status} ${await res.text()}`);
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
          search_filters: { make, model, badge, ...(filters || {}) },
        });
        tasksCreated.push(taskId);
        console.log(`[MANUS] Created task ${taskId} for ${source.dealer_domain}`);
      }
    } catch (err) {
      console.error(`[MANUS] Error creating task for ${source.dealer_domain}:`, err);
    }
  }

  return new Response(
    JSON.stringify({
      session_id: sessionId,
      message: "Manus tasks triggered",
      tasks_created: tasksCreated.length,
      task_ids: tasksCreated,
      sources_count: sources.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
