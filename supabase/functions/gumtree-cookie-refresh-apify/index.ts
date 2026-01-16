import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * gumtree-cookie-refresh-apify
 * 
 * Starts the Apify Playwright cookie capture actor, waits for completion,
 * fetches the cookie header, validates against the JSON API, and stores
 * in http_session_secrets.
 * 
 * Schedule: every 6 hours (or on-demand if JSON lane fails)
 */

const GUMTREE_JSON_URL = "https://www.gumtree.com.au/ws/search.json";
const GUMTREE_REFERER = "https://www.gumtree.com.au/s-cars-vans-utes/caryear-2016__2025/c18320?carmileageinkms=__150000&forsaleby=delr&sort=date&view=gallery";

function buildJsonUrl(pageNum = 1) {
  const p = new URLSearchParams({
    "categoryId": "18320",
    "pageNum": String(pageNum),
    "pageSize": "24",
    "sortByName": "date",
    "locationId": "0",
    "attributeMap[cars.caryear_i_FROM]": "2016",
    "attributeMap[cars.caryear_i_TO]": "2025",
    "attributeMap[cars.carmileageinkms_i_TO]": "150000",
    "attributeMap[cars.forsaleby_s]": "delr",
  });
  return `${GUMTREE_JSON_URL}?${p.toString()}`;
}

interface CookieCaptureResult {
  site: string;
  cookie_header: string;
  user_agent: string;
  captured_at: string;
}

async function validateCookieWithJsonApi(
  cookieHeader: string, 
  userAgent: string
): Promise<{ valid: boolean; status: number; resultCount: number; error?: string }> {
  try {
    const res = await fetch(buildJsonUrl(1), {
      method: "GET",
      headers: {
        "accept": "application/json",
        "referer": GUMTREE_REFERER,
        "x-requested-with": "XMLHttpRequest",
        "user-agent": userAgent,
        "cookie": cookieHeader,
      },
    });

    if (!res.ok) {
      return { valid: false, status: res.status, resultCount: 0, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const results = data?.data?.results || data?.results || [];
    const resultCount = Array.isArray(results) ? results.length : 0;

    // Validate: at least 5 results and years look reasonable
    if (resultCount < 5) {
      return { valid: false, status: res.status, resultCount, error: `Only ${resultCount} results (need ≥5)` };
    }

    // Sample check: verify years are in range
    let validYears = 0;
    for (const item of results.slice(0, 10)) {
      const year = item?.attributes?.cars?.caryear_i || item?.year;
      if (year && year >= 2016 && year <= 2026) {
        validYears++;
      }
    }

    if (validYears < 3) {
      return { valid: false, status: res.status, resultCount, error: `Year validation failed (${validYears}/10 valid)` };
    }

    return { valid: true, status: res.status, resultCount };
  } catch (err) {
    return { valid: false, status: 0, resultCount: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const apifyToken = Deno.env.get("APIFY_TOKEN");
    // Actor ID format: username/actor-name
    const actorId = Deno.env.get("APIFY_ACTOR_ID_GUMTREE_COOKIE") || "fayoussef/gumtree-cookie-capture";

    if (!apifyToken) {
      throw new Error("APIFY_TOKEN not configured");
    }

    console.log(`Starting Apify actor: ${actorId}`);

    // 1) Start actor run with waitForFinish (short timeout, we'll poll)
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}&waitForFinish=30`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: GUMTREE_REFERER,
        }),
      }
    );

    if (!runResponse.ok) {
      const err = await runResponse.text();
      throw new Error(`Apify run start failed: ${runResponse.status} - ${err}`);
    }

    const runData = await runResponse.json();
    const runId = runData.data?.id;
    const runStatus = runData.data?.status;
    const datasetId = runData.data?.defaultDatasetId;

    console.log(`Apify run: ${runId}, status: ${runStatus}, dataset: ${datasetId}`);

    // 2) Poll for completion if not already done
    let finalStatus = runStatus;
    let pollAttempts = 0;
    const maxPolls = 12; // 12 * 5s = 60s max wait

    while (finalStatus === "RUNNING" || finalStatus === "READY") {
      if (pollAttempts >= maxPolls) {
        throw new Error(`Apify run ${runId} timed out after ${maxPolls * 5}s`);
      }
      
      await new Promise(r => setTimeout(r, 5000)); // Wait 5s
      pollAttempts++;

      const statusRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
      );
      const statusData = await statusRes.json();
      finalStatus = statusData.data?.status;
      console.log(`Poll ${pollAttempts}: status=${finalStatus}`);
    }

    if (finalStatus !== "SUCCEEDED") {
      throw new Error(`Apify run ${runId} ended with status: ${finalStatus}`);
    }

    // 3) Fetch dataset items
    const datasetRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`
    );
    
    if (!datasetRes.ok) {
      throw new Error(`Failed to fetch dataset: ${datasetRes.status}`);
    }

    const items: CookieCaptureResult[] = await datasetRes.json();
    
    if (!items || items.length === 0) {
      throw new Error("No cookie data returned from Apify actor");
    }

    const cookieData = items[0];
    const { cookie_header, user_agent, captured_at } = cookieData;

    if (!cookie_header || cookie_header.length < 20) {
      throw new Error(`Invalid cookie header: ${cookie_header?.slice(0, 50)}`);
    }

    console.log(`Captured cookie (${cookie_header.length} chars) at ${captured_at}`);

    // 4) Validate cookie against JSON API
    const validation = await validateCookieWithJsonApi(cookie_header, user_agent);
    console.log(`Validation: valid=${validation.valid}, status=${validation.status}, results=${validation.resultCount}`);

    // 5) Store cookie (even if validation fails, but mark it)
    const expiresAt = validation.valid
      ? new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString() // 20h if valid
      : new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();  // 1h if invalid (retry soon)

    const { error: upsertError } = await supabase
      .from("http_session_secrets")
      .upsert({
        site: "gumtree",
        cookie_header: cookie_header,
        user_agent: user_agent,
        updated_at: new Date().toISOString(),
        expires_at: expiresAt,
        last_status: validation.status,
        last_error: validation.valid ? null : validation.error,
      });

    if (upsertError) {
      console.error("Failed to store cookie:", upsertError.message);
    }

    // 6) Audit log
    const elapsedMs = Date.now() - startTime;
    await supabase.from("cron_audit_log").insert({
      cron_name: "gumtree-cookie-refresh-apify",
      success: validation.valid,
      result: {
        apify_run_id: runId,
        apify_status: finalStatus,
        cookie_len: cookie_header.length,
        validation_status: validation.status,
        validation_results: validation.resultCount,
        validation_error: validation.error || null,
        expires_at: expiresAt,
        elapsed_ms: elapsedMs,
        poll_attempts: pollAttempts,
      },
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({
      success: validation.valid,
      apify_run_id: runId,
      cookie_len: cookie_header.length,
      validation: {
        valid: validation.valid,
        status: validation.status,
        results: validation.resultCount,
        error: validation.error,
      },
      expires_at: expiresAt,
      elapsed_ms: elapsedMs,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Cookie refresh error:", errorMsg);

    // Try to log the failure
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase.from("cron_audit_log").insert({
        cron_name: "gumtree-cookie-refresh-apify",
        success: false,
        error: errorMsg,
        result: { elapsed_ms: Date.now() - startTime },
        run_date: new Date().toISOString().split("T")[0],
      });
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ success: false, error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
