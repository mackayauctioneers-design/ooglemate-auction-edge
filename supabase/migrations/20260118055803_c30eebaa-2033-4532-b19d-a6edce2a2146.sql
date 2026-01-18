-- Fix column name: price -> asking_price in rpc_build_unified_candidates
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
  -- Get hunt with required fields
  SELECT * INTO v_hunt
  FROM sale_hunts
  WHERE id = p_hunt_id;

  IF v_hunt IS NULL THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;

  v_criteria_version := COALESCE(v_hunt.criteria_version, 1);

  -- Clear existing candidates for this hunt version
  DELETE FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version;

  -- Insert internal candidates from retail_listings via hunt_matches
  WITH internal_candidates AS (
    SELECT DISTINCT ON (rl.id)
      p_hunt_id AS hunt_id,
      v_criteria_version AS criteria_version,
      'internal'::TEXT AS source_type,
      rl.source AS source_key,
      CASE
        WHEN rl.source ILIKE '%pickles%' OR rl.source ILIKE '%manheim%' OR rl.source ILIKE '%lloyds%' OR rl.source ILIKE '%grays%' THEN 1
        WHEN rl.source ILIKE '%autotrader%' OR rl.source ILIKE '%carsales%' OR rl.source ILIKE '%gumtree%' THEN 2
        ELSE 3
      END AS source_tier,
      rl.listing_url AS url,
      rl.asking_price AS asking_price,
      rl.km,
      rl.year,
      rl.make,
      rl.model,
      rl.variant_raw,
      -- Classify identity
      fn_classify_vehicle_identity(rl.make, rl.model, rl.variant_raw, rl.listing_url, NULL) AS identity_result,
      -- Internal listings are assumed to be real listings
      'listing'::TEXT AS listing_intent,
      'INTERNAL_SOURCE'::TEXT AS listing_intent_reason,
      hm.match_score,
      hm.decision AS original_decision,
      true AS verified
    FROM hunt_matches hm
    JOIN retail_listings rl ON rl.id = hm.listing_id
    WHERE hm.hunt_id = p_hunt_id
      AND hm.decision IN ('BUY', 'WATCH')
      AND rl.delisted_at IS NULL
  )
  INSERT INTO hunt_unified_candidates (
    hunt_id, criteria_version, source_type, source_key, source_tier,
    url, asking_price, km, year,
    identity_key, identity_confidence, identity_evidence,
    series_family, engine_family, body_type, cab_type, badge,
    listing_intent, listing_intent_reason,
    match_score, decision, reasons, verified, rank_score, sort_reason
  )
  SELECT
    ic.hunt_id, ic.criteria_version, ic.source_type, ic.source_key, ic.source_tier,
    ic.url, ic.asking_price, ic.km, ic.year,
    fn_build_identity_key(
      ic.make, ic.model,
      (ic.identity_result->>'series_family'),
      (ic.identity_result->>'badge'),
      (ic.identity_result->>'body_type'),
      (ic.identity_result->>'cab_type'),
      (ic.identity_result->>'engine_family')
    ) AS identity_key,
    (ic.identity_result->>'confidence')::NUMERIC AS identity_confidence,
    COALESCE(ic.identity_result->'evidence', '{}'::jsonb) AS identity_evidence,
    (ic.identity_result->>'series_family') AS series_family,
    (ic.identity_result->>'engine_family') AS engine_family,
    (ic.identity_result->>'body_type') AS body_type,
    (ic.identity_result->>'cab_type') AS cab_type,
    (ic.identity_result->>'badge') AS badge,
    ic.listing_intent,
    ic.listing_intent_reason,
    ic.match_score,
    -- Proof gating for internal
    CASE
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (ic.identity_result->>'series_family') != 'UNKNOWN'
           AND (ic.identity_result->>'series_family') != v_hunt.required_series_family 
      THEN 'IGNORE'
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (ic.identity_result->>'series_family') = 'UNKNOWN' 
      THEN 'UNVERIFIED'
      ELSE ic.original_decision
    END AS decision,
    CASE
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (ic.identity_result->>'series_family') != 'UNKNOWN'
           AND (ic.identity_result->>'series_family') != v_hunt.required_series_family 
      THEN ARRAY['SERIES_MISMATCH']
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (ic.identity_result->>'series_family') = 'UNKNOWN' 
      THEN ARRAY['SERIES_UNKNOWN']
      ELSE ARRAY[]::TEXT[]
    END AS reasons,
    ic.verified,
    -- Rank score: tier first, then match score, then price
    (100 - ic.source_tier * 10) + COALESCE(ic.match_score, 0) AS rank_score,
    ARRAY[
      'TIER_' || ic.source_tier,
      'SCORE_' || COALESCE(ic.match_score::TEXT, '0')
    ] AS sort_reason
  FROM internal_candidates ic;

  GET DIAGNOSTICS v_inserted_internal = ROW_COUNT;

  -- Insert outward candidates with full classification
  WITH outward_classified AS (
    SELECT
      hec.id,
      hec.hunt_id,
      hec.url,
      hec.title,
      hec.snippet,
      hec.make,
      hec.model,
      hec.variant_raw,
      hec.asking_price,
      hec.km,
      hec.year,
      hec.source,
      hec.is_listing,
      hec.verified AS was_verified,
      -- Classify listing intent
      fn_classify_listing_intent(hec.url, hec.title, hec.snippet) AS intent_result,
      -- Classify identity
      fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.url, hec.title || ' ' || COALESCE(hec.snippet, '')) AS identity_result
    FROM hunt_external_candidates hec
    WHERE hec.hunt_id = p_hunt_id
      AND hec.decision != 'IGNORE'
  )
  INSERT INTO hunt_unified_candidates (
    hunt_id, criteria_version, source_type, source_key, source_tier,
    url, asking_price, km, year,
    identity_key, identity_confidence, identity_evidence,
    series_family, engine_family, body_type, cab_type, badge,
    listing_intent, listing_intent_reason,
    match_score, decision, reasons, verified, rank_score, sort_reason
  )
  SELECT
    oc.hunt_id,
    v_criteria_version,
    'outward'::TEXT,
    COALESCE(oc.source, 'web'),
    CASE
      WHEN oc.url ILIKE '%pickles%' OR oc.url ILIKE '%manheim%' OR oc.url ILIKE '%lloyds%' OR oc.url ILIKE '%grays%' THEN 1
      WHEN oc.url ILIKE '%autotrader%' OR oc.url ILIKE '%carsales%' OR oc.url ILIKE '%gumtree%' THEN 2
      ELSE 3
    END AS source_tier,
    oc.url,
    oc.asking_price,
    oc.km,
    oc.year,
    fn_build_identity_key(
      oc.make, oc.model,
      (oc.identity_result->>'series_family'),
      (oc.identity_result->>'badge'),
      (oc.identity_result->>'body_type'),
      (oc.identity_result->>'cab_type'),
      (oc.identity_result->>'engine_family')
    ) AS identity_key,
    (oc.identity_result->>'confidence')::NUMERIC AS identity_confidence,
    COALESCE(oc.identity_result->'evidence', '{}'::jsonb) AS identity_evidence,
    (oc.identity_result->>'series_family') AS series_family,
    (oc.identity_result->>'engine_family') AS engine_family,
    (oc.identity_result->>'body_type') AS body_type,
    (oc.identity_result->>'cab_type') AS cab_type,
    (oc.identity_result->>'badge') AS badge,
    (oc.intent_result->>'intent') AS listing_intent,
    (oc.intent_result->>'reason') AS listing_intent_reason,
    5.0 AS match_score, -- Default outward score
    -- PROOF GATING DECISION
    CASE
      -- Non-listing intent = IGNORE
      WHEN (oc.intent_result->>'intent') = 'non_listing' THEN 'IGNORE'
      -- Series mismatch = IGNORE
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (oc.identity_result->>'series_family') != 'UNKNOWN'
           AND (oc.identity_result->>'series_family') != v_hunt.required_series_family 
      THEN 'IGNORE'
      -- Unknown series when required = UNVERIFIED
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (oc.identity_result->>'series_family') = 'UNKNOWN' 
      THEN 'UNVERIFIED'
      -- Unknown listing intent = UNVERIFIED
      WHEN (oc.intent_result->>'intent') = 'unknown' THEN 'UNVERIFIED'
      -- Verified listing with all checks passed
      WHEN oc.was_verified AND oc.asking_price IS NOT NULL THEN 'BUY'
      WHEN oc.is_listing THEN 'WATCH'
      ELSE 'UNVERIFIED'
    END AS decision,
    -- REASONS
    CASE
      WHEN (oc.intent_result->>'intent') = 'non_listing' 
      THEN ARRAY[(oc.intent_result->>'reason')]
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (oc.identity_result->>'series_family') != 'UNKNOWN'
           AND (oc.identity_result->>'series_family') != v_hunt.required_series_family 
      THEN ARRAY['SERIES_MISMATCH', 'DETECTED_' || (oc.identity_result->>'series_family'), 'REQUIRED_' || v_hunt.required_series_family]
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (oc.identity_result->>'series_family') = 'UNKNOWN' 
      THEN ARRAY['SERIES_UNKNOWN']
      ELSE ARRAY[]::TEXT[]
    END AS reasons,
    COALESCE(oc.was_verified, false) OR (oc.asking_price IS NOT NULL AND oc.km IS NOT NULL),
    -- Rank score
    CASE
      WHEN (oc.intent_result->>'intent') = 'non_listing' THEN 0
      ELSE (100 - (CASE
        WHEN oc.url ILIKE '%pickles%' OR oc.url ILIKE '%manheim%' THEN 1
        WHEN oc.url ILIKE '%autotrader%' OR oc.url ILIKE '%carsales%' THEN 2
        ELSE 3
      END) * 10) + 5.0
    END AS rank_score,
    ARRAY[
      'INTENT_' || (oc.intent_result->>'intent'),
      'SERIES_' || (oc.identity_result->>'series_family')
    ] AS sort_reason
  FROM outward_classified oc
  ON CONFLICT (hunt_id, criteria_version, url) DO UPDATE SET
    decision = EXCLUDED.decision,
    reasons = EXCLUDED.reasons,
    identity_key = EXCLUDED.identity_key,
    identity_confidence = EXCLUDED.identity_confidence,
    identity_evidence = EXCLUDED.identity_evidence,
    series_family = EXCLUDED.series_family,
    engine_family = EXCLUDED.engine_family,
    body_type = EXCLUDED.body_type,
    cab_type = EXCLUDED.cab_type,
    badge = EXCLUDED.badge,
    listing_intent = EXCLUDED.listing_intent,
    listing_intent_reason = EXCLUDED.listing_intent_reason,
    verified = EXCLUDED.verified,
    rank_score = EXCLUDED.rank_score,
    sort_reason = EXCLUDED.sort_reason,
    updated_at = NOW();

  GET DIAGNOSTICS v_inserted_outward = ROW_COUNT;

  -- Count ignored and unverified
  SELECT COUNT(*) INTO v_ignored FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'IGNORE';

  SELECT COUNT(*) INTO v_unverified FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'UNVERIFIED';

  -- Update rank positions
  WITH ranked AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY hunt_id, criteria_version
        ORDER BY 
          CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END,
          source_tier ASC,
          rank_score DESC,
          asking_price ASC NULLS LAST
      ) AS new_rank
    FROM hunt_unified_candidates
    WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version
  )
  UPDATE hunt_unified_candidates huc
  SET rank_position = ranked.new_rank
  FROM ranked
  WHERE huc.id = ranked.id;

  RETURN jsonb_build_object(
    'success', true,
    'hunt_id', p_hunt_id,
    'criteria_version', v_criteria_version,
    'internal_inserted', v_inserted_internal,
    'outward_inserted', v_inserted_outward,
    'ignored_count', v_ignored,
    'unverified_count', v_unverified
  );
END $$;