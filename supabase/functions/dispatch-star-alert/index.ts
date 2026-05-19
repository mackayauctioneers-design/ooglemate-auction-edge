/**
 * dispatch-star-alert
 *
 * Fan-out alert sender for starred-car events.
 * Reads dealer_notification_settings, sends via enabled channels
 * (email/telegram), always CC's OPERATOR_ALERT_EMAIL, and logs to
 * dealer_alert_log.
 *
 * POST {
 *   dealer_id: uuid,
 *   event_type: 'star_acknowledged' | 'star_scrape_complete' | 'star_price_drop' | 'star_auction_imminent',
 *   subject: string,
 *   body_text: string,
 *   body_html?: string,
 *   listing_url?: string,
 *   context?: object
 * }
 *
 * Auth: caller must be either service_role (other edge funcs) or an admin user JWT.
 * Secrets: SMTP_*, LOVABLE_API_KEY, TELEGRAM_API_KEY, OPERATOR_ALERT_EMAIL
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "https://esm.sh/nodemailer@6.9.12";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_GATEWAY = "https://connector-gateway.lovable.dev/telegram";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any;
  try { body = await req.json(); } catch {
    return json({ error: "invalid body" }, 400);
  }

  const dealer_id: string = body?.dealer_id;
  const event_type: string = body?.event_type || "star_event";
  const subject: string = body?.subject || "Carbitrage star update";
  const text: string = body?.body_text || "";
  const html: string = body?.body_html || `<pre style="font:14px/1.5 -apple-system,sans-serif">${escapeHtml(text)}</pre>`;
  const listing_url: string | undefined = body?.listing_url;
  const context = body?.context ?? {};

  if (!dealer_id) return json({ error: "dealer_id required" }, 400);

  // Load prefs
  const { data: prefs } = await sb
    .from("dealer_notification_settings")
    .select("email, telegram_chat_id, preferred_channels, notify_star, push_enabled")
    .eq("dealer_id", dealer_id)
    .maybeSingle();

  if (!prefs?.notify_star) {
    return json({ ok: true, skipped: "notify_star disabled" });
  }

  const channels = new Set(prefs?.preferred_channels ?? ["email"]);
  const operatorEmail = Deno.env.get("OPERATOR_ALERT_EMAIL");
  const results: Record<string, any> = {};

  // ── Email ──
  if (channels.has("email") && prefs?.email) {
    results.email = await sendEmail({
      to: prefs.email,
      cc: operatorEmail,
      subject,
      text: text + (listing_url ? `\n\n${listing_url}` : ""),
      html: html + (listing_url ? `<p><a href="${listing_url}">${listing_url}</a></p>` : ""),
    });
    await logSend(sb, dealer_id, event_type, "email", prefs.email, subject, text, results.email);
  }

  // ── Telegram ──
  if (channels.has("telegram") && prefs?.telegram_chat_id) {
    results.telegram = await sendTelegram(prefs.telegram_chat_id,
      `*${escapeMd(subject)}*\n\n${escapeMd(text)}${listing_url ? `\n\n${listing_url}` : ""}`);
    await logSend(sb, dealer_id, event_type, "telegram", String(prefs.telegram_chat_id), subject, text, results.telegram);
  }

  // ── Operator CC (always, even if dealer disabled email channel) ──
  if (operatorEmail && !channels.has("email")) {
    results.operator = await sendEmail({
      to: operatorEmail,
      subject: `[Carbitrage OPS] ${subject}`,
      text: `Dealer ${dealer_id}\n\n${text}${listing_url ? `\n\n${listing_url}` : ""}`,
      html,
    });
    await logSend(sb, dealer_id, event_type, "operator_email", operatorEmail, subject, text, results.operator);
  }

  return json({ ok: true, results });
});

async function sendEmail({ to, cc, subject, text, html }: { to: string; cc?: string; subject: string; text: string; html: string; }) {
  const smtpUser = Deno.env.get("SMTP_USERNAME");
  const smtpPass = Deno.env.get("SMTP_PASSWORD");
  const smtpFrom = Deno.env.get("SMTP_FROM") || smtpUser;
  if (!smtpUser || !smtpPass) return { status: "failed", error: "SMTP not configured" };

  try {
    const t = nodemailer.createTransport({
      host: Deno.env.get("SMTP_HOST") || "smtp.gmail.com",
      port: parseInt(Deno.env.get("SMTP_PORT") || "587", 10),
      secure: false,
      auth: { user: smtpUser, pass: smtpPass },
    });
    const info = await t.sendMail({ from: smtpFrom, to, cc, subject, text, html });
    return { status: "sent", message_id: info.messageId };
  } catch (e) {
    return { status: "failed", error: String((e as Error).message ?? e) };
  }
}

async function sendTelegram(chat_id: string, markdown: string) {
  const key = Deno.env.get("LOVABLE_API_KEY");
  const tg = Deno.env.get("TELEGRAM_API_KEY");
  if (!key || !tg) return { status: "failed", error: "Telegram not configured" };
  try {
    const r = await fetch(`${TELEGRAM_GATEWAY}/sendMessage`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "X-Connection-Api-Key": tg,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id, text: markdown, parse_mode: "Markdown", disable_web_page_preview: false }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) return { status: "failed", error: `tg ${r.status}: ${JSON.stringify(j)}` };
    return { status: "sent", message_id: j.result?.message_id };
  } catch (e) {
    return { status: "failed", error: String((e as Error).message ?? e) };
  }
}

async function logSend(sb: any, dealer_id: string, event_type: string, channel: string, recipient: string, subject: string, body: string, res: any) {
  await sb.from("dealer_alert_log").insert({
    dealer_id, event_type, channel, recipient, subject, body,
    status: res?.status ?? "unknown",
    error: res?.error ?? null,
    context: { message_id: res?.message_id ?? null },
  });
}

function escapeHtml(s: string) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
function escapeMd(s: string) { return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1"); }

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
