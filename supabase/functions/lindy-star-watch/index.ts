/**
 * lindy-star-watch — Trigger Lindy via Gmail SMTP relay when a user stars a vehicle.
 *
 * POST { listing_id: uuid }
 *
 * Secrets: SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "https://esm.sh/nodemailer@6.9.12";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LINDY_EMAIL = "carbitrage-dispatch-mackayauctioneers@lindymail.ai";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
  const smtpPort = parseInt(Deno.env.get("SMTP_PORT") || "587", 10);
  const smtpUser = Deno.env.get("SMTP_USERNAME");
  const smtpPass = Deno.env.get("SMTP_PASSWORD");
  const smtpFrom = Deno.env.get("SMTP_FROM");

  const missing = [
    !smtpUser && "SMTP_USERNAME",
    !smtpPass && "SMTP_PASSWORD",
    !smtpFrom && "SMTP_FROM",
  ].filter(Boolean);

  if (missing.length) {
    console.error(`[lindy] Missing secrets: ${missing.join(", ")}`);
    return new Response(
      JSON.stringify({ status: "email_failed", error: `Missing: ${missing.join(", ")}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { listing_id, account_id } = await req.json();
    if (!listing_id) {
      return new Response(
        JSON.stringify({ error: "listing_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Try UUID lookup first, then fall back to listing_id (source-specific ID like "auto_auctions:623744")
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listing_id);
    const { data: listing, error: listErr } = await sb
      .from("vehicle_listings")
      .select("id, listing_id, listing_url, make, model, year, variant_used, km, source, auction_house, auction_datetime")
      .eq(isUuid ? "id" : "listing_id", listing_id)
      .single();

    if (listErr || !listing) {
      return new Response(
        JSON.stringify({ error: "Listing not found", detail: listErr?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!listing.listing_url) {
      return new Response(
        JSON.stringify({ error: "Listing has no URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const vehicle = [listing.year, listing.make, listing.model, listing.variant_used]
      .filter(Boolean).join(" ");
    const jobId = crypto.randomUUID();

    const prompt = `WATCH ALERT — Browse this listing and extract current status:
${listing.listing_url}

Vehicle: ${vehicle}
${listing.km ? `Odometer: ${listing.km.toLocaleString()} km` : ""}
${listing.auction_house ? `Auction house: ${listing.auction_house}` : ""}
${listing.auction_datetime ? `Auction date: ${listing.auction_datetime}` : ""}

Extract: current status (active/upcoming/sold/removed), current price, auction date, and any notes.
Return as JSON with fields: listing_url, vehicle, current_status, current_price, auction_date, notes, watch_established.`;

    const emailBody = JSON.stringify({
      rows: [{
        id: crypto.randomUUID(),
        source: "star_watch",
        page: 1,
        url: listing.listing_url,
        prompt,
        job_id: jobId,
        search_run_id: jobId,
      }],
    });

    const subject = "add to watch list";

    // ── Gmail SMTP via nodemailer ──
    console.log(`[lindy] SMTP → ${smtpHost}:${smtpPort} as ${smtpUser}`);
    console.log(`[lindy] To: ${LINDY_EMAIL} | Subject: ${subject}`);
    console.log(`[lindy] Vehicle: ${vehicle} → ${listing.listing_url}`);

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    try {
      const info = await transporter.sendMail({
        from: smtpFrom,
        to: LINDY_EMAIL,
        subject,
        text: emailBody,
      });
      console.log(`[lindy] ✅ Email sent — messageId: ${info.messageId}`);
    } catch (sendErr: unknown) {
      const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      console.error(`[lindy] ❌ Send failed: ${msg}`);
      return new Response(
        JSON.stringify({ status: "email_failed", error: msg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Audit log
    await sb.from("outward_jobs").insert({
      id: jobId,
      search_run_id: jobId,
      source_key: "star_watch",
      search_url: listing.listing_url,
      status: "dispatched",
      dispatched_at: new Date().toISOString(),
      account_id: account_id || null,
    }).then(({ error }) => {
      if (error) console.warn("[lindy] Audit insert failed:", error.message);
    });

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        vehicle,
        url: listing.listing_url,
        smtp_relay: smtpHost,
        destination: LINDY_EMAIL,
        message: `Watch dispatched for: ${vehicle}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[lindy] Error:", msg);
    return new Response(
      JSON.stringify({ status: "email_failed", error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
