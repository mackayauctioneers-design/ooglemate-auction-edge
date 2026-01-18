-- Create dedicated RPC for Live Matches that ONLY excludes IGNORE
-- This ensures BUY, WATCH, and UNVERIFIED all show up

CREATE OR REPLACE FUNCTION public.rpc_get_live_matches(
  p_hunt_id uuid,
  p_limit int DEFAULT 200,
  p_offset int DEFAULT 0
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
    huc.created_at
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_criteria_version
    AND huc.is_stale = false
    AND huc.decision <> 'IGNORE'
  ORDER BY
    huc.source_tier ASC,
    huc.price ASC NULLS LAST,
    huc.dna_score DESC,
    huc.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Also create a count function for Live Matches
CREATE OR REPLACE FUNCTION public.rpc_get_live_matches_count(p_hunt_id uuid)
RETURNS int
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

  SELECT COUNT(*)::int INTO v_count
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_criteria_version
    AND huc.is_stale = false
    AND huc.decision <> 'IGNORE';

  RETURN v_count;
END;
$$;