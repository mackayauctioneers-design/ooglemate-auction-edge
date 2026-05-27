// Invite a dealer user to log in to a specific account's Trading Desk.
// Operator-only. Creates/updates a confirmed email+password login, links the
// user to the selected dealer account, and returns temporary credentials.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const makeTemporaryPassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
};

const findUserByEmail = async (admin: any, email: string) => {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data?.users?.find((u: any) => (u.email || "").toLowerCase() === email);
    if (found) return found;
    if (!data?.users || data.users.length < 1000) break;
  }
  return null;
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
    const login_url = body.login_url || `${origin}/auth`;
    const temporary_password = makeTemporaryPassword();

    if (!email || !account_id) {
      return new Response(JSON.stringify({ error: "email and account_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: account, error: accountErr } = await admin
      .from("accounts")
      .select("id, display_name")
      .eq("id", account_id)
      .maybeSingle();
    if (accountErr || !account) {
      return new Response(JSON.stringify({ error: "Dealer account not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingUser = await findUserByEmail(admin, email);
    let authUserId = existingUser?.id as string | undefined;
    const user_metadata = { account_id, dealer_name: dealer_name || account.display_name || email };

    if (authUserId) {
      const { error: updateErr } = await admin.auth.admin.updateUserById(authUserId, {
        password: temporary_password,
        email_confirm: true,
        user_metadata,
      });
      if (updateErr) throw updateErr;
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: temporary_password,
        email_confirm: true,
        user_metadata,
      });
      if (createErr) throw createErr;
      authUserId = created.user?.id;
    }

    if (!authUserId) throw new Error("Could not create dealer login");

    let { data: dealerProfile, error: profileLookupErr } = await admin
      .from("dealer_profiles")
      .select("id, user_id")
      .eq("account_id", account_id)
      .limit(1)
      .maybeSingle();
    if (profileLookupErr) throw profileLookupErr;

    if (!dealerProfile) {
      const { data: insertedProfile, error: insertProfileErr } = await admin
        .from("dealer_profiles")
        .insert({
          user_id: authUserId,
          account_id,
          dealer_name: dealer_name || account.display_name || email,
          dealer_email: email,
        } as any)
        .select("id, user_id")
        .single();
      if (insertProfileErr) throw insertProfileErr;
      dealerProfile = insertedProfile;
    } else {
      const profilePatch: Record<string, unknown> = { dealer_email: email };
      if (dealer_name) profilePatch.dealer_name = dealer_name;
      if (!dealerProfile.user_id || dealerProfile.user_id === authUserId) profilePatch.user_id = authUserId;
      await admin.from("dealer_profiles").update(profilePatch as any).eq("id", dealerProfile.id);
    }

    await admin.from("dealer_profile_user_links").delete().eq("user_id", authUserId);
    const { error: linkErr } = await admin
      .from("dealer_profile_user_links")
      .upsert({ dealer_profile_id: dealerProfile.id, user_id: authUserId, linked_by: "operator-password-invite" } as any, {
        onConflict: "dealer_profile_id",
      });
    if (linkErr) throw linkErr;

    const { data: roles, error: rolesErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", authUserId);
    if (rolesErr) throw rolesErr;
    if (!roles?.length) {
      const { error: roleErr } = await admin.from("user_roles").insert({ user_id: authUserId, role: "dealer" } as any);
      if (roleErr) throw roleErr;
    }

    await admin.from("dealer_invites").insert({
      email, account_id, dealer_name: dealer_name || account.display_name,
      invited_by: userData.user.id, status: "ready", consumed_user_id: authUserId,
    } as any).then(() => {}, () => {});

    return new Response(JSON.stringify({
      success: true,
      mode: "password",
      email,
      temporary_password,
      login_url,
      trading_desk_url: `${origin}/trading-desk`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
