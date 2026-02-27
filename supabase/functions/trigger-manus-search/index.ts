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

  const { hunt_id } = await req.json();
  if (!hunt_id) {
    return new Response(JSON.stringify({ error: "hunt_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Get hunt details
  const { data: hunt, error: huntError } = await supabase
    .from("sale_hunts")
    .select("*")
    .eq("id", hunt_id)
    .single();

  if (huntError || !hunt) {
    return new Response(JSON.stringify({ error: "Hunt not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Get Manus-type sources from dealer_outbound_sources
  const { data: sources } = await supabase
    .from("dealer_outbound_sources")
    .select("*")
    .eq("adapter_type", "manus")
    .eq("enabled", true);

  if (!sources || sources.length === 0) {
    return new Response(JSON.stringify({ message: "No Manus sources configured", tasks_created: 0 }), {
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
      `Search the website ${inventoryUrl} for used cars matching this mandate:`,
      `Make: ${hunt.make}`,
      `Model: ${hunt.model}`,
      hunt.required_badge ? `Badge/Variant: ${hunt.required_badge}` : "",
      hunt.year ? `Year: ${hunt.year}` : "",
      hunt.km ? `Maximum kilometres: ${hunt.km}` : "",
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
          hunt_id,
          manus_task_id: taskId,
          source_url: inventoryUrl,
          status: "pending",
        });
        tasksCreated.push(taskId);
        console.log(`[MANUS] Created task ${taskId} for ${source.dealer_domain}`);
      }
    } catch (err) {
      console.error(`[MANUS] Error creating task for ${source.dealer_domain}:`, err);
    }
  }

  return new Response(
    JSON.stringify({ message: "Manus tasks triggered", tasks_created: tasksCreated.length, task_ids: tasksCreated }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
