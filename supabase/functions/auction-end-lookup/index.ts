// auction-end-lookup: fills vehicle_listings.auction_datetime (auction END, UTC) for auction lots the feeds leave blank,
// then copies it onto matching desk rows. One public page fetch per auction event, never per lot.
// Today only Slattery publishes closesAt on its public auction page; Manheim blocks server fetches (see AGENTS.md).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { parseSlatteryCloses, slatteryAuctionId } from "../_shared/deskFreshness.ts";

const MAX_EVENTS = 20;
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Server-to-server only (the scorer calls it with the service client).
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${key}`) return json(401, { error: "unauthorized" });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });

  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data: rows, error } = await sb.from("vehicle_listings")
    .select("listing_id, listing_url").eq("source", "slattery").in("status", ["active", "catalogue", "listed"])
    .is("auction_datetime", null).gte("last_seen_at", since).limit(3000);
  if (error) return json(500, { error: error.message });

  const byEvent = new Map<string, { listing_id: string; asset: string }[]>();
  for (const r of rows ?? []) {
    const ev = slatteryAuctionId(r.listing_url);
    const asset = /^slattery:(\d+)$/.exec(r.listing_id ?? "")?.[1];
    if (!ev || !asset) continue;
    if (!byEvent.has(ev)) byEvent.set(ev, []);
    byEvent.get(ev)!.push({ listing_id: r.listing_id, asset });
  }

  const result = { events: 0, filled: 0, failed: 0 };
  for (const [ev, lots] of [...byEvent].slice(0, MAX_EVENTS)) {
    try {
      const res = await fetch(`https://slatteryauctions.com.au/auctions/${ev}`, { headers: { "User-Agent": "Mozilla/5.0 Carbitrage" }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) { await res.text(); result.failed++; continue; }
      const { byAsset, latest } = parseSlatteryCloses(await res.text());
      result.events++;
      const groups = new Map<string, string[]>();
      for (const l of lots) {
        const close = byAsset[l.asset] ?? latest;
        if (!close) continue;
        if (!groups.has(close)) groups.set(close, []);
        groups.get(close)!.push(l.listing_id);
      }
      for (const [close, ids] of groups) {
        await sb.from("vehicle_listings").update({ auction_datetime: close }).in("listing_id", ids).is("auction_datetime", null);
        await sb.from("operator_opportunities").update({ auction_datetime: close }).in("listing_id", ids).is("auction_datetime", null);
        result.filled += ids.length;
      }
    } catch (e) {
      result.failed++;
      console.warn(`[auction-end-lookup] event ${ev} failed:`, (e as Error).message);
    }
  }
  return json(200, { ok: true, ...result, pending_events: Math.max(0, byEvent.size - MAX_EVENTS) });
});
