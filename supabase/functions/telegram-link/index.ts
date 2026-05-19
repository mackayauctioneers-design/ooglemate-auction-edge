/**
 * telegram-link
 *
 * Telegram bot webhook. Handles `/start <CODE>` from the user to bind their
 * Telegram chat to their dealer_notification_settings row via telegram_link_code.
 *
 * Public webhook — no JWT (Telegram won't send one). Verifies a shared
 * X-Telegram-Bot-Api-Secret-Token derived from TELEGRAM_API_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
};

const TELEGRAM_GATEWAY = "https://connector-gateway.lovable.dev/telegram";

async function deriveSecret(key: string) {
  const data = new TextEncoder().encode(`telegram-webhook:${key}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const tgKey = Deno.env.get("TELEGRAM_API_KEY");
  const lovKey = Deno.env.get("LOVABLE_API_KEY");
  if (!tgKey || !lovKey) return json({ error: "telegram not configured" }, 500);

  const expected = await deriveSecret(tgKey);
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (got !== expected) return json({ error: "unauthorized" }, 401);

  const update = await req.json().catch(() => null);
  const msg = update?.message ?? update?.edited_message;
  const chat_id = msg?.chat?.id;
  const text: string = msg?.text ?? "";
  if (!chat_id) return json({ ok: true, ignored: true });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // /start ABC123  -> bind code to dealer
  const startMatch = /^\/start(?:@\w+)?\s+([A-Z0-9]{4,12})/i.exec(text.trim());
  if (startMatch) {
    const code = startMatch[1].toUpperCase();
    const { data: pref } = await sb
      .from("dealer_notification_settings")
      .select("dealer_id, telegram_chat_id")
      .eq("telegram_link_code", code)
      .maybeSingle();

    if (!pref) {
      await reply(chat_id, "❌ That link code isn't valid. Open Carbitrage → Notifications and copy a fresh code.");
      return json({ ok: true });
    }

    const channels = new Set<string>([]);
    const { data: cur } = await sb
      .from("dealer_notification_settings")
      .select("preferred_channels")
      .eq("dealer_id", pref.dealer_id)
      .maybeSingle();
    (cur?.preferred_channels ?? []).forEach((c: string) => channels.add(c));
    channels.add("telegram");

    await sb.from("dealer_notification_settings").update({
      telegram_chat_id: String(chat_id),
      telegram_linked_at: new Date().toISOString(),
      telegram_link_code: null,
      preferred_channels: Array.from(channels),
    }).eq("dealer_id", pref.dealer_id);

    await reply(chat_id, "✅ You're connected. I'll DM you here when one of your starred cars updates.");
    return json({ ok: true, linked: true });
  }

  if (/^\/start\b/i.test(text.trim())) {
    await reply(chat_id, "👋 Hi! Open Carbitrage → Notifications and tap *Connect Telegram* to get your link code. Then send it here as `/start CODE`.");
    return json({ ok: true });
  }

  return json({ ok: true });
});

async function reply(chat_id: number | string, text: string) {
  const key = Deno.env.get("LOVABLE_API_KEY")!;
  const tg = Deno.env.get("TELEGRAM_API_KEY")!;
  await fetch(`${TELEGRAM_GATEWAY}/sendMessage`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "X-Connection-Api-Key": tg,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id, text, parse_mode: "Markdown" }),
  });
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
