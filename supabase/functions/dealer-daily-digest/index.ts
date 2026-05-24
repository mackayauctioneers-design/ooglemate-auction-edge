// Generic daily digest for every active dealer.
// Reads mandate_feed_items from the last 24h, groups by dealer,
// emits a summary alert into mandate_alerts (and email via Resend if configured).
// No dealer-specific code. Runs on cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("SMTP_FROM") ?? "alerts@carbitrage.com.au";

const MIN_SCORE_DIGEST = 70;
const MIN_ITEMS_TO_SEND = 1;

interface FeedItem {
  id: string;
  dealer_id: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  source: string | null;
  source_url: string | null;
  final_score: number | null;
  score: number | null;
  alert_tier: string | null;
  expected_margin: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const result: Record<string, unknown> = { dealers: [], errors: [] };

  // 1. find every dealer with at least one feed item in last 24h (score-eligible)
  const { data: feed, error: feedErr } = await supabase
    .from("mandate_feed_items")
    .select("id, dealer_id, make, model, variant, year, km, asking_price, source, source_url, final_score, score, alert_tier, expected_margin")
    .gte("created_at", since)
    .not("dealer_id", "is", null);

  if (feedErr) {
    return new Response(JSON.stringify({ error: feedErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const byDealer = new Map<string, FeedItem[]>();
  for (const item of (feed ?? []) as FeedItem[]) {
    const s = item.final_score ?? item.score ?? 0;
    if (Number(s) < MIN_SCORE_DIGEST) continue;
    const arr = byDealer.get(item.dealer_id) ?? [];
    arr.push(item);
    byDealer.set(item.dealer_id, arr);
  }

  for (const [dealerId, items] of byDealer) {
    if (items.length < MIN_ITEMS_TO_SEND) continue;
    try {
      const { data: profile } = await supabase
        .from("dealer_profiles")
        .select("id, name, contact_email")
        .eq("id", dealerId)
        .maybeSingle();

      const dealerName = profile?.name ?? "Dealer";
      const recipient = profile?.contact_email ?? null;

      items.sort((a, b) => Number(b.final_score ?? b.score ?? 0) - Number(a.final_score ?? a.score ?? 0));
      const top = items.slice(0, 10);

      const subject = `Carbitrage daily radar — ${dealerName} — ${top.length} opportunities`;

      const lines = top.map((i, idx) => {
        const score = Math.round(Number(i.final_score ?? i.score ?? 0));
        const gp = i.expected_margin != null ? ` · est GP $${Math.round(i.expected_margin).toLocaleString()}` : "";
        return `${idx + 1}. ${i.year ?? ""} ${i.make ?? ""} ${i.model ?? ""} ${i.variant ?? ""} — $${i.asking_price?.toLocaleString() ?? "—"} (score ${score})${gp}\n   ${i.source ?? ""} ${i.source_url ?? ""}`;
      });

      const body = `Top ${top.length} opportunities scored ≥ ${MIN_SCORE_DIGEST} in the last 24h:\n\n${lines.join("\n\n")}\n\nOpen the dealer radar to review and act.`;

      // record alert (always — even if email fails)
      await supabase.from("mandate_alerts").insert({
        dealer_id: dealerId,
        channel: "email",
        status: recipient ? "queued" : "skipped_no_recipient",
        subject,
        body,
        payload: { item_ids: top.map(t => t.id), total_eligible: items.length },
      });

      if (recipient && RESEND_API_KEY) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM,
            to: recipient,
            subject,
            text: body,
          }),
        });
        if (!r.ok) {
          (result.errors as unknown[]).push({ dealerId, status: r.status, text: await r.text() });
        }
      }

      (result.dealers as unknown[]).push({ dealerId, dealerName, items: top.length });
    } catch (e) {
      (result.errors as unknown[]).push({ dealerId, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
