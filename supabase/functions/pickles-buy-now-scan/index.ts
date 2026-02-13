// Pickles Buy Now Scanner — handler isolation test
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const fk = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
  const force = new URL(req.url).searchParams.get("force") === "true";

  if (!fk) {
    return new Response(JSON.stringify({ ok: false, err: "no key" }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  try {
    const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + fk },
      body: JSON.stringify({ url: "https://www.pickles.com.au/cars/search/all-buy-now", formats: ["markdown"], waitFor: 3000 }),
    });
    const d = await r.json();
    const mdLen = (d?.data?.markdown ?? "").length;
    return new Response(JSON.stringify({ ok: true, force, mdLen, status: r.status }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, err: String(e) }), { headers: { ...cors, "Content-Type": "application/json" } });
  }
});
