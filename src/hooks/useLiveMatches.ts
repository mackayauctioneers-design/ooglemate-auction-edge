import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LiveMatch {
  id: string;
  hunt_id: string;
  criteria_version: number;
  source_type: string;
  source: string;
  url: string | null;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  km: number | null;
  price: number | null;
  location: string | null;
  decision: 'BUY' | 'WATCH' | 'UNVERIFIED';
  source_tier: number | null;
  source_class: string | null;
  rank_position: number | null;
  is_cheapest: boolean | null;
  dna_score: number | null;
  listing_intent: string | null;
  listing_intent_reason: string | null;
  series_family: string | null;
  engine_family: string | null;
  body_type: string | null;
  cab_type: string | null;
  badge: string | null;
  verified: boolean | null;
  blocked_reason: string | null;
  created_at: string;
}

interface UseLiveMatchesOptions {
  huntId: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}

interface LiveMatchesResult {
  matches: LiveMatch[];
  totalCount: number;
  cheapestPrice: number | null;
}

export function useLiveMatches({
  huntId,
  limit = 200,
  offset = 0,
  enabled = true,
}: UseLiveMatchesOptions) {
  return useQuery<LiveMatchesResult>({
    queryKey: ['live-matches', huntId, limit, offset],
    queryFn: async () => {
      // Fetch matches using dedicated RPC that only excludes IGNORE
      const { data, error } = await supabase.rpc('rpc_get_live_matches', {
        p_hunt_id: huntId,
        p_limit: limit,
        p_offset: offset,
      });

      if (error) throw error;

      // Get total count
      const { data: countData, error: countError } = await supabase.rpc('rpc_get_live_matches_count', {
        p_hunt_id: huntId,
      });

      if (countError) throw countError;

      const matches: LiveMatch[] = (data || []).map((row: any) => ({
        id: row.id,
        hunt_id: row.hunt_id,
        criteria_version: row.criteria_version,
        source_type: row.source_type,
        source: row.source,
        url: row.url,
        title: row.title,
        year: row.year,
        make: row.make,
        model: row.model,
        variant_raw: row.variant_raw,
        km: row.km,
        price: row.price,
        location: row.location,
        decision: row.decision as 'BUY' | 'WATCH' | 'UNVERIFIED',
        source_tier: row.source_tier,
        source_class: row.source_class,
        rank_position: row.rank_position,
        is_cheapest: row.is_cheapest,
        dna_score: row.dna_score,
        listing_intent: row.listing_intent,
        listing_intent_reason: row.listing_intent_reason,
        series_family: row.series_family,
        engine_family: row.engine_family,
        body_type: row.body_type,
        cab_type: row.cab_type,
        badge: row.badge,
        verified: row.verified,
        blocked_reason: row.blocked_reason,
        created_at: row.created_at,
      }));

      // Calculate cheapest price
      const cheapestPrice = matches.length > 0 
        ? Math.min(...matches.filter(m => m.price != null).map(m => m.price!))
        : null;

      return {
        matches,
        totalCount: countData || 0,
        cheapestPrice: cheapestPrice && isFinite(cheapestPrice) ? cheapestPrice : null,
      };
    },
    enabled: enabled && !!huntId,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}
