/**
 * dealer-onboard-dispatch — Dispatches a new dealer to CaroogleAI for auto-profiling.
 *
 * Sends a JSON payload via email to the CaroogleAI LindyMail trigger address.
 * The agent crawls the dealer website, extracts inventory patterns, builds a
 * fingerprint, and POSTs results back to dealer-fingerprint-webhook.
 *
 * Required secrets:
 *   - SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM
 *   - LINDY_WEBHOOK_SECRET (for callback HMAC signature)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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

  let body: {
    dealer_profile_id: string;
    dealer_name: string;
    dealer_website: string;
    dealer_email?: string;
    dealer_phone?: string;
  };

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
  console.log(`[dealer-onboard-dispatch] Target: ${LINDY_EMAIL} | Callback: ${CALLBACK_URL}`);

  try {
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Deno.env.get("SMTP_PORT");
    const smtpUser = Deno.env.get("SMTP_USERNAME");
    const smtpPass = Deno.env.get("SMTP_PASSWORD");
    const smtpFrom = Deno.env.get("SMTP_FROM");

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !smtpFrom) {
      return new Response(
        JSON.stringify({ error: "SMTP credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: Number(smtpPort),
        tls: true,
        auth: { username: smtpUser, password: smtpPass },
      },
    });

    await client.send({
      from: smtpFrom,
      to: LINDY_EMAIL,
      subject: `dealer_profile — ${body.dealer_name}`,
      content: "auto",
      html: `<pre>${JSON.stringify(emailPayload, null, 2)}</pre>`,
    });

    await client.close();

    console.log(`[dealer-onboard-dispatch] Email dispatched to ${LINDY_EMAIL}`);

    return new Response(
      JSON.stringify({
        status: "dispatched",
        method: "email",
        dealer_profile_id: body.dealer_profile_id,
        message: `CaroogleAI profiling dispatched via email to ${LINDY_EMAIL}. Fingerprint will arrive at dealer-fingerprint-webhook.`,
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
