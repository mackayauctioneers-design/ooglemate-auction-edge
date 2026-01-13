import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fmtMoney(n: number | null) {
  if (!n) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtNum(n: number | null) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

async function postSlack(webhook: string, payload: any) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} ${txt}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    const body = await req.json().catch(() => ({}));
    const listing_id = body.listing_id as string | undefined;
    const note = (body.note as string | undefined) || "";

    if (!listing_id) {
      return new Response(JSON.stringify({ error: "listing_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull listing
    const { data: vl, error: qErr } = await supabase
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
          "variant_used",
          "variant_family",
          "year",
          "km",
          "location",
          "asking_price",
          "reserve",
          "watch_status",
          "watch_reason",
          "watch_confidence",
          "buy_window_at",
          "attempt_count",
          "attempt_stage",
          "assigned_to",
          "tracked_by",
          "sold_returned_suspected",
          "avoid_reason",
        ].join(",")
      )
      .eq("id", listing_id)
      .single<any>();

    if (qErr || !vl) throw qErr || new Error("Listing not found");

    // SAFETY gates
    if (vl.sold_returned_suspected || vl.watch_status === "avoid") {
      return new Response(
        JSON.stringify({ error: "Refusing to Slack: listing is AVOID / sold-returned" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (vl.watch_status !== "buy_window") {
      return new Response(
        JSON.stringify({ error: "Only BUY_WINDOW listings can be sent to Slack" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (vl.assigned_to) {
      return new Response(
        JSON.stringify({ error: "Already assigned — Slack ping suppressed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const title =
      `${vl.year ?? "—"} ${vl.make ?? "—"} ${vl.model ?? "—"}` +
      `${(vl.variant_used || vl.variant_family) ? ` (${vl.variant_used || vl.variant_family})` : ""}`;

    const price = fmtMoney(vl.asking_price ?? vl.reserve);
    const km = fmtNum(vl.km);
    const where = vl.location ? `• ${vl.location}` : "";
    const src = (vl.source || "—").toString().replace(/^trap_/, "").replace(/_/g, " ");
    const auction = vl.auction_house ? ` (${vl.auction_house})` : "";
    const run = vl.attempt_count ? ` • Run #${vl.attempt_count}${vl.attempt_stage ? ` (${vl.attempt_stage})` : ""}` : "";
    const confidence = (vl.watch_confidence || "—").toString().toUpperCase();

    const blocks: any[] = [
      { type: "header", text: { type: "plain_text", text: "🎯 BUY WINDOW — Manual Push", emoji: true } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*${title}*\n` +
            `Source: *${src}*${auction}${run}\n` +
            `Price: *${price}* • KM: *${km}* ${where}\n` +
            `Confidence: *${confidence}*\n` +
            (vl.watch_reason ? `_Reason: ${vl.watch_reason}_\n` : "") +
            (note ? `*Note:* ${note}\n` : ""),
        },
      },
    ];

    if (vl.listing_url) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `Link: ${vl.listing_url}` }],
      });
    }

    await postSlack(SLACK_WEBHOOK_URL, { blocks });

    // audit
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("cron_audit_log").upsert(
      {
        cron_name: "send-buy-window-to-slack",
        run_date: today,
        success: true,
        result: { listing_id, sent: true },
      },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
