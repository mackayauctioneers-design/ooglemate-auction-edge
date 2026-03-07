/**
 * Internal DB Adapter
 *
 * Searches vehicle_listings table directly.
 * Phase 1 adapter — always runs, no quota cost.
 *
 * Badge matching uses STRICT canonical comparison:
 * - Exact match on variant_family (canonical resolved field)
 * - Token-boundary-safe matching on variant_raw/variant_used
 * - NO substring .includes() — prevents SR matching SR5, GX matching GXL
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
import { extractSeries } from "../../taxonomy/derivePlatform.ts";

/**
 * Strict token-boundary badge match.
 * "SR5" matches "SR5", "SR5+" but NOT "SR" or "SR50".
 * "GX" matches "GX" but NOT "GXL".
 * Uses word-boundary regex to prevent substring bleed.
 */
function badgeMatchesVariant(badge: string, variant: string): "exact" | "token" | false {
  const b = badge.toUpperCase().trim();
  const v = variant.toUpperCase().trim();

  // Exact match on full string
  if (v === b) return "exact";

  // Token-boundary match: badge appears as a whole token in variant
  // \b doesn't work well with alphanumeric boundaries, so we use explicit separators
  const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenRegex = new RegExp(`(?:^|[\\s\\-\\/,()]+)${escaped}(?:[\\s\\-\\/,()]+|\\+|$)`, "i");
  if (tokenRegex.test(v)) return "token";

  // Also match if variant starts with badge followed by non-alphanumeric
  // e.g. "SR5+" matches "SR5", but "SR50" does not
  const startRegex = new RegExp(`^${escaped}(?:[^A-Z0-9]|$)`, "i");
  if (startRegex.test(v)) return "token";

  return false;
}

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
      query = query.ilike("model", `%${intent.model}%`);
      // Exclude Prado when searching for LandCruiser (not Prado)
      const modelLower = intent.model.toLowerCase();
      if (intent.make?.toLowerCase() === "toyota" && modelLower.includes("landcruiser") && !modelLower.includes("prado")) {
        query = query.not("model", "ilike", "%prado%");
      }
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

    // ── Series / generation gate ──────────────────────────────────
    // If intent specifies a series (e.g. LC300), reject comps from other generations.
    // This prevents LC70 contaminating LC300 valuations.
    if (intent.series) {
      filtered = filtered.filter((l: any) => {
        const compSeries = extractSeries(l.make || "", l.model || "");
        // If comp has a detectable series, it must match. If no series detected, allow through
        // (could be generic "LandCruiser GXL" without series — let scoring handle it)
        if (compSeries && compSeries !== intent.series) return false;
        return true;
      });
    }

    // Badge/variant filtering — STRICT, no substring matching
    if (intent.badge) {
      filtered = filtered.filter((l: any) => {
        // Priority 1: Exact match on canonical variant_family
        if (l.variant_family && l.variant_family.toUpperCase() === intent.badge!.toUpperCase()) {
          return true;
        }

        // Priority 2: Token-boundary match on variant fields
        const variants = [l.variant_raw, l.variant_family, l.variant_used]
          .filter(Boolean)
          .map((v: string) => String(v));

        return variants.some(v => badgeMatchesVariant(intent.badge!, v) !== false);
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

      // Badge scoring — strict
      if (intent.badge) {
        if (l.variant_family && l.variant_family.toUpperCase() === intent.badge.toUpperCase()) {
          score += 10; reasons.push("EXACT_BADGE_CANONICAL");
        } else {
          const variants = [l.variant_raw, l.variant_used].filter(Boolean).map((v: string) => String(v));
          const bestMatch = variants.reduce<"exact" | "token" | false>((best, v) => {
            const m = badgeMatchesVariant(intent.badge!, v);
            if (m === "exact") return "exact";
            if (m === "token" && best !== "exact") return "token";
            return best;
          }, false);
          if (bestMatch === "exact") { score += 8; reasons.push("EXACT_BADGE_RAW"); }
          else if (bestMatch === "token") { score += 4; reasons.push("BADGE_TOKEN_MATCH"); }
        }
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
