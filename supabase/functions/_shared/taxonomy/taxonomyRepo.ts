/**
 * TAXONOMY REPO — DB lookup helpers with in-memory caching
 * 
 * Provides the dependency injection for normalizeVehicleIdentity.
 * Caches taxonomy_models and taxonomy_variant_rank per make (10min TTL).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { TaxonomyDeps } from "./normalizeVehicleIdentity.ts";

type CacheEntry<T> = { data: T; expiresAt: number };

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const modelsCache = new Map<string, CacheEntry<Array<{ canonical_model: string; family_key: string; aliases: string[] }>>>();
const variantCache = new Map<string, CacheEntry<Array<{ canonical_variant: string; aliases: string[]; rank: number }>>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  cache.delete(key);
  return null;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Creates TaxonomyDeps wired to a Supabase client.
 * Pass your service-role client for edge function use.
 */
export function createTaxonomyDeps(sb: ReturnType<typeof createClient>): TaxonomyDeps {
  return {
    async getCanonicalModels(make: string) {
      const key = make.toLowerCase();
      const cached = getCached(modelsCache, key);
      if (cached) return cached;

      const { data, error } = await sb
        .from("taxonomy_models")
        .select("canonical_model, family_key, aliases")
        .ilike("make", key);

      if (error) {
        console.error(`[TAXONOMY] Error fetching models for ${make}:`, error.message);
        return [];
      }

      const result = (data ?? []).map(r => ({
        canonical_model: r.canonical_model as string,
        family_key: r.family_key as string,
        aliases: (r.aliases as string[]) ?? [],
      }));

      setCache(modelsCache, key, result);
      return result;
    },

    async getVariantRanks(make: string, model?: string | null) {
      const key = `${make.toLowerCase()}|${(model ?? "").toLowerCase()}`;
      const cached = getCached(variantCache, key);
      if (cached) return cached;

      let query = sb
        .from("taxonomy_variant_rank")
        .select("canonical_variant, aliases, rank")
        .ilike("make", make.toLowerCase());

      if (model) {
        // Get model-specific + global (model IS NULL) variants
        query = query.or(`model.ilike.${model.toLowerCase()},model.is.null`);
      } else {
        query = query.is("model", null);
      }

      const { data, error } = await query;

      if (error) {
        console.error(`[TAXONOMY] Error fetching variants for ${make}/${model}:`, error.message);
        return [];
      }

      const result = (data ?? []).map(r => ({
        canonical_variant: r.canonical_variant as string,
        aliases: (r.aliases as string[]) ?? [],
        rank: r.rank as number,
      }));

      setCache(variantCache, key, result);
      return result;
    },

    async getDealerTruth(dealerId: string, make: string, familyKey: string) {
      // Query dealer_sales_fingerprints for this dealer + make
      const { data, error } = await sb
        .from("dealer_sales_fingerprints")
        .select("model, variant, count_sold")
        .eq("dealer_id", dealerId)
        .ilike("make", make.toLowerCase())
        .order("count_sold", { ascending: false })
        .limit(20);

      if (error) {
        console.error(`[TAXONOMY] Error fetching dealer truth for ${dealerId}/${make}:`, error.message);
        return [];
      }

      return (data ?? []).map(r => ({
        model: r.model as string,
        variant: (r.variant as string) ?? null,
        count_sold: r.count_sold as number,
      }));
    },
  };
}
