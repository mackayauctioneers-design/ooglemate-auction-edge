/**
 * notify-operator-signup
 * Emails OPERATOR_ALERT_EMAIL whenever a new dealer_profiles row is created.
 * Invoked from a Postgres AFTER INSERT trigger via pg_net.
 */
import nodemailer from "https://esm.sh/nodemailer@6.9.12";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch {}

  const operator = Deno.env.get("OPERATOR_ALERT_EMAIL");
  const smtpUser = Deno.env.get("SMTP_USERNAME");
  const smtpPass = Deno.env.get("SMTP_PASSWORD");
  const smtpFrom = Deno.env.get("SMTP_FROM") || smtpUser;

  if (!operator || !smtpUser || !smtpPass) {
    return json({ ok: false, error: "email not configured" }, 200);
  }

  const dealer_name = body?.dealer_name ?? "(unknown)";
  const dealer_email = body?.dealer_email ?? "—";
  const dealer_website = body?.dealer_website ?? "—";
  const dealer_id = body?.dealer_profile_id ?? "—";

  const subject = `🚗 New Carbitrage signup: ${dealer_name}`;
  const text =
`A new dealer just created a Carbitrage account.

Dealer:   ${dealer_name}
Email:    ${dealer_email}
Website:  ${dealer_website}
ID:       ${dealer_id}

Reply to this email to follow up, or open the operator console to seed fingerprints / star cars for them.`;

  try {
    const t = nodemailer.createTransport({
      host: Deno.env.get("SMTP_HOST") || "smtp.gmail.com",
      port: parseInt(Deno.env.get("SMTP_PORT") || "587", 10),
      secure: false,
      auth: { user: smtpUser, pass: smtpPass },
    });
    const info = await t.sendMail({
      from: smtpFrom, to: operator, subject, text,
    });
    return json({ ok: true, message_id: info.messageId });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 200);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
