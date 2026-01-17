import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { UnifiedCandidate } from "@/types/hunts";

interface UseUnifiedCandidatesOptions {
  huntId: string;
  limit?: number;
  offset?: number;
  decisionFilter?: 'BUY' | 'WATCH' | null;
  enabled?: boolean;
}

interface UnifiedCandidatesResult {
  candidates: UnifiedCandidate[];
  totalCount: number;
  cheapestPrice: number | null;
}

export function useUnifiedCandidates({
  huntId,
  limit = 50,
  offset = 0,
  decisionFilter = null,
  enabled = true,
}: UseUnifiedCandidatesOptions) {
  return useQuery<UnifiedCandidatesResult>({
    queryKey: ['unified-candidates', huntId, limit, offset, decisionFilter],
    queryFn: async () => {
      // Fetch candidates using the RPC
      const { data, error } = await supabase.rpc('rpc_get_unified_candidates', {
        p_hunt_id: huntId,
        p_limit: limit,
        p_offset: offset,
        p_decision_filter: decisionFilter,
      });

      if (error) throw error;

      // Get total count
      let countQuery = supabase
        .from('hunt_unified_candidates')
        .select('*', { count: 'exact', head: true })
        .eq('hunt_id', huntId);

      if (decisionFilter) {
        countQuery = countQuery.eq('decision', decisionFilter);
      }

      const { count, error: countError } = await countQuery;
      if (countError) throw countError;

      // Get cheapest price
      const { data: cheapestData } = await supabase
        .from('hunt_unified_candidates')
        .select('price')
        .eq('hunt_id', huntId)
        .not('price', 'is', null)
        .order('price', { ascending: true })
        .limit(1)
        .single();

      const candidates: UnifiedCandidate[] = (data || []).map((row: any) => ({
        id: row.id,
        hunt_id: huntId,
        source_type: row.source_type as 'internal' | 'outward',
        source: row.source,
        source_listing_id: row.source_listing_id,
        url: row.url,
        title: row.title,
        year: row.year,
        make: row.make,
        model: row.model,
        variant_raw: row.variant_raw,
        km: row.km,
        price: row.price,
        location: row.location,
        domain: row.domain,
        match_score: row.match_score,
        price_score: row.price_score,
        final_score: row.final_score,
        decision: row.decision as 'BUY' | 'WATCH' | 'IGNORE',
        reasons: row.reasons,
        is_cheapest: row.is_cheapest,
        rank_position: row.rank_position,
        // ID Kit fields for blocked sources
        blocked_reason: row.blocked_reason,
        id_kit: row.id_kit,
        requires_manual_check: row.requires_manual_check,
      }));

      return {
        candidates,
        totalCount: count || 0,
        cheapestPrice: cheapestData?.price ?? null,
      };
    },
    enabled: enabled && !!huntId,
    staleTime: 30000, // 30 seconds
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
