/**
 * Quota & Entitlement Engine
 *
 * Checks dealer entitlements, enforces daily limits,
 * filters sources by tier access, handles cooldowns.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  DealerEntitlement,
  SourceRegistryEntry,
  QuotaCheckResult,
} from "./types.ts";

export async function checkQuota(
  accountId: string | null,
  initiatedBy: string,
): Promise<QuotaCheckResult> {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Operator/cron bypass — no quota limits
  if (initiatedBy === "operator" || initiatedBy === "cron") {
    const { data: sources } = await sb
      .from("source_registry")
      .select("*")
      .eq("enabled", true);

    return {
      allowed: true,
      entitlement: null,
      eligible_sources: (sources || []) as unknown as SourceRegistryEntry[],
    };
  }

  if (!accountId) {
    // Anonymous — internal DB only
    const { data: sources } = await sb
      .from("source_registry")
      .select("*")
      .eq("enabled", true)
      .eq("tier", "free");

    return {
      allowed: true,
      entitlement: null,
      eligible_sources: (sources || []) as unknown as SourceRegistryEntry[],
    };
  }

  // Fetch entitlement
  const { data: ent } = await sb
    .from("dealer_entitlements")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();

  // Auto-reset if past reset time
  if (ent && new Date(ent.searches_reset_at) <= new Date()) {
    await sb
      .from("dealer_entitlements")
      .update({
        searches_used_today: 0,
        searches_reset_at: new Date(Date.now() + 86400000).toISOString(),
      })
      .eq("id", ent.id);
    ent.searches_used_today = 0;
  }

  // Default entitlement if none exists
  const entitlement: DealerEntitlement = ent
    ? {
        account_id: ent.account_id,
        plan_tier: ent.plan_tier,
        max_searches_per_day: ent.max_searches_per_day,
        max_sources_per_search: ent.max_sources_per_search,
        allowed_source_tiers: ent.allowed_source_tiers,
        searches_used_today: ent.searches_used_today,
        searches_reset_at: ent.searches_reset_at,
        is_active: ent.is_active,
      }
    : {
        account_id: accountId,
        plan_tier: "free",
        max_searches_per_day: 5,
        max_sources_per_search: 3,
        allowed_source_tiers: ["free"],
        searches_used_today: 0,
        searches_reset_at: new Date(Date.now() + 86400000).toISOString(),
        is_active: true,
      };

  // Check quota
  if (!entitlement.is_active) {
    return { allowed: false, reason: "Account entitlement is inactive", entitlement, eligible_sources: [] };
  }
  if (entitlement.searches_used_today >= entitlement.max_searches_per_day) {
    return {
      allowed: false,
      reason: `Daily limit reached (${entitlement.searches_used_today}/${entitlement.max_searches_per_day})`,
      entitlement,
      eligible_sources: [],
    };
  }

  // Fetch eligible sources (by tier + enabled + not in cooldown)
  const { data: sources } = await sb
    .from("source_registry")
    .select("*")
    .eq("enabled", true)
    .in("tier", entitlement.allowed_source_tiers);

  // Filter by cooldown
  const now = Date.now();
  const eligible = (sources || []).filter((s: any) => {
    if (!s.last_success_at || !s.cooldown_minutes) return true;
    const cooldownEnd = new Date(s.last_success_at).getTime() + s.cooldown_minutes * 60000;
    return now >= cooldownEnd;
  });

  return {
    allowed: true,
    entitlement,
    eligible_sources: eligible.slice(0, entitlement.max_sources_per_search) as unknown as SourceRegistryEntry[],
  };
}

export async function incrementUsage(accountId: string): Promise<void> {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Upsert: increment or create
  const { data: existing } = await sb
    .from("dealer_entitlements")
    .select("id, searches_used_today")
    .eq("account_id", accountId)
    .maybeSingle();

  if (existing) {
    await sb
      .from("dealer_entitlements")
      .update({ searches_used_today: (existing.searches_used_today || 0) + 1 })
      .eq("id", existing.id);
  } else {
    await sb.from("dealer_entitlements").insert({
      account_id: accountId,
      searches_used_today: 1,
    });
  }
}
