/**
 * Internal DB Adapter
 *
 * Searches vehicle_listings table directly.
 * This is the "free tier" adapter — no external calls.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  OutwardSearchAdapter,
  ParsedIntent,
  AdapterResult,
} from "../types.ts";
import {
  AUCTION_SOURCES,
  AUCTION_PREMIUM,
  FREIGHT_FLAT,
  EXCLUDED_LIFECYCLE,
} from "../types.ts";

const normalizeToken = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export class InternalDbAdapter implements OutwardSearchAdapter {
  readonly sourceKey = "internal_db";

  async search(
    intent: ParsedIntent,
    _config: Record<string, unknown>,
    _abortSignal?: AbortSignal,
  ): Promise<AdapterResult[]> {
    if (!intent.make) return [];

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = sb
      .from("vehicle_listings")
      .select(`
        id, listing_id, source, source_class, make, model,
        variant_raw, variant_family, variant_used, year, km,
        asking_price, location, state, listing_url,
        auction_house, lifecycle_state, fingerprint,
        first_seen_at, is_dealer_grade, drivetrain, fuel, transmission
      `)
      .ilike("make", `%${intent.make}%`)
      .not("lifecycle_state", "in", `(${EXCLUDED_LIFECYCLE.map(s => `"${s}"`).join(",")})`)
      .order("asking_price", { ascending: true, nullsFirst: false })
      .limit(200);

    if (intent.model) {
      const modelCore = intent.model.split(/\s+/)[0];
      query = query.ilike("model", `%${modelCore}%`);
    }
    if (intent.year_min) query = query.gte("year", intent.year_min);
    if (intent.year_max) query = query.lte("year", intent.year_max);
    if (intent.max_km) query = query.lte("km", intent.max_km);
    if (intent.price_max) query = query.lte("asking_price", intent.price_max);

    const { data: listings, error } = await query;
    if (error) {
      console.error("InternalDbAdapter query error:", error);
      throw new Error(error.message);
    }

    let filtered = listings || [];

    // Badge/variant filtering
    if (intent.badge) {
      const badgeUpper = intent.badge.toUpperCase();
      filtered = filtered.filter((l: any) => {
        const variants = [l.variant_raw, l.variant_family, l.variant_used]
          .filter(Boolean)
          .map((v: string) => String(v).toUpperCase());
        if (variants.length === 0) return false;

        const normalizedVariants = variants.map(normalizeToken);
        const normalizedBadge = normalizeToken(badgeUpper);
        const badgeTokens = badgeUpper.split(/[\s-]+/).filter(Boolean).map(normalizeToken);

        if (normalizedBadge && normalizedVariants.some(v => v.includes(normalizedBadge))) return true;
        return badgeTokens.every(token => normalizedVariants.some(v => v.includes(token)));
      });
    }

    // Score and transform
    return filtered.map((l: any) => {
      const askPrice = l.asking_price ?? null;
      const isAuction = AUCTION_SOURCES.has((l.source || "").toLowerCase());
      const effectiveCost = askPrice != null
        ? askPrice + (isAuction ? AUCTION_PREMIUM : 0) + FREIGHT_FLAT
        : null;

      let score = 50;
      const reasons: string[] = [];

      if ((l.make || "").toUpperCase() === intent.make!.toUpperCase()) {
        score += 5; reasons.push("EXACT_MAKE");
      }
      if (intent.badge) {
        const nb = normalizeToken(intent.badge);
        const nv = [l.variant_raw, l.variant_family, l.variant_used]
          .filter(Boolean).map((v: string) => normalizeToken(String(v)));
        if (nv.some(v => v === nb)) { score += 10; reasons.push("EXACT_BADGE"); }
        else if (nv.some(v => v.includes(nb))) { score += 5; reasons.push("BADGE_PARTIAL"); }
      }
      if (intent.year_min && l.year >= intent.year_min) { score += 5; reasons.push("YEAR_IN_RANGE"); }
      if (l.km && l.km < 30000) { score += 10; reasons.push("LOW_KM"); }
      else if (l.km && l.km < 60000) { score += 5; reasons.push("MODERATE_KM"); }
      if (l.is_dealer_grade) { score += 5; reasons.push("DEALER_GRADE"); }
      if (intent.price_max && effectiveCost != null && effectiveCost < intent.price_max * 0.85) {
        score += 10; reasons.push("PRICE_WELL_UNDER_BUDGET");
      }
      const daysListed = l.first_seen_at
        ? Math.floor((Date.now() - new Date(l.first_seen_at).getTime()) / 86400000)
        : null;
      if (daysListed !== null && daysListed <= 3) { score += 5; reasons.push("FRESH_LISTING"); }

      return {
        source: l.source,
        title: `${l.year || ""} ${l.make || ""} ${l.model || ""} ${l.variant_used || l.variant_family || l.variant_raw || ""}`.trim(),
        year: l.year,
        km: l.km,
        price: askPrice,
        effective_cost: effectiveCost,
        location: l.location,
        state: l.state,
        variant: l.variant_used || l.variant_family || l.variant_raw || null,
        url: l.listing_url,
        score: Math.min(score, 100),
        match_reason: reasons,
        source_class: l.source_class,
        auction_house: l.auction_house,
        drivetrain: l.drivetrain,
        fuel: l.fuel,
        transmission: l.transmission,
        days_listed: daysListed,
        is_dealer_grade: l.is_dealer_grade,
      };
    });
  }
}
