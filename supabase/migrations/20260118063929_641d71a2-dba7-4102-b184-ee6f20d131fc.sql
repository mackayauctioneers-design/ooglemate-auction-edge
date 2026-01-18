-- 1. Add fn_is_verified_listing to make verified deterministic
CREATE OR REPLACE FUNCTION public.fn_is_verified_listing(
  p_url TEXT,
  p_intent_reason TEXT,
  p_asking_price INT,
  p_year INT,
  p_make TEXT,
  p_model TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  u TEXT := LOWER(COALESCE(p_url, ''));
BEGIN
  -- Verified if URL matches known listing detail patterns
  IF p_intent_reason IN (
    'URL_AUCTION_DETAIL', 'URL_CARSALES_CARS', 'URL_CARSALES_DETAILS',
    'URL_AUTOTRADER_CAR', 'URL_AUTOTRADER_VEHICLE', 'URL_GUMTREE_SAD',
    'URL_DRIVE_CARS_FOR_SALE', 'URL_DRIVE_DEALER_LISTING',
    'URL_GENERIC_LISTING_ID', 'URL_GENERIC_STOCK_PATH', 'URL_FB_MARKETPLACE'
  ) THEN
    RETURN true;
  END IF;

  -- Verified if key fields present (price + year + make/model)
  IF p_asking_price IS NOT NULL 
     AND p_year IS NOT NULL 
     AND p_make IS NOT NULL 
     AND p_model IS NOT NULL THEN
    RETURN true;
  END IF;

  -- URL-based verification for known auction platforms
  IF u ~ 'pickles\.com\.au.*/lot|/auction|/item|/vehicle' THEN RETURN true; END IF;
  IF u ~ 'manheim\.com\.au.*/lot|/vehicle' THEN RETURN true; END IF;
  IF u ~ 'grays\.com.*/lot|/item' THEN RETURN true; END IF;
  IF u ~ 'lloydsauctions\.com\.au.*/lot|/item' THEN RETURN true; END IF;
  IF u ~ 'slattery\.com\.au.*/lot|/auction' THEN RETURN true; END IF;

  -- URL-based verification for marketplaces
  IF u ~ 'carsales\.com\.au/cars/' THEN RETURN true; END IF;
  IF u ~ 'autotrader\.com\.au.*/car/' THEN RETURN true; END IF;
  IF u ~ 'gumtree\.com\.au/s-ad/' THEN RETURN true; END IF;
  IF u ~ 'drive\.com\.au/cars-for-sale/' THEN RETURN true; END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Update rpc_build_unified_candidates with:
--    - WATCH fallback (intent=listing + no mismatch + dna>=5.0)
--    - Deterministic verified using fn_is_verified_listing
--    - Fixed ranking: tier ASC, price ASC, dna DESC

CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_hunt RECORD;
  v_internal_count INT := 0;
  v_outward_count INT := 0;
  v_total_count INT := 0;
BEGIN
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF v_hunt IS NULL THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;

  DELETE FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;

  WITH outward_raw AS (
    SELECT
      hec.*,
      fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet) AS intent_result,
      fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet) AS ident_result
    FROM hunt_external_candidates_v hec
    WHERE hec.hunt_id = p_hunt_id
      AND hec.criteria_version = v_hunt.criteria_version
      AND hec.is_stale = false
  ),
  outward_classified AS (
    SELECT
      oraw.*,
      CASE 
        WHEN oraw.ext_listing_intent IS NOT NULL AND oraw.ext_listing_intent != 'unknown' 
        THEN oraw.ext_listing_intent
        ELSE (oraw.intent_result)->>'intent'
      END AS computed_intent,
      CASE 
        WHEN oraw.ext_listing_intent IS NOT NULL AND oraw.ext_listing_intent != 'unknown' 
        THEN oraw.ext_listing_intent_reason
        ELSE (oraw.intent_result)->>'reason'
      END AS computed_intent_reason,
      COALESCE(oraw.ext_series_family, (oraw.ident_result)->>'series_family') AS computed_series,
      COALESCE(oraw.ext_engine_family, (oraw.ident_result)->>'engine_family') AS computed_engine,
      COALESCE(oraw.ext_body_type, (oraw.ident_result)->>'body_type') AS computed_body,
      COALESCE(oraw.ext_cab_type, (oraw.ident_result)->>'cab_type') AS computed_cab,
      COALESCE(oraw.ext_badge, (oraw.ident_result)->>'badge') AS computed_badge,
      COALESCE(oraw.ext_identity_confidence, ((oraw.ident_result)->>'confidence')::NUMERIC) AS computed_identity_conf
    FROM outward_raw oraw
  ),
  outward_with_key AS (
    SELECT
      oc.*,
      fn_build_identity_key(oc.make, oc.model, oc.computed_series, oc.computed_badge, 
                            oc.computed_body, oc.computed_cab, oc.computed_engine) AS computed_identity_key,
      fn_compute_outward_dna_score(
        oc.computed_series, oc.computed_engine, oc.computed_body, oc.computed_badge,
        oc.year, oc.raw_snippet,
        COALESCE(v_hunt.required_series_family, v_hunt.series_family),
        COALESCE(v_hunt.required_engine_family, v_hunt.engine_family),
        COALESCE(v_hunt.required_body_type, v_hunt.body_type),
        COALESCE(v_hunt.required_badge, v_hunt.badge),
        v_hunt.year, v_hunt.must_have_tokens
      ) AS dna_score,
      CASE
        WHEN oc.source_name IN ('pickles', 'manheim', 'grays', 'lloyds', 'slattery') THEN 1
        WHEN oc.source_name IN ('carsales', 'autotrader', 'drive', 'gumtree') THEN 2
        ELSE 3
      END AS source_tier
    FROM outward_classified oc
  ),
  outward_scored AS (
    SELECT
      ow.*,
      -- Deterministic verified using fn_is_verified_listing
      fn_is_verified_listing(
        ow.source_url,
        ow.computed_intent_reason,
        ow.asking_price,
        ow.year,
        ow.make,
        ow.model
      ) AS computed_verified,
      -- Check if proof gates pass (no mismatch)
      CASE
        WHEN v_hunt.required_series_family IS NOT NULL 
             AND ow.computed_series IS NOT NULL 
             AND UPPER(ow.computed_series) != UPPER(v_hunt.required_series_family) THEN false
        WHEN v_hunt.required_engine_family IS NOT NULL 
             AND ow.computed_engine IS NOT NULL 
             AND UPPER(ow.computed_engine) != UPPER(v_hunt.required_engine_family) THEN false
        WHEN v_hunt.required_body_type IS NOT NULL 
             AND ow.computed_body IS NOT NULL 
             AND UPPER(ow.computed_body) != UPPER(v_hunt.required_body_type) THEN false
        WHEN v_hunt.required_badge IS NOT NULL 
             AND ow.computed_badge IS NOT NULL 
             AND UPPER(ow.computed_badge) != UPPER(v_hunt.required_badge) THEN false
        ELSE true
      END AS proof_gates_pass,
      -- Check if required fields are missing
      CASE
        WHEN v_hunt.required_series_family IS NOT NULL AND ow.computed_series IS NULL THEN true
        WHEN v_hunt.required_engine_family IS NOT NULL AND ow.computed_engine IS NULL THEN true
        WHEN v_hunt.required_body_type IS NOT NULL AND ow.computed_body IS NULL THEN true
        WHEN v_hunt.required_badge IS NOT NULL AND ow.computed_badge IS NULL THEN true
        ELSE false
      END AS missing_required_fields
    FROM outward_with_key ow
  ),
  outward_final AS (
    SELECT
      os.*,
      -- DECISION LOGIC with WATCH fallback
      CASE
        -- Non-listing pages are IGNORE
        WHEN os.computed_intent = 'non_listing' THEN 'IGNORE'
        
        -- Proof gate failures are IGNORE
        WHEN os.proof_gates_pass = false THEN 'IGNORE'
        
        -- Unknown intent is UNVERIFIED
        WHEN os.computed_intent = 'unknown' THEN 'UNVERIFIED'
        
        -- Missing required fields is UNVERIFIED
        WHEN os.missing_required_fields = true THEN 'UNVERIFIED'
        
        -- BUY: verified + price + dna >= 7.0
        WHEN os.computed_intent = 'listing' 
             AND os.computed_verified = true 
             AND os.asking_price IS NOT NULL
             AND os.dna_score >= 7.0 THEN 'BUY'
        
        -- WATCH fallback: intent=listing + proof gates pass + dna >= 5.0
        WHEN os.computed_intent = 'listing' 
             AND os.proof_gates_pass = true 
             AND os.dna_score >= 5.0 THEN 'WATCH'
        
        -- Everything else with intent=listing is UNVERIFIED
        WHEN os.computed_intent = 'listing' THEN 'UNVERIFIED'
        
        ELSE 'UNVERIFIED'
      END AS computed_decision,
      -- BLOCKED REASON
      CASE
        WHEN os.computed_intent = 'non_listing' THEN 'NOT_LISTING'
        WHEN os.proof_gates_pass = false THEN
          CASE
            WHEN v_hunt.required_series_family IS NOT NULL 
                 AND os.computed_series IS NOT NULL 
                 AND UPPER(os.computed_series) != UPPER(v_hunt.required_series_family) THEN 'SERIES_MISMATCH'
            WHEN v_hunt.required_engine_family IS NOT NULL 
                 AND os.computed_engine IS NOT NULL 
                 AND UPPER(os.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'ENGINE_MISMATCH'
            WHEN v_hunt.required_body_type IS NOT NULL 
                 AND os.computed_body IS NOT NULL 
                 AND UPPER(os.computed_body) != UPPER(v_hunt.required_body_type) THEN 'BODY_MISMATCH'
            WHEN v_hunt.required_badge IS NOT NULL 
                 AND os.computed_badge IS NOT NULL 
                 AND UPPER(os.computed_badge) != UPPER(v_hunt.required_badge) THEN 'BADGE_MISMATCH'
            ELSE 'PROOF_GATE_FAIL'
          END
        WHEN os.computed_intent = 'unknown' THEN 'UNKNOWN_INTENT'
        WHEN os.missing_required_fields = true THEN 'MISSING_REQUIRED_FIELD'
        ELSE NULL
      END AS blocked_reason
    FROM outward_scored os
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
    p_hunt_id, v_hunt.criteria_version, 'outward', of.source_name, of.source_url, of.title,
    of.year, of.make, of.model, of.variant_raw, of.km, of.asking_price, of.location,
    of.dna_score, of.dna_score, of.computed_decision, of.blocked_reason,
    of.source_tier,
    CASE of.source_tier WHEN 1 THEN 'auction' WHEN 2 THEN 'marketplace' ELSE 'other' END,
    -- rank_score for ordering
    CASE of.computed_decision 
      WHEN 'BUY' THEN 100 WHEN 'WATCH' THEN 50 WHEN 'UNVERIFIED' THEN 25 ELSE 0 
    END + of.dna_score,
    of.computed_series, of.computed_engine, of.computed_body, of.computed_cab, of.computed_badge,
    of.computed_identity_key, of.computed_identity_conf,
    of.computed_intent, of.computed_intent_reason, of.computed_verified
  FROM outward_final of
  ON CONFLICT (hunt_id, criteria_version, url) 
  DO UPDATE SET
    decision = EXCLUDED.decision, match_score = EXCLUDED.match_score, dna_score = EXCLUDED.dna_score,
    blocked_reason = EXCLUDED.blocked_reason, series_family = EXCLUDED.series_family,
    engine_family = EXCLUDED.engine_family, body_type = EXCLUDED.body_type, badge = EXCLUDED.badge,
    listing_intent = EXCLUDED.listing_intent, listing_intent_reason = EXCLUDED.listing_intent_reason,
    verified = EXCLUDED.verified, updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  -- INTERNAL candidates with same logic
  WITH internal_base AS (
    SELECT rl.*,
      rl.series_family AS computed_series, rl.engine_family AS computed_engine,
      rl.body_type AS computed_body, rl.cab_type AS computed_cab, rl.badge AS computed_badge,
      rl.identity_key AS computed_identity_key, rl.identity_confidence AS computed_identity_conf,
      COALESCE(rl.listing_intent, 'listing') AS computed_intent,
      rl.listing_intent_reason AS computed_intent_reason,
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
    SELECT ib.*,
      fn_compute_outward_dna_score(
        ib.computed_series, ib.computed_engine, ib.computed_body, ib.computed_badge,
        ib.year, COALESCE(ib.title, '') || ' ' || COALESCE(ib.description, ''),
        COALESCE(v_hunt.required_series_family, v_hunt.series_family),
        COALESCE(v_hunt.required_engine_family, v_hunt.engine_family),
        COALESCE(v_hunt.required_body_type, v_hunt.body_type),
        COALESCE(v_hunt.required_badge, v_hunt.badge),
        v_hunt.year, v_hunt.must_have_tokens
      ) AS dna_score,
      -- Proof gates for internal
      CASE
        WHEN v_hunt.required_series_family IS NOT NULL 
             AND ib.computed_series IS NOT NULL 
             AND UPPER(ib.computed_series) != UPPER(v_hunt.required_series_family) THEN false
        WHEN v_hunt.required_engine_family IS NOT NULL 
             AND ib.computed_engine IS NOT NULL 
             AND UPPER(ib.computed_engine) != UPPER(v_hunt.required_engine_family) THEN false
        WHEN v_hunt.required_body_type IS NOT NULL 
             AND ib.computed_body IS NOT NULL 
             AND UPPER(ib.computed_body) != UPPER(v_hunt.required_body_type) THEN false
        WHEN v_hunt.required_badge IS NOT NULL 
             AND ib.computed_badge IS NOT NULL 
             AND UPPER(ib.computed_badge) != UPPER(v_hunt.required_badge) THEN false
        ELSE true
      END AS proof_gates_pass,
      CASE
        WHEN v_hunt.required_series_family IS NOT NULL AND ib.computed_series IS NULL THEN true
        WHEN v_hunt.required_engine_family IS NOT NULL AND ib.computed_engine IS NULL THEN true
        WHEN v_hunt.required_body_type IS NOT NULL AND ib.computed_body IS NULL THEN true
        WHEN v_hunt.required_badge IS NOT NULL AND ib.computed_badge IS NULL THEN true
        ELSE false
      END AS missing_required_fields
    FROM internal_base ib
  ),
  internal_final AS (
    SELECT
      isc.*,
      CASE
        WHEN isc.proof_gates_pass = false THEN 'IGNORE'
        WHEN isc.missing_required_fields = true THEN 'UNVERIFIED'
        WHEN isc.asking_price IS NOT NULL AND isc.dna_score >= 7.0 THEN 'BUY'
        WHEN isc.dna_score >= 5.0 THEN 'WATCH'
        ELSE 'UNVERIFIED'
      END AS computed_decision,
      CASE
        WHEN isc.proof_gates_pass = false THEN
          CASE
            WHEN v_hunt.required_series_family IS NOT NULL 
                 AND isc.computed_series IS NOT NULL 
                 AND UPPER(isc.computed_series) != UPPER(v_hunt.required_series_family) THEN 'SERIES_MISMATCH'
            WHEN v_hunt.required_engine_family IS NOT NULL 
                 AND isc.computed_engine IS NOT NULL 
                 AND UPPER(isc.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'ENGINE_MISMATCH'
            WHEN v_hunt.required_body_type IS NOT NULL 
                 AND isc.computed_body IS NOT NULL 
                 AND UPPER(isc.computed_body) != UPPER(v_hunt.required_body_type) THEN 'BODY_MISMATCH'
            WHEN v_hunt.required_badge IS NOT NULL 
                 AND isc.computed_badge IS NOT NULL 
                 AND UPPER(isc.computed_badge) != UPPER(v_hunt.required_badge) THEN 'BADGE_MISMATCH'
            ELSE 'PROOF_GATE_FAIL'
          END
        WHEN isc.missing_required_fields = true THEN 'MISSING_REQUIRED_FIELD'
        ELSE NULL
      END AS blocked_reason
    FROM internal_scored isc
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
    p_hunt_id, v_hunt.criteria_version, 'internal', inf.source, inf.source_listing_id,
    inf.listing_url, inf.title, inf.year, inf.make, inf.model, inf.variant_raw, inf.km,
    inf.asking_price, COALESCE(inf.suburb, '') || ', ' || COALESCE(inf.state, ''),
    inf.dna_score, inf.dna_score, inf.computed_decision, inf.blocked_reason, inf.source_tier,
    CASE inf.source_tier WHEN 1 THEN 'auction' WHEN 2 THEN 'marketplace' ELSE 'other' END,
    CASE inf.computed_decision 
      WHEN 'BUY' THEN 100 WHEN 'WATCH' THEN 50 WHEN 'UNVERIFIED' THEN 25 ELSE 0 
    END + inf.dna_score,
    inf.computed_series, inf.computed_engine, inf.computed_body, inf.computed_cab, inf.computed_badge,
    inf.computed_identity_key, inf.computed_identity_conf,
    inf.computed_intent, inf.computed_intent_reason, true
  FROM internal_final inf
  ON CONFLICT (hunt_id, criteria_version, url) 
  DO UPDATE SET decision = EXCLUDED.decision, match_score = EXCLUDED.match_score,
    dna_score = EXCLUDED.dna_score, blocked_reason = EXCLUDED.blocked_reason,
    series_family = EXCLUDED.series_family, verified = EXCLUDED.verified, updated_at = now();

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- RANKING: decision > tier ASC > price ASC > dna DESC
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY hunt_id, criteria_version
      ORDER BY 
        CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END,
        source_tier ASC,
        price ASC NULLS LAST,
        dna_score DESC
    ) AS rn
    FROM hunt_unified_candidates
    WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version
  )
  UPDATE hunt_unified_candidates huc SET rank_position = ranked.rn FROM ranked WHERE huc.id = ranked.id;

  -- Mark cheapest in BUY/WATCH
  UPDATE hunt_unified_candidates SET is_cheapest = false
  WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;
  UPDATE hunt_unified_candidates SET is_cheapest = true
  WHERE id = (
    SELECT id FROM hunt_unified_candidates
    WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version
      AND decision IN ('BUY', 'WATCH') AND price IS NOT NULL
    ORDER BY price ASC LIMIT 1
  );

  SELECT COUNT(*) INTO v_total_count
  FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;

  RETURN jsonb_build_object(
    'internal_count', v_internal_count, 'outward_count', v_outward_count,
    'total_count', v_total_count, 'criteria_version', v_hunt.criteria_version
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update rpc_get_unified_candidates ORDER BY to match ranking contract
CREATE OR REPLACE FUNCTION public.rpc_get_unified_candidates(
  p_hunt_id UUID,
  p_decision_filter TEXT DEFAULT NULL,
  p_source_filter TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  id UUID,
  hunt_id UUID,
  criteria_version INT,
  source_type TEXT,
  source TEXT,
  url TEXT,
  title TEXT,
  year INT,
  make TEXT,
  model TEXT,
  variant_raw TEXT,
  km INT,
  price INT,
  location TEXT,
  match_score NUMERIC,
  dna_score NUMERIC,
  decision TEXT,
  blocked_reason TEXT,
  source_tier INT,
  source_class TEXT,
  rank_position INT,
  is_cheapest BOOLEAN,
  series_family TEXT,
  engine_family TEXT,
  body_type TEXT,
  cab_type TEXT,
  badge TEXT,
  identity_key TEXT,
  identity_confidence NUMERIC,
  listing_intent TEXT,
  listing_intent_reason TEXT,
  verified BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
DECLARE
  v_criteria_version INT;
BEGIN
  SELECT sh.criteria_version INTO v_criteria_version
  FROM sale_hunts sh WHERE sh.id = p_hunt_id;

  RETURN QUERY
  SELECT 
    huc.id, huc.hunt_id, huc.criteria_version,
    huc.source_type, huc.source, huc.url, huc.title,
    huc.year, huc.make, huc.model, huc.variant_raw,
    huc.km, huc.price, huc.location,
    huc.match_score, huc.dna_score, huc.decision, huc.blocked_reason,
    huc.source_tier, huc.source_class, huc.rank_position, huc.is_cheapest,
    huc.series_family, huc.engine_family, huc.body_type, huc.cab_type, huc.badge,
    huc.identity_key, huc.identity_confidence,
    huc.listing_intent, huc.listing_intent_reason, huc.verified,
    huc.created_at
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_criteria_version
    AND (p_decision_filter IS NULL OR huc.decision = p_decision_filter)
    AND (p_source_filter IS NULL OR huc.source_type = p_source_filter)
  ORDER BY 
    CASE huc.decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END,
    huc.source_tier ASC,
    huc.price ASC NULLS LAST,
    huc.dna_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;