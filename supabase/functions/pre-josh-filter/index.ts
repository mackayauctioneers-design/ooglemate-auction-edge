import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.12";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * PRE-JOSH FILTER — Auto-screen cheap_car_queue entries before Josh sees them.
 *
 * Runs on a cron (every 5 min). For each NEW listing:
 *   1. Hard-reject obvious duds (missing data, flagged damage/sold, terrible score)
 *   2. Auto-promote high-conviction deals (Well Below Market + high score)
 *   3. Leave borderline ones as NEW for Josh's manual review
 *   4. Score ≥9 PRE_APPROVED → dispatch LindyMail alert for immediate SMS escalation
 *
 * Statuses written:
 *   - AUTO_REJECTED  → removed from Josh's view, reason logged
 *   - PRE_APPROVED   → fast-tracked for Josh (just needs a glance)
 *   - NEW            → unchanged, needs full manual review
 */

type QueueRow = {
  id: string;
  listing_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  market_price: number | null;
  discount_pct: number | null;
  deal_score: number | null;
  deal_tag: string | null;
  price_badge: string | null;
  source: string;
  source_type: string;
  listing_url: string | null;
  flag_damage: boolean | null;
  flag_km_issue: boolean | null;
  flag_sold: boolean | null;
  flag_wrong_variant: boolean | null;
  condition_notes: string | null;
  seller_type: string | null;
  detected_at: string;
  variant: string | null;
  location: string | null;
};

type FilterVerdict = {
  id: string;
  action: "AUTO_REJECTED" | "PRE_APPROVED" | "KEEP";
  reason: string;
};

// ─── Filter rules ───────────────────────────────────────────────────────────

function applyRules(row: QueueRow): FilterVerdict {
  const reasons: string[] = [];

  // ── Hard rejects ──

  // Missing critical identity
  if (!row.make || !row.model || !row.year) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "MISSING_IDENTITY: no make/model/year" };
  }

  // No price at all
  if (!row.price || row.price <= 0) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "NO_PRICE" };
  }

  // Flagged as sold
  if (row.flag_sold) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "FLAGGED_SOLD" };
  }

  // Flagged as damaged
  if (row.flag_damage) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "FLAGGED_DAMAGE" };
  }

  // Flagged as wrong variant
  if (row.flag_wrong_variant) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "WRONG_VARIANT" };
  }

  // KM issue flag
  if (row.flag_km_issue) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "KM_ISSUE" };
  }

  // Price suspiciously low (likely scam or parts-only) — under $3k for 2020+
  if (row.price < 3000 && row.year && row.year >= 2020) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "PRICE_TOO_LOW_SCAM_RISK" };
  }

  // KM way too high (>200k on a 2020+ car)
  if (row.km && row.km > 200000 && row.year && row.year >= 2020) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "KM_EXCESSIVE" };
  }

  // Deal score too low to be worth Josh's time (score <= 2 means minimal discount)
  if (row.deal_score != null && row.deal_score <= 2) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "DEAL_SCORE_TOO_LOW" };
  }

  // Discount too small — less than 3% below market isn't actionable
  if (row.discount_pct != null && row.discount_pct > -3) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "DISCOUNT_INSIGNIFICANT" };
  }

  // Stale listing — detected more than 7 days ago and still NEW
  const ageMs = Date.now() - new Date(row.detected_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > 7) {
    return { id: row.id, action: "AUTO_REJECTED", reason: "STALE_LISTING_7D" };
  }

  // ── Auto-approve high-conviction deals ──

  const badge = (row.price_badge || row.deal_tag || "").toLowerCase();
  const isWellBelow = badge.includes("well below");
  const hasStrongScore = row.deal_score != null && row.deal_score >= 8;
  const hasGoodDiscount = row.discount_pct != null && row.discount_pct <= -12;

  // Well Below Market + strong score = fast-track
  if (isWellBelow && hasStrongScore) {
    reasons.push("WELL_BELOW_MARKET", "DEAL_SCORE_HIGH");
    return { id: row.id, action: "PRE_APPROVED", reason: reasons.join("+") };
  }

  // Deep discount (>= 12%) + reasonable score
  if (hasGoodDiscount && row.deal_score != null && row.deal_score >= 5) {
    reasons.push("DEEP_DISCOUNT", `${row.discount_pct}%`);
    return { id: row.id, action: "PRE_APPROVED", reason: reasons.join("+") };
  }

  // Everything else stays NEW for Josh
  return { id: row.id, action: "KEEP", reason: "BORDERLINE_NEEDS_REVIEW" };
}

// ─── Score ≥9 LindyMail escalation dispatch ─────────────────────────────────

const LINDY_ALERT_EMAIL = "carbitrage-dispatch-mackayauctioneers@lindymail.ai";
const LINDY_ALERT_SUBJECT = "carbitrage_alert_high";

async function dispatchHighScoreAlert(rows: QueueRow[], supabase: any): Promise<number> {
  const eligible = rows.filter(
    (r) => r.deal_score != null && r.deal_score >= 9
  );
  if (eligible.length === 0) return 0;

  // ── Dedup: filter out already-alerted listings ──
  const listingIds = eligible.map((r) => r.listing_id);
  const { data: alreadyAlerted } = await supabase
    .from("alerted_listings")
    .select("listing_id")
    .in("listing_id", listingIds);
  const alertedSet = new Set((alreadyAlerted || []).map((a: any) => a.listing_id));

  // For rows without a real listing_id, hash the payload for dedup
  const dedupedEligible: QueueRow[] = [];
  for (const r of eligible) {
    if (alertedSet.has(r.listing_id)) {
      console.log(`[PRE-JOSH] Dedup skip: ${r.listing_id} already alerted`);
      continue;
    }
    dedupedEligible.push(r);
  }

  if (dedupedEligible.length === 0) {
    console.log("[PRE-JOSH] All ≥9 listings already alerted, skipping");
    return 0;
  }
  const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
  const smtpPort = parseInt(Deno.env.get("SMTP_PORT") || "587", 10);
  const smtpUser = Deno.env.get("SMTP_USERNAME");
  const smtpPass = Deno.env.get("SMTP_PASSWORD");
  const smtpFrom = Deno.env.get("SMTP_FROM");

  if (!smtpUser || !smtpPass || !smtpFrom) {
    console.warn("[PRE-JOSH] SMTP not configured — skipping ≥9 alert dispatch");
    return 0;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  let dispatched = 0;

  for (const row of dedupedEligible) {
    const vehicle = [row.year, row.make, row.model, row.variant]
      .filter(Boolean)
      .join(" ");
    const kmStr = row.km ? `${(row.km / 1000).toFixed(0)}k` : "Unknown";
    const discountStr = row.discount_pct
      ? `${Math.abs(row.discount_pct).toFixed(0)}%`
      : "?%";

    const alertPayload = {
      alert_type: "SCORE_9_ESCALATION",
      vehicle,
      year: row.year,
      make: row.make,
      model: row.model,
      variant: row.variant || null,
      price: row.price,
      market_price: row.market_price,
      discount_pct: row.discount_pct,
      km: row.km,
      km_display: kmStr,
      discount_display: discountStr,
      deal_score: row.deal_score,
      deal_tag: row.deal_tag,
      price_badge: row.price_badge,
      location: row.location || null,
      seller_type: row.seller_type,
      listing_url: row.listing_url,
      source: row.source,
      detected_at: row.detected_at,
      escalated_at: new Date().toISOString(),
    };

    try {
      await transporter.sendMail({
        from: smtpFrom,
        to: LINDY_ALERT_EMAIL,
        subject: LINDY_ALERT_SUBJECT,
        text: JSON.stringify(alertPayload, null, 2),
      });
      // Record in alerted_listings for dedup
      await supabase.from("alerted_listings").upsert(
        { listing_id: row.listing_id, payload_hash: null, alerted_at: new Date().toISOString() },
        { onConflict: "listing_id" }
      );
      dispatched++;
      console.log(
        `[PRE-JOSH] 🔥 Score ≥9 alert dispatched: ${vehicle} @ $${row.price?.toLocaleString()} (-${discountStr})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PRE-JOSH] ≥9 alert dispatch failed for ${vehicle}: ${msg}`);
    }
  }

  return dispatched;
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all NEW entries (cap at 200 per run to stay fast)
    const { data: rows, error: fetchErr } = await supabase
      .from("cheap_car_queue")
      .select(
        "id, listing_id, make, model, year, km, price, market_price, discount_pct, deal_score, deal_tag, price_badge, source, source_type, listing_url, flag_damage, flag_km_issue, flag_sold, flag_wrong_variant, condition_notes, seller_type, detected_at, variant, location"
      )
      .eq("status", "NEW")
      .eq("josh_verified", false)
      .order("detected_at", { ascending: false })
      .limit(200);

    if (fetchErr) {
      console.error("[PRE-JOSH] Fetch error:", fetchErr);
      return new Response(
        JSON.stringify({ success: false, error: fetchErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, auto_rejected: 0, pre_approved: 0, kept: 0, alerts_dispatched: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[PRE-JOSH] Processing ${rows.length} NEW entries`);

    // Apply rules to each
    const verdicts = (rows as QueueRow[]).map(applyRules);

    const rejected = verdicts.filter((v) => v.action === "AUTO_REJECTED");
    const approved = verdicts.filter((v) => v.action === "PRE_APPROVED");
    const kept = verdicts.filter((v) => v.action === "KEEP");

    // Batch update AUTO_REJECTED
    for (const v of rejected) {
      await supabase
        .from("cheap_car_queue")
        .update({
          status: "REJECTED",
          condition_notes: `[AUTO] ${v.reason}`,
          josh_verified: false,
        })
        .eq("id", v.id);
    }

    // Batch update PRE_APPROVED — keep as NEW but add a note so Josh knows it's pre-screened
    for (const v of approved) {
      await supabase
        .from("cheap_car_queue")
        .update({
          condition_notes: `[PRE-APPROVED] ${v.reason}`,
        })
        .eq("id", v.id);
    }

    // ── Score ≥9 escalation: dispatch LindyMail alerts ──
    const approvedRows = (rows as QueueRow[]).filter((r) =>
      approved.some((v) => v.id === r.id)
    );
    const alertsDispatched = await dispatchHighScoreAlert(approvedRows);

    const elapsed = Date.now() - startTime;

    // Log heartbeat
    await supabase.from("cron_heartbeat").upsert(
      {
        cron_name: "pre-josh-filter",
        last_seen_at: new Date().toISOString(),
        last_ok: true,
        note: `processed=${rows.length} rejected=${rejected.length} pre_approved=${approved.length} kept=${kept.length} alerts=${alertsDispatched} ms=${elapsed}`,
      },
      { onConflict: "cron_name" }
    );

    console.log(
      `[PRE-JOSH] Done in ${elapsed}ms — rejected=${rejected.length}, pre_approved=${approved.length}, kept=${kept.length}, alerts_dispatched=${alertsDispatched}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        processed: rows.length,
        auto_rejected: rejected.length,
        pre_approved: approved.length,
        kept: kept.length,
        alerts_dispatched: alertsDispatched,
        elapsed_ms: elapsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[PRE-JOSH] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
