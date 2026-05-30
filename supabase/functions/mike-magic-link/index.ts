// Generates a one-time magic link for Mike's read-only Westside dashboard.
// Operator-only: caller must be an authenticated admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MIKE_EMAIL = "mike.simmons@westsideauto.com.au";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is an admin operator
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const isAdmin = (roles || []).some((r: any) => r.role === "admin" || r.role === "operator");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Ensure auth user exists for Mike
    const { data: existing } = await admin.auth.admin.listUsers();
    let mikeUser = existing?.users?.find((u: any) => u.email?.toLowerCase() === MIKE_EMAIL);
    if (!mikeUser) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: MIKE_EMAIL,
        email_confirm: true,
        user_metadata: { display_name: "Mike Simmons", company: "Westside Auto" },
      });
      if (createErr) throw createErr;
      mikeUser = created.user;
    }

    // Determine app origin for the redirect
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const origin =
      body.origin ||
      req.headers.get("origin") ||
      "https://www.carbitrage.com.au";

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: MIKE_EMAIL,
      options: { redirectTo: `${origin}/westside` },
    });
    if (linkErr) throw linkErr;

    return new Response(
      JSON.stringify({
        email: MIKE_EMAIL,
        magic_link: link.properties?.action_link,
        expires_at: link.properties?.email_otp ? null : undefined,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
