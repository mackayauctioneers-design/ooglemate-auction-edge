// auction-hunter-webhook: Relays scored deal alerts from the OpenClaw hunter swarm to Telegram.
// Auth: Bearer OPENCLAW_HUNTER_TOKEN. bot_token + chat_id are in the request body so the swarm
// owns its own routing without us storing per-recipient secrets.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN = Deno.env.get("OPENCLAW_HUNTER_TOKEN")!;

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j(405, { error: "method_not_allowed" });

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== TOKEN) {
    return j(401, { error: "unauthorized" });
  }

  let body: any;
  try { body = await req.json(); } catch { return j(400, { error: "invalid_json" }); }

  const botToken = String(body.bot_token ?? "").trim();
  const chatId = String(body.chat_id ?? "").trim();
  const text = String(body.message_html ?? body.text ?? "").trim();
  if (!botToken || !chatId || !text) {
    return j(400, { error: "bot_token_chat_id_message_required" });
  }

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const tgJson = await tgRes.json().catch(() => ({}));
    if (!tgRes.ok || !tgJson.ok) {
      return j(200, {
        sent: false,
        error: tgJson?.description ?? `telegram_http_${tgRes.status}`,
        telegram_status: tgRes.status,
      });
    }
    return j(200, { sent: true, message_id: tgJson.result?.message_id });
  } catch (e) {
    return j(200, { sent: false, error: (e as Error).message ?? "telegram_fetch_failed" });
  }
});
