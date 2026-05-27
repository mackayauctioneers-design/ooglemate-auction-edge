// Invite a dealer user to log in to a specific account's Trading Desk.
// Operator-only. Uses service role to send Supabase auth invite email and
// records a row in dealer_invites so signup auto-creates the dealer_profile.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id, _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const account_id = String(body.account_id || "").trim();
    const dealer_name = body.dealer_name ? String(body.dealer_name).trim() : null;
    const redirect_to = body.redirect_to || `${req.headers.get("origin") || ""}/trading-desk`;

    if (!email || !account_id) {
      return new Response(JSON.stringify({ error: "email and account_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record the invite first (idempotent: refresh existing pending row)
    await admin.from("dealer_invites").upsert({
      email, account_id, dealer_name,
      invited_by: userData.user.id, status: "pending",
    } as any, { onConflict: "email" }).then(() => {}, () => {});
    // Fallback insert if upsert not supported
    await admin.from("dealer_invites").insert({
      email, account_id, dealer_name,
      invited_by: userData.user.id, status: "pending",
    } as any).then(() => {}, () => {});

    // Send Supabase auth invite (creates user if not exists, emails magic link)
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirect_to,
      data: { account_id, dealer_name },
    });

    if (inviteErr) {
      // If user already exists, send a magic link instead
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: redirect_to },
      });
      if (linkErr) {
        return new Response(JSON.stringify({ error: inviteErr.message, fallback: linkErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, mode: "magiclink", action_link: link?.properties?.action_link }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, mode: "invite", user_id: invited?.user?.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
