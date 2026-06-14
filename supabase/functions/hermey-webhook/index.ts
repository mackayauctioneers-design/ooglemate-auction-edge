// hermey-webhook
// Telegram webhook for the Hermey bot. Routes incoming messages to Lovable AI
// with read+search tools over Carbitrage data, then replies on Telegram.
//
// Setup (one-time): set the Telegram webhook to point here, e.g.
//   curl -s "https://api.telegram.org/bot<HERMEY_BOT_TOKEN>/setWebhook?url=https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/hermey-webhook"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BOT_TOKEN = Deno.env.get("HERMEY_BOT_TOKEN")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const SYSTEM_PROMPT = `You are Hermey, the Carbitrage assistant on Telegram.
You help the operator query live dealer/auction data. Be terse — short answers, plain text, no markdown headings. Use the provided tools to look up data; never fabricate listings, prices, or matches. If a tool returns nothing, say so. Currency is AUD. Today's date is ${new Date().toISOString().slice(0,10)}.`;

const tools = [
  {
    type: "function",
    function: {
      name: "list_today_opportunities",
      description: "Return today's top operator opportunities (highest-margin live matches across all accounts).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max rows, default 10", default: 10 },
          tier: { type: "string", description: "Optional tier filter: CODE_RED, HIGH, BUY" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_listings",
      description: "Search live market listings by make/model/year/price/km from the canonical market_listings view.",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string" },
          model: { type: "string" },
          year_min: { type: "number" },
          year_max: { type: "number" },
          price_max: { type: "number" },
          km_max: { type: "number" },
          limit: { type: "number", default: 15 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_sales_truth",
      description: "Recent confirmed dealer sales (vehicle_sales_truth) — proven buy/sell prices.",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string" },
          model: { type: "string" },
          dealer: { type: "string", description: "Optional dealer/account name match" },
          limit: { type: "number", default: 15 },
        },
      },
    },
  },
];

async function execTool(name: string, args: any): Promise<string> {
  try {
    if (name === "list_today_opportunities") {
      const limit = Math.min(Number(args?.limit ?? 10), 25);
      const since = new Date(Date.now() - 36 * 3600_000).toISOString();
      let q = sb.from("operator_opportunities")
        .select("year,make,model,variant,km,asking_price,best_account_name,best_expected_margin,best_under_buy,tier,source_url,listing_source,created_at")
        .gte("created_at", since)
        .order("best_expected_margin", { ascending: false })
        .limit(limit);
      if (args?.tier) q = q.eq("tier", String(args.tier));
      const { data, error } = await q;
      if (error) return `error: ${error.message}`;
      return JSON.stringify(data ?? []);
    }

    if (name === "search_listings") {
      const limit = Math.min(Number(args?.limit ?? 15), 30);
      let q = sb.from("market_listings")
        .select("year,make,model,variant,km,price,source,source_url,state,seen_at")
        .order("seen_at", { ascending: false })
        .limit(limit);
      if (args?.make) q = q.ilike("make", `%${args.make}%`);
      if (args?.model) q = q.ilike("model", `%${args.model}%`);
      if (args?.year_min) q = q.gte("year", Number(args.year_min));
      if (args?.year_max) q = q.lte("year", Number(args.year_max));
      if (args?.price_max) q = q.lte("price", Number(args.price_max));
      if (args?.km_max) q = q.lte("km", Number(args.km_max));
      const { data, error } = await q;
      if (error) return `error: ${error.message}`;
      return JSON.stringify(data ?? []);
    }

    if (name === "recent_sales_truth") {
      const limit = Math.min(Number(args?.limit ?? 15), 30);
      let q = sb.from("vehicle_sales_truth")
        .select("year,make,model,variant,km,buy_price,sell_price,sold_at,account_name")
        .order("sold_at", { ascending: false })
        .limit(limit);
      if (args?.make) q = q.ilike("make", `%${args.make}%`);
      if (args?.model) q = q.ilike("model", `%${args.model}%`);
      if (args?.dealer) q = q.ilike("account_name", `%${args.dealer}%`);
      const { data, error } = await q;
      if (error) return `error: ${error.message}`;
      return JSON.stringify(data ?? []);
    }

    return `unknown tool: ${name}`;
  } catch (e) {
    return `tool_error: ${(e as Error).message}`;
  }
}

async function callLLM(messages: any[]): Promise<string> {
  for (let step = 0; step < 4; step++) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        tools,
        tool_choice: "auto",
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return `AI gateway error ${res.status}: ${txt.slice(0, 300)}`;
    }
    const json = await res.json();
    const msg = json?.choices?.[0]?.message;
    if (!msg) return "No response.";
    messages.push(msg);
    const calls = msg.tool_calls ?? [];
    if (!calls.length) return String(msg.content ?? "").trim() || "(no content)";
    for (const c of calls) {
      let args: any = {};
      try { args = JSON.parse(c.function?.arguments ?? "{}"); } catch {}
      const out = await execTool(c.function?.name, args);
      messages.push({
        role: "tool",
        tool_call_id: c.id,
        content: out.slice(0, 8000),
      });
    }
  }
  return "Stopped after 4 tool steps.";
}

async function tgSend(chatId: number | string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000),
      disable_web_page_preview: true,
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let update: any;
  try { update = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  const msg = update?.message ?? update?.edited_message;
  const chatId = msg?.chat?.id;
  const text = String(msg?.text ?? "").trim();

  if (!chatId || !text) {
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  // Ack immediately, process in background
  (async () => {
    try {
      if (text === "/start" || text === "/help") {
        await tgSend(chatId,
          "Hermey online. Ask me about Carbitrage data — try:\n" +
          "• today's top deals\n" +
          "• show 2020 Rangers under 45k\n" +
          "• recent Mackay Traders sales\n");
        return;
      }
      const reply = await callLLM([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ]);
      await tgSend(chatId, reply);
    } catch (e) {
      await tgSend(chatId, `error: ${(e as Error).message}`);
    }
  })();

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
