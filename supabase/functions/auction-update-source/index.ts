import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Body = {
  source_key: string;
  list_url?: string | null;
  parser_profile?: string | null;
  enabled?: boolean | null;
  notes?: string | null;
};

async function isAdmin(supabase: ReturnType<typeof createClient>, token: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !auth?.user) return false;

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.user.id)
    .single();

  const role = (roleRow as { role: string } | null)?.role;
  return role && ["admin", "internal"].includes(role);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing Authorization token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ok = await isAdmin(supabase as ReturnType<typeof createClient>, token);
    if (!ok) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.source_key) {
      return new Response(JSON.stringify({ error: "source_key is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.list_url !== undefined) patch.list_url = body.list_url;
    if (body.parser_profile !== undefined) patch.parser_profile = body.parser_profile;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.notes !== undefined) patch.notes = body.notes;

    const { data, error } = await supabase
      .from("auction_sources")
      .update(patch)
      .eq("source_key", body.source_key)
      .select("source_key,list_url,parser_profile,enabled,notes,preflight_status,validation_status")
      .single();

    if (error) throw error;

    // Log the update event
    await supabase.from("auction_source_events").insert({
      source_key: body.source_key,
      event_type: "config_updated",
      message: `Updated config: ${Object.keys(patch).filter(k => k !== 'updated_at').join(', ')}`,
      meta: patch,
    });

    return new Response(JSON.stringify({ success: true, updated: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
