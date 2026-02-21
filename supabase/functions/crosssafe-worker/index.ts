import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * CROSSSAFE WORKER — Claims and executes queued jobs
 * 
 * Uses FOR UPDATE SKIP LOCKED to safely claim jobs.
 * Delegates to existing edge functions by type.
 * Writes step-level audit logs.
 * 
 * Schedule: every 5 minutes
 * Can also be invoked manually.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_JOBS_PER_RUN = 5;
const JOB_TIMEOUT_MS = 55_000; // 55s hard timeout (edge fn limit ~60s)
const WORKER_ID = `crosssafe-worker-${crypto.randomUUID().slice(0, 8)}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: any[] = [];
  let jobsProcessed = 0;

  try {
    for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
      // Check wall-clock — don't start a new job if we're running low
      if (Date.now() - startTime > JOB_TIMEOUT_MS) break;

      // ── CLAIM a job using advisory lock pattern ──
      const { data: claimed, error: claimErr } = await sb.rpc(
        "crosssafe_claim_job" as any,
        { p_worker_id: WORKER_ID } as any,
      );

      if (claimErr || !claimed || (Array.isArray(claimed) && claimed.length === 0)) {
        console.log(`[WORKER] No more jobs to claim`);
        break;
      }

      const job = Array.isArray(claimed) ? claimed[0] : claimed;
      console.log(`[WORKER] Claimed job ${job.id} type=${job.type} source=${job.source}`);

      // ── AUDIT: started ──
      await writeAudit(sb, job.id, "claimed", { worker: WORKER_ID, attempt: job.attempts + 1 });

      try {
        const result = await executeJob(sb, job);
        
        // ── Mark succeeded ──
        await sb
          .from("crosssafe_jobs")
          .update({
            status: "succeeded",
            finished_at: new Date().toISOString(),
            result,
          })
          .eq("id", job.id);

        await writeAudit(sb, job.id, "succeeded", result);
        results.push({ job_id: job.id, type: job.type, status: "succeeded", result });
        jobsProcessed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const newAttempts = (job.attempts || 0) + 1;
        const shouldPark = newAttempts >= (job.max_attempts || 3);

        await sb
          .from("crosssafe_jobs")
          .update({
            status: shouldPark ? "parked" : "queued",
            attempts: newAttempts,
            error: errorMsg,
            locked_at: null,
            locked_by: null,
            finished_at: shouldPark ? new Date().toISOString() : null,
          })
          .eq("id", job.id);

        await writeAudit(sb, job.id, shouldPark ? "parked" : "retryable_error", {
          error: errorMsg,
          attempt: newAttempts,
        });

        results.push({ job_id: job.id, type: job.type, status: shouldPark ? "parked" : "retry", error: errorMsg });
        jobsProcessed++;
      }
    }

    // ── Heartbeat ──
    await sb.from("cron_heartbeat").upsert({
      cron_name: "crosssafe-worker",
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: `processed=${jobsProcessed} elapsed=${Date.now() - startTime}ms`,
    }, { onConflict: "cron_name" });

    return new Response(
      JSON.stringify({ success: true, jobs_processed: jobsProcessed, results, elapsed_ms: Date.now() - startTime }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[WORKER] Fatal:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ─── JOB EXECUTOR ────────────────────────────────────────────────────────────

async function executeJob(sb: any, job: any): Promise<any> {
  const { type, source, payload } = job;

  switch (type) {
    case "source_refresh":
      return await handleSourceRefresh(sb, source, payload);
    case "url_ingest":
      return await handleUrlIngest(sb, source, payload);
    case "lifecycle_sweep":
      return await handleLifecycleSweep(sb);
    case "score_batch":
      return await handleScoreBatch(sb, payload);
    default:
      throw new Error(`Unknown job type: ${type}`);
  }
}

// ─── SOURCE REFRESH ──────────────────────────────────────────────────────────
// Calls the existing ingest function via HTTP to avoid code duplication

async function handleSourceRefresh(sb: any, source: string, payload: any): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Map source to existing edge function
  const functionMap: Record<string, string> = {
    pickles: "pickles-ingest-cron",
    grays: "grays-stub-ingest",
    manheim: "manheim-stub-ingest",
    slattery: "slattery-stub-ingest-webhook",
  };

  const fnName = functionMap[source];
  if (!fnName) throw new Error(`No ingest function for source: ${source}`);

  console.log(`[WORKER] Invoking ${fnName} for source_refresh`);

  const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });

  const body = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(`${fnName} returned ${resp.status}: ${JSON.stringify(body)}`);
  }

  // After source refresh, enqueue a score_batch job
  await sb.from("crosssafe_jobs").insert({
    type: "score_batch",
    source,
    payload: { triggered_by: "source_refresh" },
    priority: -1, // Lower priority than refresh jobs
  });

  return { function: fnName, status: resp.status, ...body };
}

// ─── URL INGEST ──────────────────────────────────────────────────────────────
// Full pipeline: Firecrawl scrape → normalize → upsert vehicle_listings → enqueue scoring

async function handleUrlIngest(sb: any, source: string, payload: any): Promise<any> {
  const url = payload?.url;
  if (!url) throw new Error("url_ingest requires payload.url");

  console.log(`[WORKER] URL ingest: ${url}`);

  // ── Detect source from URL ──
  let detectedSource = source || "manual";
  if (url.includes("pickles.com.au")) detectedSource = "pickles";
  else if (url.includes("grays.com")) detectedSource = "grays";
  else if (url.includes("manheim.com")) detectedSource = "manheim";
  else if (url.includes("slattery")) detectedSource = "slattery";
  else if (url.includes("autotrader.com.au")) detectedSource = "autotrader";

  // ── Scrape via Firecrawl ──
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) throw new Error("FIRECRAWL_API_KEY not configured");

  console.log(`[WORKER] Firecrawl scraping: ${url}`);
  const scrapeResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firecrawlKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 3000,
    }),
  });

  const scrapeData = await scrapeResp.json();
  if (!scrapeResp.ok) {
    throw new Error(`Firecrawl error ${scrapeResp.status}: ${JSON.stringify(scrapeData)}`);
  }

  const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || "";
  if (!markdown || markdown.length < 50) {
    throw new Error(`Firecrawl returned insufficient content (${markdown.length} chars)`);
  }

  console.log(`[WORKER] Got ${markdown.length} chars markdown from ${url}`);

  // ── Normalize vehicle fields from markdown ──
  const vehicle = extractVehicleFromMarkdown(markdown, url, detectedSource);
  if (!vehicle.make || !vehicle.model || !vehicle.year) {
    throw new Error(`Could not extract vehicle identity from ${url}: make=${vehicle.make} model=${vehicle.model} year=${vehicle.year}`);
  }

  // ── Generate canonical listing_id ──
  const sourceId = extractSourceId(url, detectedSource) || `manual:${hashString(url)}`;
  const listingId = `${detectedSource}:${sourceId}`;
  const now = new Date().toISOString();

  console.log(`[WORKER] Upserting: ${listingId} → ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

  // ── Upsert into vehicle_listings ──
  const { data: upserted, error: upsertErr } = await sb
    .from("vehicle_listings")
    .upsert({
      listing_id: listingId,
      source: detectedSource,
      source_class: detectedSource === "pickles" || detectedSource === "grays" ? "auction" : "dealer",
      make: vehicle.make,
      model: vehicle.model,
      variant_raw: vehicle.variant || null,
      year: vehicle.year,
      km: vehicle.km || null,
      asking_price: vehicle.price || null,
      location: vehicle.location || null,
      state: vehicle.state || null,
      listing_url: url,
      status: "active",
      lifecycle_state: "NEW",
      seller_type: "unknown",
      first_seen_at: now,
      last_seen_at: now,
      updated_at: now,
    }, { onConflict: "listing_id", ignoreDuplicates: false })
    .select("id");

  if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`);

  const listingUuid = upserted?.[0]?.id;

  // ── Enqueue scoring ──
  await sb.from("crosssafe_jobs").insert({
    type: "score_batch",
    source: detectedSource,
    payload: { triggered_by: "url_ingest", listing_id: listingId },
    priority: -1,
  });

  return {
    listing_id: listingId,
    listing_uuid: listingUuid,
    vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    km: vehicle.km,
    price: vehicle.price,
    source: detectedSource,
    markdown_length: markdown.length,
    scored: true,
  };
}

// ─── VEHICLE EXTRACTION FROM MARKDOWN ────────────────────────────────────────

function extractVehicleFromMarkdown(md: string, url: string, _source: string): {
  make: string | null; model: string | null; variant: string | null;
  year: number | null; km: number | null; price: number | null;
  location: string | null; state: string | null;
} {
  const text = md.slice(0, 5000);

  // Year: try markdown first, then URL path
  let yearMatch = text.match(/\b(20[0-2]\d)\b/);
  if (!yearMatch) {
    const urlYearMatch = url.match(/\b(20[0-2]\d)\b/);
    if (urlYearMatch) yearMatch = urlYearMatch;
  }
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  const priceMatch = text.match(/\$\s?([\d,]+)/);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, "")) : null;

  const kmMatch = text.match(/([\d,]+)\s*(?:km|kms|kilometres)/i);
  const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, "")) : null;

  let make: string | null = null;
  let model: string | null = null;
  let variant: string | null = null;

  const urlPath = new URL(url).pathname.toLowerCase();

  const KNOWN_MAKES = [
    "toyota", "mazda", "hyundai", "kia", "ford", "holden", "mitsubishi",
    "nissan", "subaru", "honda", "volkswagen", "bmw", "mercedes", "audi",
    "lexus", "suzuki", "isuzu", "jeep", "land rover", "landrover",
    "porsche", "volvo", "peugeot", "renault", "skoda", "tesla", "mg",
    "great wall", "ldv", "ram", "chevrolet", "chrysler", "dodge",
  ];

  const MULTI_TOKEN_MODELS: Record<string, string[]> = {
    toyota: ["landcruiser prado", "land cruiser prado", "yaris cross", "gr86", "rav4"],
    mitsubishi: ["pajero sport", "outlander phev", "triton glx"],
    land_rover: ["range rover sport", "range rover evoque", "discovery sport", "range rover"],
    volkswagen: ["t-cross", "t-roc", "tiguan allspace"],
  };

  for (const mk of KNOWN_MAKES) {
    const mkSlug = mk.replace(/ /g, "-");
    if (urlPath.includes(mkSlug) || urlPath.includes(mk.replace(/ /g, ""))) {
      make = mk.charAt(0).toUpperCase() + mk.slice(1);
      const afterMake = urlPath.split(mkSlug)[1] || urlPath.split(mk.replace(/ /g, ""))[1] || "";
      const slugParts = afterMake.split("/").filter(Boolean)[0]?.split("-").filter(Boolean) || [];
      const multiModels = MULTI_TOKEN_MODELS[mk.replace(/ /g, "_")] || [];
      const afterMakeStr = slugParts.join(" ");
      for (const mm of multiModels) {
        if (afterMakeStr.includes(mm.replace(/ /g, " ")) || afterMakeStr.includes(mm.replace(/ /g, "-"))) {
          model = mm.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
          break;
        }
      }
      if (!model && slugParts.length > 0) {
        const nonYear = slugParts.filter(p => !/^20\d{2}$/.test(p));
        if (nonYear.length > 0) {
          model = nonYear[0].charAt(0).toUpperCase() + nonYear[0].slice(1);
          if (nonYear.length > 1) variant = nonYear.slice(1).join(" ").toUpperCase();
        }
      }
      break;
    }
  }

  if (!make || !model) {
    const titleMatch = text.match(/^#\s*(.+)/m) || text.match(/^(.+?)[\n\r]/);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      for (const mk of KNOWN_MAKES) {
        if (title.toLowerCase().includes(mk)) {
          make = make || (mk.charAt(0).toUpperCase() + mk.slice(1));
          const afterMake = title.toLowerCase().split(mk)[1]?.trim() || "";
          const words = afterMake.split(/\s+/).filter(w => w && !/^\d{4}$/.test(w) && !/^\$/.test(w));
          if (words.length > 0 && !model) {
            model = words[0].charAt(0).toUpperCase() + words[0].slice(1);
            if (words.length > 1) variant = variant || words.slice(1, 3).join(" ").toUpperCase();
          }
          break;
        }
      }
    }
  }

  const stateMatch = text.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/);
  const state = stateMatch ? stateMatch[1] : null;
  const locationMatch = text.match(/(?:Location|Located|Pickup)[:\s]+([^\n,]+)/i);
  const location = locationMatch ? locationMatch[1].trim() : null;

  return { make, model, variant, year, km, price, location, state };
}

function extractSourceId(url: string, source: string): string | null {
  if (source === "pickles") {
    const m = url.match(/\/(\d+)(?:\?|$)/);
    return m ? m[1] : null;
  }
  if (source === "grays") {
    const m = url.match(/\/lot\/([0-9-]+)\//);
    return m ? m[1] : null;
  }
  if (source === "manheim") {
    const m = url.match(/\/home\/(\d+)\//);
    return m ? m[1] : null;
  }
  if (source === "autotrader") {
    const m = url.match(/\/(\d{5,})/);
    return m ? m[1] : null;
  }
  return null;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ─── LIFECYCLE SWEEP ─────────────────────────────────────────────────────────

async function handleLifecycleSweep(sb: any): Promise<any> {
  const now = new Date().toISOString();
  const stale7d = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
  const dead14d = new Date(Date.now() - 14 * 24 * 3600000).toISOString();

  // Mark stale (7 days unseen)
  const { data: staleData } = await sb
    .from("vehicle_listings")
    .update({ lifecycle_state: "STALE", updated_at: now })
    .eq("lifecycle_state", "NEW")
    .lt("last_seen_at", stale7d)
    .select("id");

  const staleCount = staleData?.length || 0;

  // Mark dead (14 days unseen)
  const { data: deadData } = await sb
    .from("vehicle_listings")
    .update({ lifecycle_state: "DEAD", updated_at: now, status: "inactive" })
    .in("lifecycle_state", ["NEW", "STALE"])
    .lt("last_seen_at", dead14d)
    .select("id");

  const deadCount = deadData?.length || 0;

  // Revive if seen again
  const { data: revived } = await sb
    .from("vehicle_listings")
    .update({ lifecycle_state: "NEW", updated_at: now })
    .in("lifecycle_state", ["STALE", "DEAD"])
    .gte("last_seen_at", stale7d)
    .select("id");

  const revivedCount = revived?.length || 0;

  console.log(`[LIFECYCLE] stale=${staleCount} dead=${deadCount} revived=${revivedCount}`);

  return { stale_marked: staleCount, dead_marked: deadCount, revived: revivedCount };
}

// ─── SCORE BATCH ─────────────────────────────────────────────────────────────
// Triggers the replication engine for scoring

async function handleScoreBatch(sb: any, payload: any): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  console.log(`[WORKER] Triggering pickles-replication-cron for scoring`);

  const resp = await fetch(`${supabaseUrl}/functions/v1/pickles-replication-cron`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Replication returned ${resp.status}`);
  return body;
}

// ─── AUDIT HELPER ────────────────────────────────────────────────────────────

async function writeAudit(sb: any, jobId: string, step: string, meta: any) {
  await sb.from("crosssafe_audit_log").insert({
    job_id: jobId,
    step,
    meta,
  });
}
