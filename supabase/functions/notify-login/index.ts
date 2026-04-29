/**
 * notify-login — Sends a Lindy email on dealer login.
 * Triggered client-side after login_events insert.
 *
 * POST { email, logged_in_at }
 */

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
    return new Response(
      JSON.stringify({ error: `Missing secrets: ${missing.join(", ")}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { email, logged_in_at } = await req.json();

    const subject = "carbitrage_dealer_login";
    const body = JSON.stringify({
      event: "dealer_login",
      email: email || "unknown",
      logged_in_at: logged_in_at || new Date().toISOString(),
    });

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: smtpFrom,
      to: LINDY_EMAIL,
      subject,
      text: body,
    });

    console.log(`[notify-login] ✅ Login alert sent for ${email}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    // Fire-and-forget telemetry: never fail the caller. Log + return 200.
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[notify-login] ❌ (swallowed)", msg);
    return new Response(
      JSON.stringify({ success: false, swallowed: true, error: msg }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
