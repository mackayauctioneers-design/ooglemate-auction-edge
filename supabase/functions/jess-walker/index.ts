import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  console.log("[jess-walker] Starting job lookup...");

  // 1. Get one pending job
  const { data: job, error: fetchErr } = await supabase
    .from("detail_ingest_queue")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (fetchErr || !job) {
    console.log("[jess-walker] No pending jobs found");
    return new Response(
      JSON.stringify({ message: "No pending jobs" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[jess-walker] Found job ${job.id} for ${job.url_canonical}`);

  // 2. Claim it atomically
  const { data: claimed, error: claimErr } = await supabase
    .from("detail_ingest_queue")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "pending")
    .select()
    .single();

  if (claimErr || !claimed) {
    console.log(`[jess-walker] Failed to claim job ${job.id} - already taken`);
    return new Response(
      JSON.stringify({ error: "Failed to claim job - already taken" }),
      { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[jess-walker] Claimed job ${job.id}, fetching URL...`);

  try {
    // 3. Fetch the page
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const res = await fetch(job.url_canonical, {
      headers: {
        "User-Agent": "JessWalker/1.0 (Kiting Detail Ingestion)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const html = await res.text();
    const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

    console.log(`[jess-walker] Fetched ${job.url_canonical} - status ${res.status}, ${html.length} bytes`);

    // 4. Persist raw result
    const { error: insertErr } = await supabase.from("listing_details_raw").insert({
      account_id: job.account_id,
      ingest_queue_id: job.id,
      url_canonical: job.url_canonical,
      domain: job.domain,
      dealer_slug: job.dealer_slug,
      http_status: res.status,
      raw_html: html,
      raw_text: text.slice(0, 100000), // Cap at 100k chars
      parse_status: "fetched",
    });

    if (insertErr) {
      console.error(`[jess-walker] Failed to insert raw result: ${insertErr.message}`);
      throw new Error(`Insert failed: ${insertErr.message}`);
    }

    // 5. Mark queue complete
    await supabase
      .from("detail_ingest_queue")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", job.id);

    console.log(`[jess-walker] Job ${job.id} completed successfully`);

    return new Response(
      JSON.stringify({ 
        status: "completed", 
        job_id: job.id,
        url: job.url_canonical,
        http_status: res.status,
        bytes: html.length 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[jess-walker] Job ${job.id} failed: ${errorMessage}`);

    // Mark queue failed
    await supabase
      .from("detail_ingest_queue")
      .update({ status: "failed" })
      .eq("id", job.id);

    // Also record the error in raw table (best effort)
    try {
      await supabase.from("listing_details_raw").insert({
        account_id: job.account_id,
        ingest_queue_id: job.id,
        url_canonical: job.url_canonical,
        domain: job.domain,
        dealer_slug: job.dealer_slug,
        parse_status: "failed",
        error: errorMessage,
      });
    } catch {
      // Ignore insert errors
    }

    return new Response(
      JSON.stringify({ error: errorMessage, job_id: job.id }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
