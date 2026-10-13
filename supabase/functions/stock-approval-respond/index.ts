import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const slackToken = Deno.env.get("SLACK_BOT_TOKEN");

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const { approval_id, action, note, decided_by } = body as {
      approval_id: string;
      action: "approve" | "reject";
      note?: string;
      decided_by?: string;
    };

    if (!approval_id || !action) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: approval_id, action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action !== "approve" && action !== "reject") {
      return new Response(
        JSON.stringify({ error: "action must be 'approve' or 'reject'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const status = action === "approve" ? "approved" : "rejected";

    // Update the approval record
    const { data: updated, error: updateError } = await supabase
      .from("stock_approvals")
      .update({
        status,
        decided_at: new Date().toISOString(),
        decision_by: decided_by ?? null,
        decision_note: note ?? null,
      })
      .eq("id", approval_id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update approval: ${updateError.message}`);
    }

    if (!updated) {
      return new Response(
        JSON.stringify({ error: "Approval record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[stock-approval-respond] ${status} approval ${approval_id}`);

    // Update the original Slack message if we have tracking info and a token
    if (slackToken && updated.slack_message_ts && updated.slack_channel_id) {
      const vehicle = [updated.year, updated.make, updated.model, updated.variant]
        .filter(Boolean)
        .join(" ");

      const statusEmoji = status === "approved" ? "\u2705" : "\u274C";
      const statusText = status === "approved" ? "APPROVED" : "REJECTED";
      const noteText = note ? `\n_Note: ${note}_` : "";
      const byText = decided_by ? ` by ${decided_by}` : "";

      const blocks = [
        {
          type: "header",
          text: { type: "plain_text", text: `${statusEmoji} Stock ${statusText}`, emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Vehicle:*\n${vehicle}` },
            { type: "mrkdwn", text: `*Price:*\n${fmtMoney(updated.price)}` },
            { type: "mrkdwn", text: `*Source:*\n${updated.source ?? "—"}` },
            { type: "mrkdwn", text: `*Decision:*\n${statusText}${byText}` },
          ],
        },
      ];

      if (noteText) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*Note:* ${note}` },
        } as any);
      }

      const slackRes = await fetch("https://slack.com/api/chat.update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${slackToken}`,
        },
        body: JSON.stringify({
          channel: updated.slack_channel_id,
          ts: updated.slack_message_ts,
          text: `${statusEmoji} ${vehicle} — ${statusText}${byText}`,
          blocks,
        }),
      });

      const slackData = await slackRes.json();
      if (!slackData.ok) {
        console.error(`[stock-approval-respond] Slack update failed: ${slackData.error}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, record: updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[stock-approval-respond] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
