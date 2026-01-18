-- Update rpc_get_live_matches to include DISCOVERED candidates
DROP FUNCTION IF EXISTS public.rpc_get_live_matches(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.rpc_get_live_matches(
  p_hunt_id uuid,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  hunt_id uuid,
  criteria_version int,
  source_type text,
  source text,
  url text,
  title text,
  year int,
  make text,
  model text,
  variant_raw text,
  km int,
  price int,
  location text,
  decision text,
  source_tier int,
  source_class text,
  rank_position int,
  is_cheapest boolean,
  dna_score numeric,
  listing_intent text,
  listing_intent_reason text,
  series_family text,
  engine_family text,
  body_type text,
  cab_type text,
  badge text,
  verified boolean,
  blocked_reason text,
  candidate_stage text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_criteria_version int;
BEGIN
  SELECT sh.criteria_version INTO v_criteria_version
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  RETURN QUERY
  SELECT
    huc.id,
    huc.hunt_id,
    huc.criteria_version,
    huc.source_type,
    huc.source,
    huc.url,
    huc.title,
    huc.year,
    huc.make,
    huc.model,
    huc.variant_raw,
    huc.km,
    huc.price,
    huc.location,
    huc.decision,
    huc.source_tier,
    huc.source_class,
    huc.rank_position,
    huc.is_cheapest,
    huc.dna_score,
    huc.listing_intent,
    huc.listing_intent_reason,
    huc.series_family,
    huc.engine_family,
    huc.body_type,
    huc.cab_type,
    huc.badge,
    huc.verified,
    huc.blocked_reason,
    huc.candidate_stage,
    huc.created_at
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_criteria_version
    AND huc.is_stale = false
    AND huc.decision <> 'IGNORE'  -- Show DISCOVERED, BUY, WATCH, UNVERIFIED
  ORDER BY
    CASE huc.decision 
      WHEN 'DISCOVERED' THEN 1 
      WHEN 'WATCH' THEN 2 
      WHEN 'BUY' THEN 3 
      WHEN 'UNVERIFIED' THEN 4 
      ELSE 5 
    END,
    huc.source_tier ASC,
    huc.price ASC NULLS LAST,
    huc.dna_score DESC,
    huc.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Update rpc_get_live_matches_count to include DISCOVERED
DROP FUNCTION IF EXISTS public.rpc_get_live_matches_count(uuid);

CREATE OR REPLACE FUNCTION public.rpc_get_live_matches_count(p_hunt_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_criteria_version int;
  v_count int;
BEGIN
  SELECT sh.criteria_version INTO v_criteria_version
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  SELECT COUNT(*) INTO v_count
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_criteria_version
    AND huc.is_stale = false
    AND huc.decision <> 'IGNORE';

  RETURN v_count;
END;
$$;

-- Update rpc_get_candidate_counts to include DISCOVERED
DROP FUNCTION IF EXISTS public.rpc_get_candidate_counts(uuid);

CREATE OR REPLACE FUNCTION public.rpc_get_candidate_counts(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_criteria_version int;
  v_total int := 0;
  v_buy int := 0;
  v_watch int := 0;
  v_discovered int := 0;
  v_unverified int := 0;
  v_ignore int := 0;
  v_auction int := 0;
  v_marketplace int := 0;
  v_dealer int := 0;
BEGIN
  SELECT sh.criteria_version INTO v_criteria_version
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE decision = 'BUY'),
    COUNT(*) FILTER (WHERE decision = 'WATCH'),
    COUNT(*) FILTER (WHERE decision = 'DISCOVERED'),
    COUNT(*) FILTER (WHERE decision = 'UNVERIFIED'),
    COUNT(*) FILTER (WHERE decision = 'IGNORE'),
    COUNT(*) FILTER (WHERE source_tier = 1),
    COUNT(*) FILTER (WHERE source_tier = 2),
    COUNT(*) FILTER (WHERE source_tier = 3)
  INTO v_total, v_buy, v_watch, v_discovered, v_unverified, v_ignore, v_auction, v_marketplace, v_dealer
  FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id
    AND criteria_version = v_criteria_version
    AND is_stale = false;

  RETURN jsonb_build_object(
    'total', v_total,
    'buy', v_buy,
    'watch', v_watch,
    'discovered', v_discovered,
    'unverified', v_unverified,
    'ignore', v_ignore,
    'live_matches', v_total - v_ignore,  -- Everything except IGNORE
    'opportunities', v_buy + v_watch,
    'by_tier', jsonb_build_object(
      'auction', v_auction,
      'marketplace', v_marketplace,
      'dealer', v_dealer
    )
  );
END;
$$;