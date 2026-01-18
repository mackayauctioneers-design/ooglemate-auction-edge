import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { UnifiedCandidate } from "@/types/hunts";

interface UseUnifiedCandidatesOptions {
  huntId: string;
  limit?: number;
  offset?: number;
  decisionFilter?: 'BUY' | 'WATCH' | 'UNVERIFIED' | null;
  sourceFilter?: 'outward' | 'internal' | null;
  excludeIgnore?: boolean; // NEW: Exclude IGNORE by default for LIVE MATCHES
  enabled?: boolean;
  staleTime?: number;
  refetchOnMount?: boolean | 'always';
}

interface UnifiedCandidatesResult {
  candidates: UnifiedCandidate[];
  totalCount: number;
  cheapestPrice: number | null;
}

interface CandidateCounts {
  total: number;
  buy: number;
  watch: number;
  unverified: number;
  ignore: number;
  live_matches: number;
  opportunities: number;
  by_tier: {
    auction: number;
    marketplace: number;
    dealer: number;
  };
}

export function useUnifiedCandidates({
  huntId,
  limit = 100, // Increased default for LIVE MATCHES
  offset = 0,
  decisionFilter = null,
  sourceFilter = null,
  excludeIgnore = true, // Default: exclude IGNORE for LIVE MATCHES
  enabled = true,
  staleTime = 0,
  refetchOnMount = 'always',
}: UseUnifiedCandidatesOptions) {
  return useQuery<UnifiedCandidatesResult>({
    queryKey: ['unified-candidates', huntId, limit, offset, decisionFilter, sourceFilter, excludeIgnore],
    queryFn: async () => {
      // Fetch candidates using the RPC with new excludeIgnore parameter
      const { data, error } = await supabase.rpc('rpc_get_unified_candidates', {
        p_hunt_id: huntId,
        p_limit: limit,
        p_offset: offset,
        p_decision_filter: decisionFilter,
        p_source_filter: sourceFilter,
        p_exclude_ignore: excludeIgnore,
      });

      if (error) throw error;

      // Get total count based on filters
      let countQuery = supabase
        .from('hunt_unified_candidates')
        .select('*', { count: 'exact', head: true })
        .eq('hunt_id', huntId);

      if (decisionFilter) {
        countQuery = countQuery.eq('decision', decisionFilter);
      } else if (excludeIgnore) {
        countQuery = countQuery.neq('decision', 'IGNORE');
      }
      if (sourceFilter) {
        countQuery = countQuery.eq('source_type', sourceFilter);
      }

      const { count, error: countError } = await countQuery;
      if (countError) throw countError;

      // Get cheapest price (for the filtered set)
      let cheapestQuery = supabase
        .from('hunt_unified_candidates')
        .select('price')
        .eq('hunt_id', huntId)
        .not('price', 'is', null)
        .order('price', { ascending: true })
        .limit(1);

      if (excludeIgnore) {
        cheapestQuery = cheapestQuery.neq('decision', 'IGNORE');
      }
      if (sourceFilter) {
        cheapestQuery = cheapestQuery.eq('source_type', sourceFilter);
      }

      const { data: cheapestData } = await cheapestQuery.single();

      const candidates: UnifiedCandidate[] = (data || []).map((row: any) => ({
        id: row.id,
        hunt_id: huntId,
        source_type: row.source_type as 'internal' | 'outward',
        source: row.source_name || row.source,
        source_listing_id: row.source_listing_id,
        url: row.url || row.listing_url,
        title: row.title,
        year: row.year,
        make: row.make,
        model: row.model,
        variant_raw: row.variant,
        variant: row.variant,
        km: row.km,
        price: row.asking_price || row.price,
        asking_price: row.asking_price,
        location: row.location,
        domain: row.domain,
        // Identity-first ranking fields
        dna_score: row.dna_score || row.match_score || 0,
        rank_score: row.rank_score || 0,
        match_score: row.match_score || row.dna_score,
        price_score: row.price_score,
        final_score: row.final_score,
        effective_price: row.effective_price,
        decision: row.decision as 'BUY' | 'WATCH' | 'UNVERIFIED' | 'IGNORE',
        confidence: row.confidence,
        // Gap analysis
        gap_dollars: row.gap_dollars,
        gap_pct: row.gap_pct,
        // Source classification
        source_name: row.source_name,
        source_class: row.source_class,
        source_tier: row.source_tier,
        listing_url: row.listing_url || row.url,
        first_seen_at: row.first_seen_at,
        // Debug info
        reasons: row.reasons || [],
        sort_reason: row.sort_reason || [],
        // Status
        is_verified: row.verified,
        is_cheapest: row.is_cheapest,
        rank_position: row.rank_position,
        criteria_version: row.criteria_version,
        // ID Kit fields for blocked sources
        blocked_reason: row.blocked_reason,
        id_kit: row.id_kit,
        requires_manual_check: row.requires_manual_check,
        // Identity fields
        series_family: row.series_family,
        engine_family: row.engine_family,
        body_type: row.body_type,
        cab_type: row.cab_type,
        badge: row.badge,
      }));

      return {
        candidates,
        totalCount: count || 0,
        cheapestPrice: cheapestData?.price ?? null,
      };
    },
    enabled: enabled && !!huntId,
    staleTime,
    refetchOnMount,
  });
}

// Hook to get candidate counts for tab badges
export function useCandidateCounts(huntId: string, enabled: boolean = true) {
  return useQuery<CandidateCounts>({
    queryKey: ['candidate-counts', huntId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_get_candidate_counts', {
        p_hunt_id: huntId,
      });
      if (error) throw error;
      // Parse the JSONB response
      const result = data as unknown as CandidateCounts;
      return {
        total: result?.total ?? 0,
        buy: result?.buy ?? 0,
        watch: result?.watch ?? 0,
        unverified: result?.unverified ?? 0,
        ignore: result?.ignore ?? 0,
        live_matches: result?.live_matches ?? 0,
        opportunities: result?.opportunities ?? 0,
        by_tier: {
          auction: result?.by_tier?.auction ?? 0,
          marketplace: result?.by_tier?.marketplace ?? 0,
          dealer: result?.by_tier?.dealer ?? 0,
        },
      };
    },
    enabled: enabled && !!huntId,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

// Helper hook to trigger unified candidates rebuild
export function useRebuildUnifiedCandidates() {
  const rebuild = async (huntId: string) => {
    const { data, error } = await supabase.rpc('rpc_build_unified_candidates', {
      p_hunt_id: huntId,
    });
    if (error) throw error;
    return data;
  };

  return { rebuild };
}
