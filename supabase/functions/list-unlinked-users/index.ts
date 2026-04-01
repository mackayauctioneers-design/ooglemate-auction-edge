import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get already linked user IDs
    const { data: links } = await supabaseAdmin
      .from("dealer_profile_user_links")
      .select("user_id");
    const linkedIds = new Set(links?.map((l: any) => l.user_id) || []);

    // List all auth users
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 500 });
    if (error) throw error;

    const unlinked = (users || [])
      .filter(u => !linkedIds.has(u.id))
      .map(u => ({ user_id: u.id, email: u.email || u.id.slice(0, 8) }));

    return new Response(JSON.stringify(unlinked), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
