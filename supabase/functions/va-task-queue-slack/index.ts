import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TaskRow = {
  id: string;
  listing_uuid: string;
  priority: "high" | "normal";
  due_at: string | null;
  note: string | null;
  watch_reason: string | null;
  watch_confidence: string | null;
  attempt_count: number | null;
  listing_url: string | null;
};

type ListingMini = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_used: string | null;
  km: number | null;
  source: string | null;
  attempt_stage: string | null;
  asking_price: number | null;
  location: string | null;
};

function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}
function safe(v: string | null | undefined) {
  return (v ?? "—").toString();
}
function prettySource(src: string | null | undefined) {
  if (!src) return "—";
  return src.replace(/^trap_/, "").replace(/_/g, " ");
}
function priorityEmoji(p: string) {
  return p === "high" ? "🔥" : "•";
}
function confidenceEmoji(c: string | null) {
  const x = (c || "").toLowerCase();
  if (x === "high") return "🟢";
  if (x === "med" || x === "medium") return "🟠";
  if (x === "low") return "🟡";
  return "⚪";
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
    const today = new Date().toISOString().slice(0, 10);

    // Pull VA To Do tasks (top 12)
    const { data: tasksData, error: tErr } = await supabase
      .from("va_tasks")
      .select("id, listing_uuid, priority, due_at, note, watch_reason, watch_confidence, attempt_count, listing_url")
      .eq("status", "todo")
      .order("priority", { ascending: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(12);

    if (tErr) throw tErr;

    const tasks = (tasksData as TaskRow[]) || [];
    if (tasks.length === 0) {
      await postSlack(SLACK_WEBHOOK_URL, [
        { type: "header", text: { type: "plain_text", text: `✅ VA Task Queue (${today})`, emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: "No VA tasks in *To Do* right now." } },
      ]);

      await supabase.from("cron_audit_log").upsert(
        { cron_name: "va-task-queue-slack", run_date: today, success: true, result: { sent: true, count: 0 } },
        { onConflict: "cron_name,run_date" }
      );

      return new Response(JSON.stringify({ success: true, sent: true, count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch linked listings in one hit
    const listingIds = [...new Set(tasks.map((t) => t.listing_uuid))];
    const { data: listingsData } = await supabase
      .from("vehicle_listings")
      .select("id, year, make, model, variant_used, km, source, attempt_stage, asking_price, location")
      .in("id", listingIds);

    const listingMap = new Map<string, ListingMini>();
    (listingsData as ListingMini[] | null)?.forEach((l) => listingMap.set(l.id, l));

    const blocks: any[] = [
      { type: "header", text: { type: "plain_text", text: `📋 VA Task Queue — To Do (${today})`, emoji: true } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Top *${tasks.length}* tasks. Work top to bottom. Update status in */va/tasks* when done.`,
        },
      },
      { type: "divider" },
    ];

    tasks.forEach((t, idx) => {
      const l = listingMap.get(t.listing_uuid) || null;
      const title =
        l
          ? `${l.year ?? "—"} ${safe(l.make)} ${safe(l.model)}${l.variant_used ? ` (${l.variant_used})` : ""}`
          : `Listing ${t.listing_uuid}`;

      const src = l ? prettySource(l.source) : "—";
      const run = l?.attempt_stage ? ` • ${l.attempt_stage}` : "";
      const price = l ? fmtMoney(l.asking_price) : "—";
      const km = l ? fmtNum(l.km) : "—";
      const loc = l?.location ? ` • ${l.location}` : "";

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*${idx + 1}.* ${priorityEmoji(t.priority)} ${confidenceEmoji(t.watch_confidence)} *${title}*\n` +
            `Source: *${src}*${run}\n` +
            `Price: *${price}* • KM: *${km}*${loc}\n` +
            (t.watch_reason ? `_Reason: ${t.watch_reason}_\n` : "") +
            (t.note ? `*Task:* ${t.note}\n` : ""),
        },
      });

      if (t.listing_url) {
        blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Link: ${t.listing_url}` }] });
      }

      blocks.push({ type: "divider" });
    });

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `Open queue: */va/tasks* (Start → Done/Blocked).` },
    });

    await postSlack(SLACK_WEBHOOK_URL, blocks);

    await supabase.from("cron_audit_log").upsert(
      { cron_name: "va-task-queue-slack", run_date: today, success: true, result: { sent: true, count: tasks.length } },
      { onConflict: "cron_name,run_date" }
    );

    return new Response(JSON.stringify({ success: true, sent: true, count: tasks.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const today = new Date().toISOString().slice(0, 10);

    try {
      const supabase2 = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await supabase2.from("cron_audit_log").upsert(
        { cron_name: "va-task-queue-slack", run_date: today, success: false, error: msg },
        { onConflict: "cron_name,run_date" }
      );
    } catch {}

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
