-- Fix 1: Expand fn_classify_listing_intent with better allowlist patterns
-- Fix 2: Change NO_SIGNALS to 'unknown' instead of 'non_listing'

CREATE OR REPLACE FUNCTION public.fn_classify_listing_intent(
  p_url TEXT DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_snippet TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  u TEXT := LOWER(COALESCE(p_url,''));
  t TEXT := LOWER(COALESCE(p_title,'') || ' ' || COALESCE(p_snippet,''));
  signals INT := 0;
BEGIN
  -- Hard blocklist (editorial, non-listing pages)
  IF u ~ '/news|/blog|/review|/reviews|/guide|/guides|price-and-specs|/spec|/specs|/comparison|/compare|/insurance|/finance|/about|/help|/contact|/privacy|/terms|/category|/login|/signup|/register' THEN
    RETURN jsonb_build_object('intent','non_listing','reason','NON_LISTING_URL');
  END IF;

  -- ========== EXPANDED ALLOWLIST ==========

  -- Carsales patterns
  IF u ~ 'carsales\.com\.au' AND u ~ '/cars/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_CARSALES_CARS');
  END IF;
  IF u ~ 'carsales\.com\.au' AND u ~ '/car-details/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_CARSALES_DETAILS');
  END IF;

  -- Autotrader patterns
  IF u ~ 'autotrader\.com\.au/.*/car/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_AUTOTRADER_CAR');
  END IF;
  IF u ~ 'autotrader\.com\.au' AND u ~ '/car/|/vehicle/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_AUTOTRADER_VEHICLE');
  END IF;

  -- Gumtree patterns
  IF u ~ 'gumtree\.com\.au/s-ad/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_GUMTREE_SAD');
  END IF;

  -- Drive patterns
  IF u ~ 'drive\.com\.au/cars-for-sale/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_DRIVE_CARS_FOR_SALE');
  END IF;
  IF u ~ 'drive\.com\.au/.*/dealer-listing/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_DRIVE_DEALER_LISTING');
  END IF;

  -- Auction platforms
  IF u ~ 'pickles\.com\.au|manheim\.com\.au|lloydsauctions\.com\.au|grays\.com|slattery\.com\.au' 
     AND u ~ '/lot|/auction|/item|/vehicle|/listing' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_AUCTION_DETAIL');
  END IF;

  -- Generic dealer stock pages (very common patterns)
  IF u ~ '/vehicle/[0-9]|/vehicles/[0-9]|/car/[0-9]|/cars/[0-9]|/listing/[0-9]|/detail/[0-9]|/stock/[0-9]' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_GENERIC_LISTING_ID');
  END IF;
  IF u ~ '/used-cars/|/used-vehicles/|/pre-owned/|/inventory/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_GENERIC_STOCK_PATH');
  END IF;

  -- Facebook Marketplace
  IF u ~ 'facebook\.com/marketplace/item/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_FB_MARKETPLACE');
  END IF;

  -- ========== CONTENT SIGNALS ==========
  -- 2+ signals = listing, 1 signal = unknown

  IF t ~ '\$[0-9,]+' THEN signals := signals + 1; END IF;
  IF t ~ '[0-9,]+\s*(km|kms|kilometres|kilometers)' THEN signals := signals + 1; END IF;
  IF t ~ 'dealer|used|for sale|selling|available now' THEN signals := signals + 1; END IF;
  IF t ~ '\b(nsw|vic|qld|wa|sa|tas|nt|act)\b|sydney|melbourne|brisbane|perth|adelaide' THEN signals := signals + 1; END IF;
  IF t ~ 'stock\s*(no|num|#)|vin|rego|registration' THEN signals := signals + 1; END IF;
  IF t ~ '(single|dual|extra)\s*cab|cab\s*chassis|ute|wagon|sedan|suv' THEN signals := signals + 1; END IF;

  IF signals >= 2 THEN
    RETURN jsonb_build_object('intent','listing','reason','CONTENT_SIGNALS_'||signals);
  ELSIF signals = 1 THEN
    RETURN jsonb_build_object('intent','unknown','reason','WEAK_SIGNALS');
  ELSE
    -- NO signals = unknown (needs verification), NOT non_listing
    RETURN jsonb_build_object('intent','unknown','reason','NO_SIGNALS');
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Fix 3: Update rpc_build_unified_candidates decision logic
-- unknown → UNVERIFIED, non_listing → IGNORE

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
      COALESCE(oraw.ext_listing_intent, (oraw.intent_result)->>'intent') AS computed_intent,
      COALESCE(oraw.ext_listing_intent_reason, (oraw.intent_result)->>'reason') AS computed_intent_reason,
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
      -- FIXED DECISION LOGIC: unknown = UNVERIFIED, non_listing = IGNORE
      CASE
        -- Non-listing pages (confirmed editorial/junk) are IGNORE
        WHEN ow.computed_intent = 'non_listing' THEN 'IGNORE'
        
        -- Unknown intent (needs verification) is UNVERIFIED - NOT IGNORE
        WHEN ow.computed_intent = 'unknown' THEN 'UNVERIFIED'
        
        -- Carsales with unknown intent is also UNVERIFIED (login required)
        WHEN ow.source_name = 'carsales' AND ow.computed_intent = 'unknown' THEN 'UNVERIFIED'
        
        -- Series mismatch when required
        WHEN v_hunt.required_series_family IS NOT NULL 
             AND ow.computed_series IS NOT NULL 
             AND UPPER(ow.computed_series) != UPPER(v_hunt.required_series_family) THEN 'IGNORE'
        -- Engine mismatch when required
        WHEN v_hunt.required_engine_family IS NOT NULL 
             AND ow.computed_engine IS NOT NULL 
             AND UPPER(ow.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'IGNORE'
        -- Body mismatch when required
        WHEN v_hunt.required_body_type IS NOT NULL 
             AND ow.computed_body IS NOT NULL 
             AND UPPER(ow.computed_body) != UPPER(v_hunt.required_body_type) THEN 'IGNORE'
        -- Badge mismatch when required
        WHEN v_hunt.required_badge IS NOT NULL 
             AND ow.computed_badge IS NOT NULL 
             AND UPPER(ow.computed_badge) != UPPER(v_hunt.required_badge) THEN 'IGNORE'
        
        -- Unknown required fields → UNVERIFIED (need enrichment)
        WHEN v_hunt.required_series_family IS NOT NULL AND ow.computed_series IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_engine_family IS NOT NULL AND ow.computed_engine IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_body_type IS NOT NULL AND ow.computed_body IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_badge IS NOT NULL AND ow.computed_badge IS NULL THEN 'UNVERIFIED'
        
        -- BUY: must be listing, verified, dna_score >= 7.0, and have price
        WHEN ow.computed_intent = 'listing' 
             AND ow.verified = true 
             AND ow.asking_price IS NOT NULL
             AND ow.dna_score >= 7.0 THEN 'BUY'
        
        -- WATCH: is a confirmed listing with some evidence
        WHEN ow.computed_intent = 'listing' AND ow.is_listing THEN 'WATCH'
        
        -- Everything else (listing intent but not verified) is UNVERIFIED
        ELSE 'UNVERIFIED'
      END AS computed_decision,
      -- FIXED BLOCKED REASON
      CASE
        WHEN ow.computed_intent = 'non_listing' THEN 'NOT_LISTING'
        WHEN ow.computed_intent = 'unknown' THEN 'UNKNOWN_INTENT'
        WHEN v_hunt.required_series_family IS NOT NULL 
             AND ow.computed_series IS NOT NULL 
             AND UPPER(ow.computed_series) != UPPER(v_hunt.required_series_family) THEN 'SERIES_MISMATCH'
        WHEN v_hunt.required_engine_family IS NOT NULL 
             AND ow.computed_engine IS NOT NULL 
             AND UPPER(ow.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'ENGINE_MISMATCH'
        WHEN v_hunt.required_body_type IS NOT NULL 
             AND ow.computed_body IS NOT NULL 
             AND UPPER(ow.computed_body) != UPPER(v_hunt.required_body_type) THEN 'BODY_MISMATCH'
        WHEN v_hunt.required_badge IS NOT NULL 
             AND ow.computed_badge IS NOT NULL 
             AND UPPER(ow.computed_badge) != UPPER(v_hunt.required_badge) THEN 'BADGE_MISMATCH'
        ELSE NULL
      END AS blocked_reason
    FROM outward_with_key ow
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
    p_hunt_id, v_hunt.criteria_version, 'outward', os.source_name, os.source_url, os.title,
    os.year, os.make, os.model, os.variant_raw, os.km, os.asking_price, os.location,
    os.dna_score, os.dna_score, os.computed_decision, os.blocked_reason,
    os.source_tier,
    CASE os.source_tier WHEN 1 THEN 'auction' WHEN 2 THEN 'marketplace' ELSE 'other' END,
    CASE os.computed_decision 
      WHEN 'BUY' THEN 100 WHEN 'WATCH' THEN 50 WHEN 'UNVERIFIED' THEN 25 ELSE 0 
    END + os.dna_score,
    os.computed_series, os.computed_engine, os.computed_body, os.computed_cab, os.computed_badge,
    os.computed_identity_key, os.computed_identity_conf,
    os.computed_intent, os.computed_intent_reason, os.verified
  FROM outward_scored os
  ON CONFLICT (hunt_id, criteria_version, url) 
  DO UPDATE SET
    decision = EXCLUDED.decision, match_score = EXCLUDED.match_score, dna_score = EXCLUDED.dna_score,
    blocked_reason = EXCLUDED.blocked_reason, series_family = EXCLUDED.series_family,
    engine_family = EXCLUDED.engine_family, body_type = EXCLUDED.body_type, badge = EXCLUDED.badge,
    listing_intent = EXCLUDED.listing_intent, updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  -- Insert INTERNAL candidates
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
      CASE
        WHEN v_hunt.required_series_family IS NOT NULL 
             AND ib.computed_series IS NOT NULL 
             AND UPPER(ib.computed_series) != UPPER(v_hunt.required_series_family) THEN 'IGNORE'
        WHEN v_hunt.required_engine_family IS NOT NULL 
             AND ib.computed_engine IS NOT NULL 
             AND UPPER(ib.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'IGNORE'
        WHEN v_hunt.required_body_type IS NOT NULL 
             AND ib.computed_body IS NOT NULL 
             AND UPPER(ib.computed_body) != UPPER(v_hunt.required_body_type) THEN 'IGNORE'
        WHEN v_hunt.required_badge IS NOT NULL 
             AND ib.computed_badge IS NOT NULL 
             AND UPPER(ib.computed_badge) != UPPER(v_hunt.required_badge) THEN 'IGNORE'
        WHEN v_hunt.required_series_family IS NOT NULL AND ib.computed_series IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_engine_family IS NOT NULL AND ib.computed_engine IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_body_type IS NOT NULL AND ib.computed_body IS NULL THEN 'UNVERIFIED'
        WHEN v_hunt.required_badge IS NOT NULL AND ib.computed_badge IS NULL THEN 'UNVERIFIED'
        WHEN ib.asking_price IS NOT NULL THEN
          CASE 
            WHEN fn_compute_outward_dna_score(
                   ib.computed_series, ib.computed_engine, ib.computed_body, ib.computed_badge,
                   ib.year, COALESCE(ib.title, '') || ' ' || COALESCE(ib.description, ''),
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
      CASE
        WHEN v_hunt.required_series_family IS NOT NULL 
             AND ib.computed_series IS NOT NULL 
             AND UPPER(ib.computed_series) != UPPER(v_hunt.required_series_family) THEN 'SERIES_MISMATCH'
        WHEN v_hunt.required_engine_family IS NOT NULL 
             AND ib.computed_engine IS NOT NULL 
             AND UPPER(ib.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'ENGINE_MISMATCH'
        WHEN v_hunt.required_body_type IS NOT NULL 
             AND ib.computed_body IS NOT NULL 
             AND UPPER(ib.computed_body) != UPPER(v_hunt.required_body_type) THEN 'BODY_MISMATCH'
        WHEN v_hunt.required_badge IS NOT NULL 
             AND ib.computed_badge IS NOT NULL 
             AND UPPER(ib.computed_badge) != UPPER(v_hunt.required_badge) THEN 'BADGE_MISMATCH'
        ELSE NULL
      END AS blocked_reason
    FROM internal_base ib
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
    p_hunt_id, v_hunt.criteria_version, 'internal', isc.source, isc.source_listing_id,
    isc.listing_url, isc.title, isc.year, isc.make, isc.model, isc.variant_raw, isc.km,
    isc.asking_price, COALESCE(isc.suburb, '') || ', ' || COALESCE(isc.state, ''),
    isc.dna_score, isc.dna_score, isc.computed_decision, isc.blocked_reason, isc.source_tier,
    CASE isc.source_tier WHEN 1 THEN 'auction' WHEN 2 THEN 'marketplace' ELSE 'other' END,
    CASE isc.computed_decision 
      WHEN 'BUY' THEN 100 WHEN 'WATCH' THEN 50 WHEN 'UNVERIFIED' THEN 25 ELSE 0 
    END + isc.dna_score,
    isc.computed_series, isc.computed_engine, isc.computed_body, isc.computed_cab, isc.computed_badge,
    isc.computed_identity_key, isc.computed_identity_conf,
    isc.computed_intent, isc.computed_intent_reason, true
  FROM internal_scored isc
  ON CONFLICT (hunt_id, criteria_version, url) 
  DO UPDATE SET decision = EXCLUDED.decision, match_score = EXCLUDED.match_score,
    dna_score = EXCLUDED.dna_score, blocked_reason = EXCLUDED.blocked_reason,
    series_family = EXCLUDED.series_family, updated_at = now();

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- Update rank positions
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY hunt_id, criteria_version
      ORDER BY 
        CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END,
        source_tier ASC, rank_score DESC, price ASC NULLS LAST
    ) AS rn
    FROM hunt_unified_candidates
    WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version
  )
  UPDATE hunt_unified_candidates huc SET rank_position = ranked.rn FROM ranked WHERE huc.id = ranked.id;

  -- Mark cheapest
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