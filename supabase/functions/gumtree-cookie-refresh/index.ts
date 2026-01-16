import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GUMTREE_LANDING =
  "https://www.gumtree.com.au/s-cars-vans-utes/caryear-2016__2025/c18320?carmileageinkms=__150000&forsaleby=delr&sort=date&view=gallery";

// Keep UA stable between refresh + JSON calls
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

// Gumtree JSON endpoint we want to unlock (minimal sanity check)
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
  return `https://www.gumtree.com.au/ws/search.json?${p.toString()}`;
}

function extractCookieHeaderFromSetCookie(setCookie: string): string {
  // set-cookie may contain multiple cookies separated by comma;
  // but commas also appear in Expires=... so we parse conservatively.
  // Strategy: split on ", " only when it looks like a new cookie "name=value".
  const parts: string[] = [];
  let buf = "";
  const tokens = setCookie.split(",");
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // heuristic: a new cookie starts with something like "name=value"
    const looksLikeNewCookie = /^[^=\s;,]+=[^;]*/.test(t.trim()) && !t.toLowerCase().includes("expires=");
    if (looksLikeNewCookie && buf) {
      parts.push(buf);
      buf = t;
    } else {
      buf = buf ? `${buf},${t}` : t;
    }
  }
  if (buf) parts.push(buf);

  // Now take "name=value" from each cookie string
  const nameValues = parts
    .map((c) => c.split(";")[0].trim())
    .filter((nv) => nv.includes("="));

  // Deduplicate by cookie name (last wins)
  const map = new Map<string, string>();
  for (const nv of nameValues) {
    const idx = nv.indexOf("=");
    const name = nv.slice(0, idx).trim();
    map.set(name, nv);
  }

  return Array.from(map.values()).join("; ");
}

async function testJson(cookieHeader: string): Promise<{ ok: boolean; status: number; preview: string }> {
  const res = await fetch(buildJsonUrl(1), {
    method: "GET",
    headers: {
      "accept": "application/json",
      "referer": GUMTREE_LANDING,
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
      "cookie": cookieHeader,
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, preview: text.slice(0, 200) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 1) Fetch Gumtree landing page to receive Set-Cookie headers
    const landingRes = await fetch(GUMTREE_LANDING, {
      method: "GET",
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": UA,
      },
      redirect: "follow",
    });

    const setCookie = landingRes.headers.get("set-cookie") ?? "";
    if (!setCookie) {
      // Some environments don't expose set-cookie headers. Still record the failure.
      await supabase.from("http_session_secrets").upsert({
        site: "gumtree",
        cookie_header: "",
        user_agent: UA,
        updated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        last_status: landingRes.status,
        last_error: "No set-cookie header visible in edge fetch environment",
      });

      return new Response(JSON.stringify({
        success: false,
        message: "No set-cookie header visible; may need Apify/Playwright-based cookie capture instead.",
        landing_status: landingRes.status,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    const cookieHeader = extractCookieHeaderFromSetCookie(setCookie);

    // 2) Sanity test JSON endpoint with the cookie
    const test = await testJson(cookieHeader);

    // 3) Store cookie (even if test fails, but record status)
    const expiresAt = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(); // 20h
    await supabase.from("http_session_secrets").upsert({
      site: "gumtree",
      cookie_header: cookieHeader,
      user_agent: UA,
      updated_at: new Date().toISOString(),
      expires_at: expiresAt,
      last_status: test.status,
      last_error: test.ok ? null : `JSON test failed: ${test.preview}`,
    });

    // Audit log
    await supabase.from("cron_audit_log").insert({
      cron_name: "gumtree-cookie-refresh",
      success: test.ok,
      result: {
        landing_status: landingRes.status,
        json_test_status: test.status,
        json_test_ok: test.ok,
        json_preview: test.preview,
        cookie_len: cookieHeader.length,
        expires_at: expiresAt,
      },
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({
      success: true,
      landing_status: landingRes.status,
      cookie_len: cookieHeader.length,
      json_test: test,
      expires_at: expiresAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

