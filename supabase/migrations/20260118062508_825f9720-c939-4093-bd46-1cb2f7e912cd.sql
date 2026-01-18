-- Step 1: Create normalization view for hunt_external_candidates
CREATE OR REPLACE VIEW public.hunt_external_candidates_v AS
SELECT
  id,
  hunt_id,
  criteria_version,
  is_stale,
  source_url,
  source_name,
  title,
  raw_snippet,
  make,
  model,
  variant_raw,
  year,
  km,
  asking_price,
  location,
  COALESCE(is_listing, false) AS is_listing,
  COALESCE(verified, false) AS verified,
  page_type,
  listing_kind,
  decision,
  reject_reason,
  -- Pre-classified fields (if already set by outward-hunt)
  series_family AS ext_series_family,
  engine_family AS ext_engine_family,
  body_type AS ext_body_type,
  cab_type AS ext_cab_type,
  badge AS ext_badge,
  listing_intent AS ext_listing_intent,
  listing_intent_reason AS ext_listing_intent_reason,
  identity_key AS ext_identity_key,
  identity_confidence AS ext_identity_confidence,
  identity_evidence AS ext_identity_evidence
FROM public.hunt_external_candidates;

-- Step 2: Create normalization view for retail_listings (active only)
CREATE OR REPLACE VIEW public.retail_listings_active_v AS
SELECT
  id,
  source,
  source_listing_id,
  listing_url,
  title,
  description,
  make,
  model,
  variant_raw,
  year,
  km,
  asking_price,
  suburb,
  state,
  region_id,
  first_seen_at,
  -- Identity fields (already classified)
  series_family,
  engine_family,
  body_type,
  cab_type,
  badge,
  identity_key,
  identity_confidence,
  identity_evidence,
  listing_intent,
  listing_intent_reason,
  -- Normalize active status
  CASE WHEN lifecycle_status = 'active' AND delisted_at IS NULL THEN true ELSE false END AS is_active
FROM public.retail_listings;

-- Step 3: Create fn_compute_outward_dna_score function
CREATE OR REPLACE FUNCTION public.fn_compute_outward_dna_score(
  p_series_family TEXT,
  p_engine_family TEXT,
  p_body_type TEXT,
  p_badge TEXT,
  p_year INT,
  p_snippet TEXT,
  p_hunt_series TEXT,
  p_hunt_engine TEXT,
  p_hunt_body TEXT,
  p_hunt_badge TEXT,
  p_hunt_year INT,
  p_must_have_tokens TEXT[]
) RETURNS NUMERIC AS $$
DECLARE
  v_score NUMERIC := 5.0;
  v_token TEXT;
BEGIN
  -- Series match: +2.0
  IF p_series_family IS NOT NULL AND p_hunt_series IS NOT NULL 
     AND UPPER(p_series_family) = UPPER(p_hunt_series) THEN
    v_score := v_score + 2.0;
  END IF;
  
  -- Engine match: +1.0
  IF p_engine_family IS NOT NULL AND p_hunt_engine IS NOT NULL 
     AND UPPER(p_engine_family) = UPPER(p_hunt_engine) THEN
    v_score := v_score + 1.0;
  END IF;
  
  -- Body match: +1.0
  IF p_body_type IS NOT NULL AND p_hunt_body IS NOT NULL 
     AND UPPER(p_body_type) = UPPER(p_hunt_body) THEN
    v_score := v_score + 1.0;
  END IF;
  
  -- Badge match: +1.0
  IF p_badge IS NOT NULL AND p_hunt_badge IS NOT NULL 
     AND UPPER(p_badge) = UPPER(p_hunt_badge) THEN
    v_score := v_score + 1.0;
  END IF;
  
  -- Year closeness: +0.5 if within ±1
  IF p_year IS NOT NULL AND p_hunt_year IS NOT NULL 
     AND ABS(p_year - p_hunt_year) <= 1 THEN
    v_score := v_score + 0.5;
  END IF;
  
  -- Must-have token hits: +0.5 per token (max +1.0)
  IF p_must_have_tokens IS NOT NULL AND array_length(p_must_have_tokens, 1) > 0 AND p_snippet IS NOT NULL THEN
    FOREACH v_token IN ARRAY p_must_have_tokens LOOP
      IF UPPER(p_snippet) LIKE '%' || UPPER(v_token) || '%' THEN
        v_score := v_score + 0.5;
        IF v_score >= 11.5 THEN EXIT; END IF; -- Cap contribution
      END IF;
    END LOOP;
  END IF;
  
  -- Cap at 10.0
  RETURN LEAST(v_score, 10.0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 4: Rebuild rpc_build_unified_candidates with CTEs and correct schema
CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_hunt RECORD;
  v_internal_count INT := 0;
  v_outward_count INT := 0;
  v_total_count INT := 0;
BEGIN
  -- Get hunt with all required fields
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF v_hunt IS NULL THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;

  -- Clear stale candidates for this hunt/version
  DELETE FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id 
    AND criteria_version = v_hunt.criteria_version;

  -- Insert OUTWARD candidates using CTE for single classifier pass
  WITH outward_classified AS (
    SELECT
      hec.*,
      -- Use pre-classified if available, otherwise classify now
      COALESCE(hec.ext_listing_intent, 
        (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet))->>'intent') AS computed_intent,
      COALESCE(hec.ext_listing_intent_reason,
        (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet))->>'reason') AS computed_intent_reason,
      COALESCE(hec.ext_series_family,
        (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet))->>'series_family') AS computed_series,
      COALESCE(hec.ext_engine_family,
        (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet))->>'engine_family') AS computed_engine,
      COALESCE(hec.ext_body_type,
        (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet))->>'body_type') AS computed_body,
      COALESCE(hec.ext_cab_type,
        (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet))->>'cab_type') AS computed_cab,
      COALESCE(hec.ext_badge,
        (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet))->>'badge') AS computed_badge,
      (fn_build_identity_key(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)) AS computed_identity_key,
      COALESCE(hec.ext_identity_confidence,
        ((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet))->>'confidence')::NUMERIC) AS computed_identity_conf
    FROM hunt_external_candidates_v hec
    WHERE hec.hunt_id = p_hunt_id
      AND hec.criteria_version = v_hunt.criteria_version
      AND hec.is_stale = false
  ),
  outward_scored AS (
    SELECT
      oc.*,
      -- Compute DNA score
      fn_compute_outward_dna_score(
        oc.computed_series,
        oc.computed_engine,
        oc.computed_body,
        oc.computed_badge,
        oc.year,
        oc.raw_snippet,
        COALESCE(v_hunt.required_series_family, v_hunt.series_family),
        COALESCE(v_hunt.required_engine_family, v_hunt.engine_family),
        COALESCE(v_hunt.required_body_type, v_hunt.body_type),
        COALESCE(v_hunt.required_badge, v_hunt.badge),
        v_hunt.year,
        v_hunt.must_have_tokens
      ) AS dna_score,
      -- Determine source tier
      CASE
        WHEN oc.source_name IN ('pickles', 'manheim', 'grays', 'lloyds', 'slattery') THEN 1
        WHEN oc.source_name IN ('carsales', 'autotrader', 'drive', 'gumtree') THEN 2
        ELSE 3
      END AS source_tier,
      -- Apply proof gates and determine decision
      CASE
        -- Non-listing pages are IGNORE
        WHEN oc.computed_intent != 'listing' THEN 'IGNORE'
        -- Carsales unknown intent is UNVERIFIED
        WHEN oc.source_name = 'carsales' AND oc.computed_intent = 'unknown' THEN 'UNVERIFIED'
        -- Series mismatch when required
        WHEN v_hunt.required_series_family IS NOT NULL 
             AND oc.computed_series IS NOT NULL 
             AND UPPER(oc.computed_series) != UPPER(v_hunt.required_series_family) THEN 'IGNORE'
        -- Engine mismatch when required
        WHEN v_hunt.required_engine_family IS NOT NULL 
             AND oc.computed_engine IS NOT NULL 
             AND UPPER(oc.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'IGNORE'
        -- Body mismatch when required
        WHEN v_hunt.required_body_type IS NOT NULL 
             AND oc.computed_body IS NOT NULL 
             AND UPPER(oc.computed_body) != UPPER(v_hunt.required_body_type) THEN 'IGNORE'
        -- Badge mismatch when required
        WHEN v_hunt.required_badge IS NOT NULL 
             AND oc.computed_badge IS NOT NULL 
             AND UPPER(oc.computed_badge) != UPPER(v_hunt.required_badge) THEN 'IGNORE'
        -- Unknown required fields → UNVERIFIED
        WHEN v_hunt.required_series_family IS NOT NULL AND oc.computed_series IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_engine_family IS NOT NULL AND oc.computed_engine IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_body_type IS NOT NULL AND oc.computed_body IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_badge IS NOT NULL AND oc.computed_badge IS NULL THEN 'UNVERIFIED'
        -- BUY: must be listing, verified, dna_score >= 7.0, and have price
        WHEN oc.computed_intent = 'listing' 
             AND oc.verified = true 
             AND oc.asking_price IS NOT NULL THEN
          CASE 
            WHEN fn_compute_outward_dna_score(
                   oc.computed_series, oc.computed_engine, oc.computed_body, oc.computed_badge,
                   oc.year, oc.raw_snippet,
                   COALESCE(v_hunt.required_series_family, v_hunt.series_family),
                   COALESCE(v_hunt.required_engine_family, v_hunt.engine_family),
                   COALESCE(v_hunt.required_body_type, v_hunt.body_type),
                   COALESCE(v_hunt.required_badge, v_hunt.badge),
                   v_hunt.year, v_hunt.must_have_tokens
                 ) >= 7.0 THEN 'BUY'
            ELSE 'WATCH'
          END
        -- WATCH: is a listing with some evidence
        WHEN oc.computed_intent = 'listing' AND oc.is_listing THEN 'WATCH'
        -- Everything else is UNVERIFIED
        ELSE 'UNVERIFIED'
      END AS computed_decision,
      -- Blocked reason for IGNORE
      CASE
        WHEN oc.computed_intent != 'listing' THEN 'NOT_LISTING'
        WHEN v_hunt.required_series_family IS NOT NULL 
             AND oc.computed_series IS NOT NULL 
             AND UPPER(oc.computed_series) != UPPER(v_hunt.required_series_family) THEN 'SERIES_MISMATCH'
        WHEN v_hunt.required_engine_family IS NOT NULL 
             AND oc.computed_engine IS NOT NULL 
             AND UPPER(oc.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'ENGINE_MISMATCH'
        WHEN v_hunt.required_body_type IS NOT NULL 
             AND oc.computed_body IS NOT NULL 
             AND UPPER(oc.computed_body) != UPPER(v_hunt.required_body_type) THEN 'BODY_MISMATCH'
        WHEN v_hunt.required_badge IS NOT NULL 
             AND oc.computed_badge IS NOT NULL 
             AND UPPER(oc.computed_badge) != UPPER(v_hunt.required_badge) THEN 'BADGE_MISMATCH'
        ELSE NULL
      END AS blocked_reason
  )
  INSERT INTO hunt_unified_candidates (
    hunt_id, criteria_version, source_type, source, url, title,
    year, make, model, variant_raw, km, price, location,
    match_score, dna_score, decision, blocked_reason,
    source_tier, source_class, rank_score,
    series_family, engine_family, body_type, cab_type, badge,
    identity_key, identity_confidence,
    listing_intent, listing_intent_reason, verified
  )
  SELECT
    p_hunt_id,
    v_hunt.criteria_version,
    'outward',
    os.source_name,
    os.source_url,
    os.title,
    os.year,
    os.make,
    os.model,
    os.variant_raw,
    os.km,
    os.asking_price,
    os.location,
    os.dna_score,  -- Use computed DNA score as match_score
    os.dna_score,
    os.computed_decision,
    os.blocked_reason,
    os.source_tier,
    CASE os.source_tier WHEN 1 THEN 'auction' WHEN 2 THEN 'marketplace' ELSE 'other' END,
    -- rank_score: decision weight + dna_score
    CASE os.computed_decision 
      WHEN 'BUY' THEN 100 
      WHEN 'WATCH' THEN 50 
      WHEN 'UNVERIFIED' THEN 25 
      ELSE 0 
    END + os.dna_score,
    os.computed_series,
    os.computed_engine,
    os.computed_body,
    os.computed_cab,
    os.computed_badge,
    os.computed_identity_key,
    os.computed_identity_conf,
    os.computed_intent,
    os.computed_intent_reason,
    os.verified
  FROM outward_scored os
  ON CONFLICT (hunt_id, criteria_version, url) 
  DO UPDATE SET
    decision = EXCLUDED.decision,
    match_score = EXCLUDED.match_score,
    dna_score = EXCLUDED.dna_score,
    blocked_reason = EXCLUDED.blocked_reason,
    series_family = EXCLUDED.series_family,
    engine_family = EXCLUDED.engine_family,
    body_type = EXCLUDED.body_type,
    badge = EXCLUDED.badge,
    listing_intent = EXCLUDED.listing_intent,
    updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  -- Insert INTERNAL candidates using CTE
  WITH internal_classified AS (
    SELECT
      rl.*,
      -- Use pre-classified fields from retail_listings_active_v
      rl.series_family AS computed_series,
      rl.engine_family AS computed_engine,
      rl.body_type AS computed_body,
      rl.cab_type AS computed_cab,
      rl.badge AS computed_badge,
      rl.identity_key AS computed_identity_key,
      rl.identity_confidence AS computed_identity_conf,
      COALESCE(rl.listing_intent, 'listing') AS computed_intent,
      rl.listing_intent_reason AS computed_intent_reason,
      -- Determine source tier for internal
      CASE
        WHEN rl.source IN ('pickles', 'manheim', 'grays', 'lloyds', 'slattery') THEN 1
        WHEN rl.source IN ('carsales', 'autotrader', 'drive', 'gumtree', 'gumtree_dealer') THEN 2
        ELSE 3
      END AS source_tier
    FROM retail_listings_active_v rl
    WHERE rl.is_active = true
      AND UPPER(rl.make) = UPPER(v_hunt.make)
      AND UPPER(rl.model) = UPPER(v_hunt.model)
      AND (v_hunt.states IS NULL OR rl.state = ANY(v_hunt.states))
  ),
  internal_scored AS (
    SELECT
      ic.*,
      -- Compute DNA score for internal
      fn_compute_outward_dna_score(
        ic.computed_series,
        ic.computed_engine,
        ic.computed_body,
        ic.computed_badge,
        ic.year,
        COALESCE(ic.title, '') || ' ' || COALESCE(ic.description, ''),
        COALESCE(v_hunt.required_series_family, v_hunt.series_family),
        COALESCE(v_hunt.required_engine_family, v_hunt.engine_family),
        COALESCE(v_hunt.required_body_type, v_hunt.body_type),
        COALESCE(v_hunt.required_badge, v_hunt.badge),
        v_hunt.year,
        v_hunt.must_have_tokens
      ) AS dna_score,
      -- Apply proof gates for internal
      CASE
        -- Series mismatch when required
        WHEN v_hunt.required_series_family IS NOT NULL 
             AND ic.computed_series IS NOT NULL 
             AND UPPER(ic.computed_series) != UPPER(v_hunt.required_series_family) THEN 'IGNORE'
        -- Engine mismatch when required
        WHEN v_hunt.required_engine_family IS NOT NULL 
             AND ic.computed_engine IS NOT NULL 
             AND UPPER(ic.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'IGNORE'
        -- Body mismatch when required
        WHEN v_hunt.required_body_type IS NOT NULL 
             AND ic.computed_body IS NOT NULL 
             AND UPPER(ic.computed_body) != UPPER(v_hunt.required_body_type) THEN 'IGNORE'
        -- Badge mismatch when required
        WHEN v_hunt.required_badge IS NOT NULL 
             AND ic.computed_badge IS NOT NULL 
             AND UPPER(ic.computed_badge) != UPPER(v_hunt.required_badge) THEN 'IGNORE'
        -- Unknown required fields → UNVERIFIED
        WHEN v_hunt.required_series_family IS NOT NULL AND ic.computed_series IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_engine_family IS NOT NULL AND ic.computed_engine IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_body_type IS NOT NULL AND ic.computed_body IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_badge IS NOT NULL AND ic.computed_badge IS NULL THEN 'UNVERIFIED'
        -- BUY: dna_score >= 7.0 and has price
        WHEN ic.asking_price IS NOT NULL THEN
          CASE 
            WHEN fn_compute_outward_dna_score(
                   ic.computed_series, ic.computed_engine, ic.computed_body, ic.computed_badge,
                   ic.year, COALESCE(ic.title, '') || ' ' || COALESCE(ic.description, ''),
                   COALESCE(v_hunt.required_series_family, v_hunt.series_family),
                   COALESCE(v_hunt.required_engine_family, v_hunt.engine_family),
                   COALESCE(v_hunt.required_body_type, v_hunt.body_type),
                   COALESCE(v_hunt.required_badge, v_hunt.badge),
                   v_hunt.year, v_hunt.must_have_tokens
                 ) >= 7.0 THEN 'BUY'
            ELSE 'WATCH'
          END
        ELSE 'WATCH'
      END AS computed_decision,
      -- Blocked reason
      CASE
        WHEN v_hunt.required_series_family IS NOT NULL 
             AND ic.computed_series IS NOT NULL 
             AND UPPER(ic.computed_series) != UPPER(v_hunt.required_series_family) THEN 'SERIES_MISMATCH'
        WHEN v_hunt.required_engine_family IS NOT NULL 
             AND ic.computed_engine IS NOT NULL 
             AND UPPER(ic.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'ENGINE_MISMATCH'
        WHEN v_hunt.required_body_type IS NOT NULL 
             AND ic.computed_body IS NOT NULL 
             AND UPPER(ic.computed_body) != UPPER(v_hunt.required_body_type) THEN 'BODY_MISMATCH'
        WHEN v_hunt.required_badge IS NOT NULL 
             AND ic.computed_badge IS NOT NULL 
             AND UPPER(ic.computed_badge) != UPPER(v_hunt.required_badge) THEN 'BADGE_MISMATCH'
        ELSE NULL
      END AS blocked_reason
  )
  INSERT INTO hunt_unified_candidates (
    hunt_id, criteria_version, source_type, source, source_listing_id, url, title,
    year, make, model, variant_raw, km, price, location,
    match_score, dna_score, decision, blocked_reason,
    source_tier, source_class, rank_score,
    series_family, engine_family, body_type, cab_type, badge,
    identity_key, identity_confidence,
    listing_intent, listing_intent_reason, verified
  )
  SELECT
    p_hunt_id,
    v_hunt.criteria_version,
    'internal',
    isc.source,
    isc.source_listing_id,
    isc.listing_url,
    isc.title,
    isc.year,
    isc.make,
    isc.model,
    isc.variant_raw,
    isc.km,
    isc.asking_price,
    COALESCE(isc.suburb, '') || ', ' || COALESCE(isc.state, ''),
    isc.dna_score,
    isc.dna_score,
    isc.computed_decision,
    isc.blocked_reason,
    isc.source_tier,
    CASE isc.source_tier WHEN 1 THEN 'auction' WHEN 2 THEN 'marketplace' ELSE 'other' END,
    CASE isc.computed_decision 
      WHEN 'BUY' THEN 100 
      WHEN 'WATCH' THEN 50 
      WHEN 'UNVERIFIED' THEN 25 
      ELSE 0 
    END + isc.dna_score,
    isc.computed_series,
    isc.computed_engine,
    isc.computed_body,
    isc.computed_cab,
    isc.computed_badge,
    isc.computed_identity_key,
    isc.computed_identity_conf,
    isc.computed_intent,
    isc.computed_intent_reason,
    true  -- Internal listings are always verified
  FROM internal_scored isc
  ON CONFLICT (hunt_id, criteria_version, url) 
  DO UPDATE SET
    decision = EXCLUDED.decision,
    match_score = EXCLUDED.match_score,
    dna_score = EXCLUDED.dna_score,
    blocked_reason = EXCLUDED.blocked_reason,
    series_family = EXCLUDED.series_family,
    updated_at = now();

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- Update rank positions
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY hunt_id, criteria_version
             ORDER BY 
               CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END,
               source_tier ASC,
               rank_score DESC,
               price ASC NULLS LAST
           ) AS rn
    FROM hunt_unified_candidates
    WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version
  )
  UPDATE hunt_unified_candidates huc
  SET rank_position = ranked.rn
  FROM ranked
  WHERE huc.id = ranked.id;

  -- Mark cheapest
  UPDATE hunt_unified_candidates
  SET is_cheapest = false
  WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;

  UPDATE hunt_unified_candidates
  SET is_cheapest = true
  WHERE id = (
    SELECT id FROM hunt_unified_candidates
    WHERE hunt_id = p_hunt_id 
      AND criteria_version = v_hunt.criteria_version
      AND decision IN ('BUY', 'WATCH')
      AND price IS NOT NULL
    ORDER BY price ASC
    LIMIT 1
  );

  SELECT COUNT(*) INTO v_total_count
  FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;

  RETURN jsonb_build_object(
    'internal_count', v_internal_count,
    'outward_count', v_outward_count,
    'total_count', v_total_count,
    'criteria_version', v_hunt.criteria_version
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;