// Invite a dealer user to log in to a specific account's Trading Desk.
// Operator-only. Records a dealer_invites row, ensures the user exists, and
// ALWAYS returns a usable magic-link action_link so the operator can deliver
// it manually if email delivery is unreliable.

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
    const origin = req.headers.get("origin") || "";
    const redirect_to = body.redirect_to || `${origin}/trading-desk`;

    if (!email || !account_id) {
      return new Response(JSON.stringify({ error: "email and account_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record the invite (best-effort)
    await admin.from("dealer_invites").insert({
      email, account_id, dealer_name,
      invited_by: userData.user.id, status: "pending",
    } as any).then(() => {}, () => {});

    // Check if user already exists by trying to list by email
    let userExists = false;
    try {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      userExists = !!list?.users?.find((u: any) => (u.email || "").toLowerCase() === email);
    } catch (_) {}

    let emailSent = false;
    let emailError: string | null = null;

    if (!userExists) {
      // Try to invite (creates user + sends invite email via default Supabase email)
      const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: redirect_to,
        data: { account_id, dealer_name },
      });
      if (inviteErr) {
        emailError = inviteErr.message;
        // Create the user manually so we can still produce a magic link
        await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { account_id, dealer_name },
        }).then(() => {}, () => {});
      } else {
        emailSent = true;
      }
    }

    // ALWAYS generate a magic-link action_link as a fallback / primary deliverable
    let action_link: string | null = null;
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: redirect_to },
    });
    if (!linkErr) {
      action_link = link?.properties?.action_link ?? null;
    } else if (!emailError) {
      emailError = linkErr.message;
    }

    return new Response(JSON.stringify({
      success: true,
      mode: emailSent ? "invite" : "magiclink",
      email_sent: emailSent,
      action_link,
      email_error: emailError,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
