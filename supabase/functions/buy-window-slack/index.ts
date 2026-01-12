import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Row = {
  id: string;
  listing_id: string | null;
  source: string | null;
  source_class: string | null;
  auction_house: string | null;
  listing_url: string | null;

  make: string | null;
  model: string | null;
  variant_family: string | null;
  year: number | null;
  km: number | null;
  location: string | null;

  watch_status: string | null;
  watch_reason: string | null;
  watch_confidence: string | null;
  buy_window_at: string | null;

  attempt_count: number | null;
  attempt_stage: string | null;

  asking_price: number | null;
  reserve: number | null;

  tracked_by: string | null;

  sold_returned_suspected: boolean | null;
  avoid_reason: string | null;
};

function safe(v: string | null | undefined) {
  return (v ?? "—").toString();
}

function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function prettySource(src: string | null) {
  if (!src) return "—";
  return src.replace(/^trap_/, "").replace(/_/g, " ");
}

function confidenceEmoji(conf: string | null) {
  const c = (conf || "").toLowerCase();
  if (c === "high") return "🟢";
  if (c === "med" || c === "medium") return "🟠";
  if (c === "low") return "🟡";
  return "⚪";
}

function attemptText(r: Row) {
  if (!r.source_class || r.source_class !== "auction") return "";
  if (!r.attempt_count) return "";
  return ` • Run #${r.attempt_count}${r.attempt_stage ? ` (${r.attempt_stage})` : ""}`;
}

function priceText(r: Row) {
  const a = r.asking_price;
  const res = r.reserve;
  if (a || res) return `Price: ${fmtMoney(a ?? res)}`;
  return "Price: — (catalogue)";
}

async function postSlack(webhook: string, blocks: unknown[]) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} ${txt}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") || "";

  if (!SLACK_WEBHOOK_URL) {
    return new Response(JSON.stringify({ error: "Missing SLACK_WEBHOOK_URL secret" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const today = new Date().toISOString().slice(0, 10);

    // Pull top buy_window items (safety: exclude avoid + sold-returned)
    const { data, error } = await supabase
      .from("vehicle_listings")
      .select(
        [
          "id",
          "listing_id",
          "source",
          "source_class",
          "auction_house",
          "listing_url",
          "make",
          "model",
          "variant_family",
          "year",
          "km",
          "location",
          "watch_status",
          "watch_reason",
          "watch_confidence",
          "buy_window_at",
          "attempt_count",
          "attempt_stage",
          "asking_price",
          "reserve",
          "tracked_by",
          "sold_returned_suspected",
          "avoid_reason",
        ].join(",")
      )
      .eq("watch_status", "buy_window")
      .or("sold_returned_suspected.is.false,sold_returned_suspected.is.null")
      .order("buy_window_at", { ascending: false, nullsFirst: false })
      .limit(12);

    if (error) throw error;

    // extra safety filter in code
    const rows = ((data as unknown as Row[]) || []).filter(
      (r) => r.watch_status === "buy_window" && !r.sold_returned_suspected && r.avoid_reason !== "SOLD_RETURNED_MECHANICAL"
    );

    // No items = green heartbeat
    if (rows.length === 0) {
      await postSlack(SLACK_WEBHOOK_URL, [
        { type: "header", text: { type: "plain_text", text: `✅ Buy Window (${today})`, emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: "No BUY_WINDOW listings right now." } },
      ]);

      await supabase.from("cron_audit_log").upsert(
        {
          cron_name: "buy-window-slack",
          run_date: today,
          success: true,
          result: { sent: true, count: 0 },
        },
        { onConflict: "cron_name,run_date" }
      );

      return new Response(JSON.stringify({ success: true, sent: true, count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group: auctions vs classifieds
    const auctions = rows.filter((r) => r.source_class === "auction");
    const classifieds = rows.filter((r) => r.source_class !== "auction");

    const blocks: unknown[] = [
      { type: "header", text: { type: "plain_text", text: `🎯 BUY WINDOW (${today})`, emoji: true } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `Top items that *should be chased / monitored* now.\n` +
            `Auctions: *${auctions.length}* • Retail/Traps: *${classifieds.length}*`,
        },
      },
      { type: "divider" },
    ];

    rows.slice(0, 10).forEach((r, idx) => {
      const title = `${r.year ?? "—"} ${safe(r.make)} ${safe(r.model)}${r.variant_family ? ` (${r.variant_family})` : ""}`;
      const who = r.tracked_by ? `• Tracked: *${r.tracked_by}*` : "• Tracked: —";
      const where = r.location ? `• ${r.location}` : "";
      const why = r.watch_reason ? `\n_${r.watch_reason}_` : "";

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*${idx + 1}.* ${confidenceEmoji(r.watch_confidence)} *${title}*\n` +
            `Source: *${prettySource(r.source)}* ${r.auction_house ? `(${r.auction_house})` : ""}${attemptText(r)}\n` +
            `${priceText(r)} • KM: ${fmtNum(r.km)} ${where}\n` +
            `${who}${why}`,
        },
      });

      if (r.listing_url) {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: `Link: ${r.listing_url}` }],
        });
      }

      blocks.push({ type: "divider" });
    });

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "Action: open *Trap Inventory → Buy Window* and assign tracker + notes." },
    });

    await postSlack(SLACK_WEBHOOK_URL, blocks);

    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "buy-window-slack",
        run_date: today,
        success: true,
        result: { sent: true, count: rows.length },
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ success: true, sent: true, count: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const today = new Date().toISOString().slice(0, 10);

    await supabase.from("cron_audit_log").upsert(
      { cron_name: "buy-window-slack", run_date: today, success: false, error: msg },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
