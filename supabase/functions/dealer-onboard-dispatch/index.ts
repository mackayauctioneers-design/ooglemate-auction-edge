/**
 * dealer-onboard-dispatch — Dispatches a new dealer to CaroogleAI for auto-profiling.
 *
 * Sends a JSON payload via email to the CaroogleAI LindyMail trigger address.
 * Uses nodemailer (npm) for reliable STARTTLS — same pattern as lindy-star-watch.
 */

// @ts-nocheck
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LINDY_EMAIL = "caroogleai-dealer-profile@lindymail.ai";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/dealer-fingerprint-webhook`;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.dealer_profile_id || !body.dealer_name || !body.dealer_website) {
    return new Response(
      JSON.stringify({ error: "dealer_profile_id, dealer_name, and dealer_website are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const emailPayload = {
    dealer_profile_id: body.dealer_profile_id,
    dealer_name: body.dealer_name,
    dealer_website: body.dealer_website,
    dealer_email: body.dealer_email || null,
    callback_url: CALLBACK_URL,
  };

  console.log(`[dealer-onboard-dispatch] Sending profiling request for: ${body.dealer_name} → ${body.dealer_website}`);

  try {
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "587");
    const smtpUser = Deno.env.get("SMTP_USERNAME");
    const smtpPass = Deno.env.get("SMTP_PASSWORD");
    const smtpFrom = Deno.env.get("SMTP_FROM");

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
      return new Response(
        JSON.stringify({ error: "SMTP credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: smtpFrom,
      to: LINDY_EMAIL,
      subject: `dealer_profile — ${body.dealer_name}`,
      text: JSON.stringify(emailPayload, null, 2),
      html: `<pre>${JSON.stringify(emailPayload, null, 2)}</pre>`,
    });

    console.log(`[dealer-onboard-dispatch] Email dispatched to ${LINDY_EMAIL}`);

    return new Response(
      JSON.stringify({
        status: "dispatched",
        method: "email",
        dealer_profile_id: body.dealer_profile_id,
        message: `CaroogleAI profiling dispatched via email to ${LINDY_EMAIL}.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[dealer-onboard-dispatch] Email dispatch error:", err);
    return new Response(
      JSON.stringify({ error: "Email dispatch failed", detail: String(err) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
