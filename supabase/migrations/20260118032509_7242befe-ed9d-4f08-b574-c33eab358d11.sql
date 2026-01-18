-- Drop existing rpc_get_unified_candidates to avoid ambiguity
DROP FUNCTION IF EXISTS public.rpc_get_unified_candidates(UUID);
DROP FUNCTION IF EXISTS public.rpc_get_unified_candidates(UUID, TEXT);
DROP FUNCTION IF EXISTS public.rpc_get_unified_candidates(UUID, TEXT, INT);

-- ============================================================
-- 6. GET UNIFIED CANDIDATES RPC (for UI) - RECREATE
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_get_unified_candidates(
  p_hunt_id UUID,
  p_decision_filter TEXT DEFAULT NULL,
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt RECORD;
  v_results JSONB;
BEGIN
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;
  
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', huc.id,
      'source_type', huc.source_type,
      'source', huc.source,
      'source_tier', huc.source_tier,
      'source_class', huc.source_class,
      'url', huc.url,
      'title', huc.title,
      'year', huc.year,
      'make', huc.make,
      'model', huc.model,
      'variant_raw', huc.variant_raw,
      'km', huc.km,
      'price', huc.price,
      'location', huc.location,
      'series_family', huc.series_family,
      'engine_family', huc.engine_family,
      'body_type', huc.body_type,
      'cab_type', huc.cab_type,
      'badge', huc.badge,
      'identity_key', huc.identity_key,
      'identity_confidence', huc.identity_confidence,
      'identity_evidence', huc.identity_evidence,
      'listing_intent', huc.listing_intent,
      'listing_intent_reason', huc.listing_intent_reason,
      'match_score', huc.match_score,
      'rank_score', huc.rank_score,
      'rank_position', huc.rank_position,
      'decision', huc.decision,
      'reasons', huc.reasons,
      'sort_reason', huc.sort_reason,
      'verified', huc.verified,
      'created_at', huc.created_at
    )
    ORDER BY 
      CASE huc.decision 
        WHEN 'BUY' THEN 1 
        WHEN 'WATCH' THEN 2 
        WHEN 'UNVERIFIED' THEN 3 
        ELSE 4 
      END,
      huc.source_tier ASC,
      huc.match_score DESC,
      huc.price ASC NULLS LAST
  )
  INTO v_results
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_hunt.criteria_version
    AND NOT huc.is_stale
    AND (p_decision_filter IS NULL OR huc.decision = p_decision_filter)
  LIMIT p_limit;
  
  RETURN jsonb_build_object(
    'hunt_id', p_hunt_id,
    'criteria_version', v_hunt.criteria_version,
    'required_series_family', v_hunt.required_series_family,
    'required_engine_family', v_hunt.required_engine_family,
    'required_body_type', v_hunt.required_body_type,
    'candidates', COALESCE(v_results, '[]'::jsonb)
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.rpc_get_unified_candidates(UUID, TEXT, INT) TO authenticated, anon;