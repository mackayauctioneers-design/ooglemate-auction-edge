-- Fix rpc_build_unified_candidates: column is listing_url not source_url
CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt record;
  v_criteria_version int;
  v_inserted int := 0;
  v_deleted int := 0;
  v_buy_count int := 0;
  v_watch_count int := 0;
  v_unverified_count int := 0;
BEGIN
  -- Get hunt details
  SELECT sh.*, sh.criteria_version INTO v_hunt
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  IF v_hunt IS NULL THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;

  v_criteria_version := COALESCE(v_hunt.criteria_version, 1);

  -- Delete existing candidates for this version
  DELETE FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id
    AND criteria_version = v_criteria_version;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Insert unified candidates from internal matches (hunt_matches + vehicle_listings)
  WITH internal_matches AS (
    SELECT
      hm.id as match_id,
      hm.hunt_id,
      hm.criteria_version,
      'internal'::text as source_type,
      COALESCE(vl.source, 'unknown') as source,
      vl.listing_url as url,
      COALESCE(vl.variant_raw, vl.model) as title,
      vl.year,
      vl.make,
      vl.model,
      vl.variant_raw,
      vl.km,
      vl.asking_price as price,
      vl.location,
      -- Source tier: 1=auction, 2=marketplace, 3=dealer
      CASE 
        WHEN vl.source IN ('pickles', 'manheim', 'graysonline', 'fowles', 'asp') THEN 1
        WHEN vl.source IN ('carsales', 'autotrader', 'gumtree', 'facebook') THEN 2
        ELSE 3
      END as source_tier,
      vl.source_class,
      hm.match_score as dna_score,
      hm.decision as match_decision,
      hm.confidence_label,
      vl.variant_family as series_family,
      NULL::text as engine_family,
      NULL::text as body_type,
      NULL::text as cab_type,
      NULL::text as badge,
      (hm.match_score >= 7.0) as verified,
      vl.id as listing_id
    FROM hunt_matches hm
    JOIN vehicle_listings vl ON vl.id = hm.listing_id
    WHERE hm.hunt_id = p_hunt_id
      AND hm.criteria_version = v_criteria_version
      AND hm.is_stale = false
  ),
  -- Insert external candidates (outward hunt results)
  external_candidates AS (
    SELECT
      hec.id as match_id,
      hec.hunt_id,
      hec.criteria_version,
      'external'::text as source_type,
      hec.source_name as source,
      hec.source_url as url,
      hec.title,
      hec.year,
      hec.make,
      hec.model,
      hec.variant_raw,
      hec.km,
      hec.asking_price as price,
      hec.location,
      -- External sources are tier 2-3
      CASE 
        WHEN hec.source_name ILIKE '%carsales%' THEN 2
        WHEN hec.source_name ILIKE '%gumtree%' THEN 2
        ELSE 3
      END as source_tier,
      'external'::text as source_class,
      hec.match_score as dna_score,
      hec.decision as match_decision,
      hec.confidence as confidence_label,
      hec.series_family,
      hec.engine_family,
      hec.body_type,
      hec.cab_type,
      hec.badge,
      hec.verified,
      hec.id as listing_id
    FROM hunt_external_candidates hec
    WHERE hec.hunt_id = p_hunt_id
      AND hec.criteria_version = v_criteria_version
      AND hec.is_stale = false
      AND hec.is_listing = true
  ),
  -- Combine and classify
  all_candidates AS (
    SELECT * FROM internal_matches
    UNION ALL
    SELECT * FROM external_candidates
  ),
  -- Apply decision logic: BUY (verified + high score), WATCH (listing intent + medium score), UNVERIFIED (rest), IGNORE (blocked)
  classified AS (
    SELECT
      ac.*,
      -- Determine final decision
      CASE
        WHEN ac.match_decision = 'IGNORE' OR ac.match_decision = 'ignore' THEN 'IGNORE'
        WHEN ac.verified = true AND COALESCE(ac.dna_score, 0) >= 7.0 THEN 'BUY'
        WHEN COALESCE(ac.dna_score, 0) >= 5.0 THEN 'WATCH'
        ELSE 'UNVERIFIED'
      END as final_decision,
      NULL::text as blocked_reason,
      'listing'::text as listing_intent,
      NULL::text as listing_intent_reason
    FROM all_candidates ac
  ),
  -- Rank and insert
  ranked AS (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        ORDER BY 
          c.source_tier ASC,
          c.price ASC NULLS LAST,
          c.dna_score DESC NULLS LAST,
          c.match_id
      ) as rank_position,
      (c.price = MIN(c.price) OVER ()) as is_cheapest
    FROM classified c
  )
  INSERT INTO hunt_unified_candidates (
    hunt_id,
    criteria_version,
    source_type,
    source,
    url,
    title,
    year,
    make,
    model,
    variant_raw,
    km,
    price,
    location,
    decision,
    source_tier,
    source_class,
    rank_position,
    is_cheapest,
    dna_score,
    listing_intent,
    listing_intent_reason,
    series_family,
    engine_family,
    body_type,
    cab_type,
    badge,
    verified,
    blocked_reason,
    created_at
  )
  SELECT
    r.hunt_id,
    r.criteria_version,
    r.source_type,
    r.source,
    r.url,
    r.title,
    r.year,
    r.make,
    r.model,
    r.variant_raw,
    r.km,
    r.price,
    r.location,
    r.final_decision,
    r.source_tier,
    r.source_class,
    r.rank_position::int,
    r.is_cheapest,
    r.dna_score,
    r.listing_intent,
    r.listing_intent_reason,
    r.series_family,
    r.engine_family,
    r.body_type,
    r.cab_type,
    r.badge,
    r.verified,
    r.blocked_reason,
    now()
  FROM ranked r;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Count by decision
  SELECT 
    COUNT(*) FILTER (WHERE decision = 'BUY'),
    COUNT(*) FILTER (WHERE decision = 'WATCH'),
    COUNT(*) FILTER (WHERE decision = 'UNVERIFIED')
  INTO v_buy_count, v_watch_count, v_unverified_count
  FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', v_deleted,
    'inserted', v_inserted,
    'buy', v_buy_count,
    'watch', v_watch_count,
    'unverified', v_unverified_count
  );
END;
$$;