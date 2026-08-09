import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLACK_CHANNEL = "C0AEQU68HHC"; // #carbitrage-messages

interface ApprovalRecord {
  id: string;
  make: string;
  model: string;
  variant?: string | null;
  year?: number | null;
  km?: number | null;
  price?: number | null;
  source?: string | null;
  source_url?: string | null;
  requested_by?: string | null;
  fingerprint_id?: string | null;
  fingerprint_name?: string | null;
  match_score?: number | null;
  expected_margin?: number | null;
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtKm(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

function buildSlackBlocks(record: ApprovalRecord): unknown[] {
  const vehicle = [record.year, record.make, record.model, record.variant]
    .filter(Boolean)
    .join(" ");

  const fields = [
    { type: "mrkdwn", text: `*Make/Model:*\n${record.make} ${record.model}${record.variant ? ` ${record.variant}` : ""}` },
    { type: "mrkdwn", text: `*Year:*\n${record.year ?? "—"}` },
    { type: "mrkdwn", text: `*KMs:*\n${fmtKm(record.km)}` },
    { type: "mrkdwn", text: `*Price:*\n${fmtMoney(record.price)}` },
    { type: "mrkdwn", text: `*Source:*\n${record.source ?? "—"}` },
    { type: "mrkdwn", text: `*Requested by:*\n${record.requested_by ?? "—"}` },
  ];

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "\u{1F697} Stock Approval Required", emoji: true },
    },
    {
      type: "section",
      fields,
    },
  ];

  // Fingerprint context if available
  if (record.match_score !== null && record.match_score !== undefined) {
    const parts: string[] = [];
    if (record.expected_margin !== null && record.expected_margin !== undefined) {
      parts.push(`*Expected margin:* ${fmtMoney(record.expected_margin)}`);
    }
    parts.push(`*Match score:* ${record.match_score}%`);
    if (record.fingerprint_name) {
      parts.push(`*Fingerprint:* ${record.fingerprint_name}`);
    }
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: parts.join(" | ") },
    });
  }

  // Source URL link
  if (record.source_url) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `<${record.source_url}|View listing>` },
    });
  }

  // Approve / Reject buttons
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "\u2705 Approve", emoji: true },
        style: "primary",
        action_id: "stock_approve",
        value: record.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "\u274C Reject", emoji: true },
        style: "danger",
        action_id: "stock_reject",
        value: record.id,
      },
    ],
  });

  return blocks;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const slackToken = Deno.env.get("SLACK_BOT_TOKEN");

    if (!slackToken) {
      return new Response(
        JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    // Handle both direct POST and Supabase webhook payload formats
    const record: ApprovalRecord = body.record ?? body;

    if (!record.id || !record.make || !record.model) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: id, make, model" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build and send Slack message
    const vehicle = [record.year, record.make, record.model, record.variant]
      .filter(Boolean)
      .join(" ");
    const priceText = record.price ? ` — ${fmtMoney(record.price)}` : "";
    const blocks = buildSlackBlocks(record);

    const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackToken}`,
      },
      body: JSON.stringify({
        channel: SLACK_CHANNEL,
        text: `\u{1F697} New stock approval: ${vehicle}${priceText}`,
        blocks,
      }),
    });

    const slackData = await slackRes.json();

    if (!slackData.ok) {
      throw new Error(`Slack API error: ${slackData.error}`);
    }

    console.log(`[stock-approval-notify] Sent approval request for ${vehicle} (${record.id})`);

    // Update the stock_approvals row with Slack message tracking
    const { error: updateError } = await supabase
      .from("stock_approvals")
      .update({
        slack_message_ts: slackData.ts,
        slack_channel_id: slackData.channel,
      })
      .eq("id", record.id);

    if (updateError) {
      console.error(`[stock-approval-notify] Failed to update slack tracking: ${updateError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        approval_id: record.id,
        slack_ts: slackData.ts,
        slack_channel: slackData.channel,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[stock-approval-notify] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
