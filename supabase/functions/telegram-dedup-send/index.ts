// telegram-dedup-send
// Drop-in replacement for direct Telegram API calls from OpenClaw/Arby.
// Deduplicates by (chat_id, dedup_key) with a 24-hour window.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const chatId = String(body?.chat_id ?? "");
  const text = String(body?.text ?? "");
  const parseMode = body?.parse_mode ?? "HTML";
  const ttlHours = Number(body?.ttl_hours ?? 24);
  const dedupKey = body?.dedup_key
    ? String(body.dedup_key)
    : await sha256(`${chatId}:${text}`);

  if (!chatId || !text) {
    return new Response(JSON.stringify({ error: "chat_id and text required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const t0 = Date.now();

  const since = new Date(Date.now() - ttlHours * 3600_000).toISOString();
  const { data: prior } = await sb
    .from("telegram_sent_log")
    .select("id, telegram_message_id, sent_at")
    .eq("chat_id", chatId)
    .eq("dedup_key", dedupKey)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (prior) {
    return new Response(JSON.stringify({
      ok: true,
      dedup: true,
      telegram_message_id: prior.telegram_message_id,
      sent_at: prior.sent_at,
      dedup_key: dedupKey,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!botToken) {
    return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: false,
      }),
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data?.ok;
    const messageId = ok ? String(data.result?.message_id ?? "") : null;
    const errorText = ok ? null : (data?.description || `HTTP ${res.status}`);

    await sb.from("telegram_sent_log").insert({
      chat_id: chatId,
      dedup_key: dedupKey,
      text_preview: text.slice(0, 500),
      telegram_message_id: messageId,
      telegram_ok: ok,
      telegram_error: errorText,
      ttl_hours: ttlHours,
    });

    return new Response(JSON.stringify({
      ok,
      dedup: false,
      telegram_message_id: messageId,
      dedup_key: dedupKey,
      error: errorText,
      latency_ms: Date.now() - t0,
    }), { status: ok ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: e?.message ?? String(e),
      dedup_key: dedupKey,
    }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
