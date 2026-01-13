import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function postSlack(webhook: string, blocks: unknown[]) {
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") || "";

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => ({}));
    const source_key = body.source_key as string | undefined;
    const debug = body.debug === true;

    if (!source_key) {
      return new Response(JSON.stringify({ error: "source_key required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: src, error } = await supabase
      .from("auction_sources")
      .select("*")
      .eq("source_key", source_key)
      .single();

    if (error || !src) throw error || new Error("source not found");

    // Choose crawler based on platform
    const fn = src.platform === "bidsonline" ? "asp-auction-crawl" : "custom-auction-crawl";

    const t0 = Date.now();
    const res = await supabase.functions.invoke(fn, { body: { source_key, debug } });
    const ms = Date.now() - t0;

    if (res.error) throw new Error(res.error.message);

    // Log event
    await supabase.from("auction_source_events").insert({
      source_key,
      event_type: "run_manual",
      message: `Manual run (${debug ? "debug" : "live"})`,
      meta: { ms, result: res.data },
    });

    // Optional Slack ping
    if (SLACK_WEBHOOK_URL) {
      await postSlack(SLACK_WEBHOOK_URL, [
        { type: "header", text: { type: "plain_text", text: "▶️ Auction Source Run Now", emoji: true } },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `*${src.display_name}* (\`${source_key}\`) manual run complete.\n` +
              `Mode: *${debug ? "debug" : "live"}* • Time: *${ms}ms*\n` +
              `Result keys: \`${Object.keys(res.data || {}).slice(0, 8).join(", ")}\``,
          },
        },
      ]);
    }

    return new Response(JSON.stringify({ success: true, source_key, ms, result: res.data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
