
-- Fix rpc_build_unified_candidates to:
-- 1. Use fn_source_tier for proper auction-first sorting
-- 2. Don't filter on is_listing (use listing_intent instead)
-- 3. Apply fn_classify_listing_intent during build for proper classification

CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      -- Use fn_source_tier for proper auction-first ranking
      fn_source_tier(vl.listing_url, vl.source) as source_tier,
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
      vl.id as listing_id,
      -- Compute listing intent at build time
      (fn_classify_listing_intent(vl.listing_url, vl.variant_raw, NULL))->>'intent' as computed_intent,
      (fn_classify_listing_intent(vl.listing_url, vl.variant_raw, NULL))->>'reason' as computed_intent_reason
    FROM hunt_matches hm
    JOIN vehicle_listings vl ON vl.id = hm.listing_id
    WHERE hm.hunt_id = p_hunt_id
      AND hm.criteria_version = v_criteria_version
      AND hm.is_stale = false
  ),
  -- Insert external candidates (outward hunt results)
  -- Don't filter on is_listing - use listing_intent computed at build time
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
      -- Use fn_source_tier for proper auction-first ranking
      fn_source_tier(hec.source_url, hec.source_name) as source_tier,
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
      hec.id as listing_id,
      -- Compute listing intent at build time using SQL function
      COALESCE(
        NULLIF(hec.listing_intent, 'unknown'),
        (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet))->>'intent'
      ) as computed_intent,
      COALESCE(
        NULLIF(hec.listing_intent_reason, NULL),
        (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet))->>'reason'
      ) as computed_intent_reason
    FROM hunt_external_candidates hec
    WHERE hec.hunt_id = p_hunt_id
      AND hec.criteria_version = v_criteria_version
      AND hec.is_stale = false
      -- Only include if not explicitly rejected as non_listing
      AND (hec.listing_intent IS NULL 
           OR hec.listing_intent != 'non_listing'
           OR (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet))->>'intent' != 'non_listing')
  ),
  -- Combine and classify
  all_candidates AS (
    SELECT * FROM internal_matches
    UNION ALL
    SELECT * FROM external_candidates
  ),
  -- Apply decision logic based on computed_intent
  classified AS (
    SELECT
      ac.*,
      -- Determine final decision (prioritize listing intent)
      CASE
        WHEN ac.computed_intent = 'non_listing' THEN 'IGNORE'
        WHEN ac.match_decision = 'IGNORE' OR ac.match_decision = 'ignore' THEN 'IGNORE'
        WHEN ac.computed_intent = 'listing' AND ac.verified = true AND COALESCE(ac.dna_score, 0) >= 7.0 THEN 'BUY'
        WHEN ac.computed_intent = 'listing' AND COALESCE(ac.dna_score, 0) >= 5.0 THEN 'WATCH'
        WHEN ac.computed_intent = 'listing' THEN 'WATCH'
        WHEN ac.computed_intent = 'unknown' THEN 'UNVERIFIED'
        ELSE 'UNVERIFIED'
      END as final_decision,
      NULL::text as blocked_reason
    FROM all_candidates ac
  ),
  -- Rank by: decision order, then tier (auction first), then price
  ranked AS (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        ORDER BY 
          CASE c.final_decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END,
          c.source_tier ASC,
          c.price ASC NULLS LAST,
          COALESCE(c.dna_score, 0) DESC,
          c.match_id DESC
      ) as rank_score
    FROM classified c
  )
  INSERT INTO hunt_unified_candidates (
    hunt_id, criteria_version, source_type, source, url, title,
    year, make, model, variant_raw, km, price, location,
    source_tier, source_class, dna_score, decision, blocked_reason,
    listing_intent, listing_intent_reason, verified, rank_score,
    series_family, engine_family, body_type, cab_type, badge
  )
  SELECT
    r.hunt_id, v_criteria_version, r.source_type, r.source, r.url, r.title,
    r.year, r.make, r.model, r.variant_raw, r.km, r.price, r.location,
    r.source_tier, r.source_class, r.dna_score, r.final_decision, r.blocked_reason,
    r.computed_intent, r.computed_intent_reason, r.verified, r.rank_score,
    r.series_family, r.engine_family, r.body_type, r.cab_type, r.badge
  FROM ranked r;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Get decision counts
  SELECT COUNT(*) INTO v_buy_count FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'BUY';
  
  SELECT COUNT(*) INTO v_watch_count FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'WATCH';
  
  SELECT COUNT(*) INTO v_unverified_count FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'UNVERIFIED';

  RETURN jsonb_build_object(
    'success', true,
    'inserted', v_inserted,
    'deleted', v_deleted,
    'buy', v_buy_count,
    'watch', v_watch_count,
    'unverified', v_unverified_count
  );
END;
$function$;
