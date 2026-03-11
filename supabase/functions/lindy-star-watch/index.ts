/**
 * lindy-star-watch — When a user stars a vehicle, trigger Lindy via Gmail SMTP relay.
 *
 * POST { listing_id: uuid }
 *
 * Flow:
 *   1. Look up vehicle details from vehicle_listings
 *   2. Send email via Gmail SMTP (STARTTLS) to LindyMail trigger
 *   3. Log the dispatch in outward_jobs for tracking
 *
 * Required secrets:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LINDY_TRIGGER_EMAIL = "carbitrage-dispatch-mackayauctioneers@lindymail.ai";
const LINDY_SUBJECT_PREFIX = "carbitrage-batch";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Load SMTP config from secrets ──
  const smtpHost = Deno.env.get("SMTP_HOST");
  const smtpPortRaw = Deno.env.get("SMTP_PORT");
  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPass = Deno.env.get("SMTP_PASS");
  const smtpFrom = Deno.env.get("SMTP_FROM");

  const missing = [
    !smtpHost && "SMTP_HOST",
    !smtpPortRaw && "SMTP_PORT",
    !smtpUser && "SMTP_USER",
    !smtpPass && "SMTP_PASS",
    !smtpFrom && "SMTP_FROM",
  ].filter(Boolean);

  if (missing.length > 0) {
    console.error(`[lindy-star-watch] Missing secrets: ${missing.join(", ")}`);
    return new Response(
      JSON.stringify({ status: "email_failed", error: `Missing SMTP secrets: ${missing.join(", ")}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const smtpPort = parseInt(smtpPortRaw!, 10);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { listing_id } = await req.json();
    if (!listing_id) {
      return new Response(
        JSON.stringify({ error: "listing_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Look up vehicle listing ──
    const { data: listing, error: listErr } = await sb
      .from("vehicle_listings")
      .select("id, listing_id, listing_url, make, model, year, variant_used, km, source, auction_house, auction_datetime")
      .eq("id", listing_id)
      .single();

    if (listErr || !listing) {
      return new Response(
        JSON.stringify({ error: "Listing not found", detail: listErr?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const listingUrl = listing.listing_url;
    if (!listingUrl) {
      return new Response(
        JSON.stringify({ error: "Listing has no URL to watch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const vehicleDesc = [listing.year, listing.make, listing.model, listing.variant_used]
      .filter(Boolean).join(" ");

    const jobId = crypto.randomUUID();
    const queueId = crypto.randomUUID();

    const prompt = `WATCH ALERT — Browse this listing and extract current status:
${listingUrl}

Vehicle: ${vehicleDesc}
${listing.km ? `Odometer: ${listing.km.toLocaleString()} km` : ""}
${listing.auction_house ? `Auction house: ${listing.auction_house}` : ""}
${listing.auction_datetime ? `Auction date: ${listing.auction_datetime}` : ""}

Extract: current status (active/upcoming/sold/removed), current price, auction date, and any notes.
Return as JSON with fields: listing_url, vehicle, current_status, current_price, auction_date, notes, watch_established.`;

    const emailBody = JSON.stringify({
      rows: [{
        id: queueId,
        source: "star_watch",
        page: 1,
        url: listingUrl,
        prompt,
        job_id: jobId,
        search_run_id: jobId,
      }],
    });

    const subject = `${LINDY_SUBJECT_PREFIX}: star-watch`;

    // ── Send via Gmail SMTP (STARTTLS on port 587) ──
    console.log(`[lindy-star-watch] SMTP connecting to ${smtpHost}:${smtpPort} as ${smtpUser}`);
    console.log(`[lindy-star-watch] Sending to: ${LINDY_TRIGGER_EMAIL}`);
    console.log(`[lindy-star-watch] Subject: ${subject}`);
    console.log(`[lindy-star-watch] Vehicle: ${vehicleDesc} → ${listingUrl}`);

    let client: SMTPClient;
    try {
      // Port 587 = STARTTLS, Port 465 = implicit TLS
      const useTls = smtpPort === 465;
      client = new SMTPClient({
        connection: {
          hostname: smtpHost!,
          port: smtpPort,
          tls: useTls,
          auth: {
            username: smtpUser!,
            password: smtpPass!,
          },
        },
      });
    } catch (connErr) {
      const msg = connErr instanceof Error ? connErr.message : String(connErr);
      console.error(`[lindy-star-watch] SMTP connection failed: ${msg}`);
      return new Response(
        JSON.stringify({ status: "email_failed", error: `SMTP connection failed: ${msg}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    try {
      await client.send({
        from: smtpFrom!,
        to: LINDY_TRIGGER_EMAIL,
        subject,
        content: emailBody,
      });
      console.log(`[lindy-star-watch] ✅ Email sent successfully via ${smtpHost}`);
    } catch (sendErr) {
      const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      console.error(`[lindy-star-watch] ❌ Email send failed: ${msg}`);
      await client.close().catch(() => {});
      return new Response(
        JSON.stringify({ status: "email_failed", error: msg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await client.close().catch(() => {});

    // ── Audit log ──
    await sb.from("outward_jobs").insert({
      id: jobId,
      search_run_id: jobId,
      source_key: "star_watch",
      search_url: listingUrl,
      status: "dispatched",
      dispatched_at: new Date().toISOString(),
    }).then(({ error: insErr }) => {
      if (insErr) console.warn("[lindy-star-watch] Audit log insert failed:", insErr.message);
    });

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        vehicle: vehicleDesc,
        url: listingUrl,
        smtp_relay: smtpHost,
        destination: LINDY_TRIGGER_EMAIL,
        message: `Watch dispatched via Gmail SMTP for: ${vehicleDesc}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[lindy-star-watch] Unhandled error:", msg);
    return new Response(
      JSON.stringify({ status: "email_failed", error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
