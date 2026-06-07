// supabase/functions/wholesale-decide/index.ts
// Approves/rejects a wholesale_manager_queue row.
//
// POST /functions/v1/wholesale-decide
//   body: { queue_id: string, decision: "approved" | "rejected", dealer_slug?: string, note?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const queueId = body.queue_id as string | undefined;
    const decision = body.decision as string | undefined;
    const dealerSlug = body.dealer_slug as string | undefined;
    const note = body.note as string | undefined;

    if (!queueId || !decision || !["approved", "rejected"].includes(decision)) {
      return new Response(
        JSON.stringify({ error: "queue_id and decision ('approved'|'rejected') required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const update: Record<string, unknown> = {
      status: decision,
      decided_at: new Date().toISOString(),
    };
    if (note) update.decision_note = note;

    let q = supabase.from("wholesale_manager_queue").update(update).eq("id", queueId);
    if (dealerSlug) q = q.eq("dealer_id", dealerSlug);

    const { data, error } = await q.select("id, status, decided_at").maybeSingle();
    if (error) {
      console.error("decide error", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!data) {
      return new Response(
        JSON.stringify({ error: "queue row not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, item: data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
