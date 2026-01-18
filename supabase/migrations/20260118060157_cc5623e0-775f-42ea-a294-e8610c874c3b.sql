-- Fix RPC to use correct column names (source instead of source_key)
DROP FUNCTION IF EXISTS public.rpc_build_unified_candidates(UUID);

CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hunt RECORD;
  v_inserted_internal INT := 0;
  v_inserted_outward INT := 0;
  v_ignored INT := 0;
  v_unverified INT := 0;
  v_criteria_version INT;
BEGIN
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF v_hunt IS NULL THEN RETURN jsonb_build_object('error', 'Hunt not found'); END IF;
  v_criteria_version := COALESCE(v_hunt.criteria_version, 1);

  DELETE FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version;

  -- Internal candidates from retail_listings via hunt_matches
  WITH internal_candidates AS (
    SELECT DISTINCT ON (rl.id)
      p_hunt_id AS hunt_id, v_criteria_version AS criteria_version, 'internal'::TEXT AS source_type,
      COALESCE(rl.source, 'retail')::TEXT AS source_val,
      CASE WHEN rl.source ILIKE '%pickles%' OR rl.source ILIKE '%manheim%' THEN 1 
           WHEN rl.source ILIKE '%autotrader%' OR rl.source ILIKE '%carsales%' THEN 2 ELSE 3 END AS source_tier,
      rl.listing_url AS url, rl.asking_price, rl.km, rl.year, rl.make, rl.model, rl.variant_raw,
      fn_classify_vehicle_identity(rl.make, rl.model, rl.variant_raw, rl.listing_url, NULL) AS identity_result,
      'listing'::TEXT AS listing_intent, 'INTERNAL_SOURCE'::TEXT AS listing_intent_reason,
      hm.match_score, hm.decision AS original_decision, true AS verified
    FROM hunt_matches hm JOIN retail_listings rl ON rl.id = hm.listing_id
    WHERE hm.hunt_id = p_hunt_id AND hm.decision IN ('BUY', 'WATCH') AND rl.delisted_at IS NULL
  )
  INSERT INTO hunt_unified_candidates (hunt_id, criteria_version, source_type, source, source_tier, url, asking_price, km, year,
    identity_key, identity_confidence, identity_evidence, series_family, engine_family, body_type, cab_type, badge,
    listing_intent, listing_intent_reason, match_score, decision, reasons, verified, rank_score, sort_reason)
  SELECT ic.hunt_id, ic.criteria_version, ic.source_type, ic.source_val, ic.source_tier, ic.url, ic.asking_price, ic.km, ic.year,
    fn_build_identity_key(ic.make, ic.model, (ic.identity_result->>'series_family'), (ic.identity_result->>'badge'),
      (ic.identity_result->>'body_type'), (ic.identity_result->>'cab_type'), (ic.identity_result->>'engine_family')),
    (ic.identity_result->>'confidence')::NUMERIC, COALESCE(ic.identity_result->'evidence', '{}'::jsonb),
    (ic.identity_result->>'series_family'), (ic.identity_result->>'engine_family'), (ic.identity_result->>'body_type'),
    (ic.identity_result->>'cab_type'), (ic.identity_result->>'badge'), ic.listing_intent, ic.listing_intent_reason, ic.match_score,
    CASE WHEN v_hunt.required_series_family IS NOT NULL AND (ic.identity_result->>'series_family') != 'UNKNOWN' 
              AND (ic.identity_result->>'series_family') != v_hunt.required_series_family THEN 'IGNORE'
         WHEN v_hunt.required_series_family IS NOT NULL AND (ic.identity_result->>'series_family') = 'UNKNOWN' THEN 'UNVERIFIED'
         ELSE ic.original_decision END,
    CASE WHEN v_hunt.required_series_family IS NOT NULL AND (ic.identity_result->>'series_family') != 'UNKNOWN' 
              AND (ic.identity_result->>'series_family') != v_hunt.required_series_family THEN ARRAY['SERIES_MISMATCH']
         WHEN v_hunt.required_series_family IS NOT NULL AND (ic.identity_result->>'series_family') = 'UNKNOWN' THEN ARRAY['SERIES_UNKNOWN']
         ELSE ARRAY[]::TEXT[] END,
    ic.verified, (100 - ic.source_tier * 10) + COALESCE(ic.match_score, 0), ARRAY['TIER_' || ic.source_tier]
  FROM internal_candidates ic;
  GET DIAGNOSTICS v_inserted_internal = ROW_COUNT;

  -- Outward candidates (using correct column names: source_url, raw_snippet, source_name)
  WITH outward_classified AS (
    SELECT hec.id, hec.hunt_id, hec.source_url AS url, hec.title, hec.raw_snippet AS snippet,
      hec.make, hec.model, hec.variant_raw, hec.asking_price, hec.km, hec.year, 
      COALESCE(hec.source_name, 'web')::TEXT AS source_val,
      hec.is_listing, hec.verified AS was_verified,
      fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet) AS intent_result,
      fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.title || ' ' || COALESCE(hec.raw_snippet, '')) AS identity_result
    FROM hunt_external_candidates hec WHERE hec.hunt_id = p_hunt_id AND hec.decision != 'IGNORE'
  )
  INSERT INTO hunt_unified_candidates (hunt_id, criteria_version, source_type, source, source_tier, url, asking_price, km, year,
    identity_key, identity_confidence, identity_evidence, series_family, engine_family, body_type, cab_type, badge,
    listing_intent, listing_intent_reason, match_score, decision, reasons, verified, rank_score, sort_reason)
  SELECT oc.hunt_id, v_criteria_version, 'outward'::TEXT, oc.source_val,
    CASE WHEN oc.url ILIKE '%pickles%' OR oc.url ILIKE '%manheim%' THEN 1 
         WHEN oc.url ILIKE '%autotrader%' OR oc.url ILIKE '%carsales%' THEN 2 ELSE 3 END,
    oc.url, oc.asking_price, oc.km, oc.year,
    fn_build_identity_key(oc.make, oc.model, (oc.identity_result->>'series_family'), (oc.identity_result->>'badge'),
      (oc.identity_result->>'body_type'), (oc.identity_result->>'cab_type'), (oc.identity_result->>'engine_family')),
    (oc.identity_result->>'confidence')::NUMERIC, COALESCE(oc.identity_result->'evidence', '{}'::jsonb),
    (oc.identity_result->>'series_family'), (oc.identity_result->>'engine_family'), (oc.identity_result->>'body_type'),
    (oc.identity_result->>'cab_type'), (oc.identity_result->>'badge'),
    (oc.intent_result->>'intent'), (oc.intent_result->>'reason'), 5.0,
    CASE WHEN (oc.intent_result->>'intent') = 'non_listing' THEN 'IGNORE'
         WHEN v_hunt.required_series_family IS NOT NULL AND (oc.identity_result->>'series_family') != 'UNKNOWN' 
              AND (oc.identity_result->>'series_family') != v_hunt.required_series_family THEN 'IGNORE'
         WHEN v_hunt.required_series_family IS NOT NULL AND (oc.identity_result->>'series_family') = 'UNKNOWN' THEN 'UNVERIFIED'
         WHEN (oc.intent_result->>'intent') = 'unknown' THEN 'UNVERIFIED'
         WHEN oc.was_verified AND oc.asking_price IS NOT NULL THEN 'BUY'
         WHEN oc.is_listing THEN 'WATCH' ELSE 'UNVERIFIED' END,
    CASE WHEN (oc.intent_result->>'intent') = 'non_listing' THEN ARRAY[(oc.intent_result->>'reason')]
         WHEN v_hunt.required_series_family IS NOT NULL AND (oc.identity_result->>'series_family') != 'UNKNOWN' 
              AND (oc.identity_result->>'series_family') != v_hunt.required_series_family 
         THEN ARRAY['SERIES_MISMATCH', 'DETECTED_' || (oc.identity_result->>'series_family')]
         WHEN v_hunt.required_series_family IS NOT NULL AND (oc.identity_result->>'series_family') = 'UNKNOWN' THEN ARRAY['SERIES_UNKNOWN']
         ELSE ARRAY[]::TEXT[] END,
    COALESCE(oc.was_verified, false), 
    CASE WHEN (oc.intent_result->>'intent') = 'non_listing' THEN 0 ELSE 75 END,
    ARRAY['INTENT_' || (oc.intent_result->>'intent'), 'SERIES_' || (oc.identity_result->>'series_family')]
  FROM outward_classified oc
  ON CONFLICT (hunt_id, criteria_version, url) DO UPDATE SET decision = EXCLUDED.decision, reasons = EXCLUDED.reasons,
    series_family = EXCLUDED.series_family, listing_intent = EXCLUDED.listing_intent, updated_at = NOW();
  GET DIAGNOSTICS v_inserted_outward = ROW_COUNT;

  SELECT COUNT(*) INTO v_ignored FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'IGNORE';
  SELECT COUNT(*) INTO v_unverified FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'UNVERIFIED';

  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY hunt_id, criteria_version ORDER BY 
      CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END,
      source_tier ASC, rank_score DESC, asking_price ASC NULLS LAST) AS new_rank
    FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version
  )
  UPDATE hunt_unified_candidates huc SET rank_position = ranked.new_rank FROM ranked WHERE huc.id = ranked.id;

  RETURN jsonb_build_object('success', true, 'hunt_id', p_hunt_id, 'criteria_version', v_criteria_version,
    'internal_inserted', v_inserted_internal, 'outward_inserted', v_inserted_outward, 
    'ignored_count', v_ignored, 'unverified_count', v_unverified);
END $$;