-- Fix 1: Add "79Ser" pattern to fn_classify_vehicle_identity
CREATE OR REPLACE FUNCTION public.fn_classify_vehicle_identity(
  p_make TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_variant_raw TEXT DEFAULT NULL,
  p_url TEXT DEFAULT NULL,
  p_text TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  x TEXT := UPPER(COALESCE(p_make,'')||' '||COALESCE(p_model,'')||' '||COALESCE(p_variant_raw,'')||' '||COALESCE(p_url,'')||' '||COALESCE(p_text,''));
  series TEXT := NULL;  -- Changed from 'UNKNOWN' to NULL for proper gating
  engine TEXT := NULL;
  body TEXT := NULL;
  cab TEXT := NULL;
  badge TEXT := NULL;
  conf NUMERIC(4,3) := 0.30;
  ev JSONB := '{}'::jsonb;
  lc70 INT := 0;
  lc300 INT := 0;
BEGIN
  -- Series scoring: LC70 signals
  IF x ~ '70\s*SERIES|LC70|LC\s*70' THEN lc70 := lc70 + 2; END IF;
  IF x ~ 'VDJ7[0-9]|VDJ76|VDJ78|VDJ79' THEN lc70 := lc70 + 3; END IF;
  IF x ~ 'GDJ7[0-9]|GDJ76|GDJ78|GDJ79' THEN lc70 := lc70 + 3; END IF;
  IF x ~ 'HZJ7[0-9]|FJ7[0-9]' THEN lc70 := lc70 + 3; END IF;
  IF x ~ 'TROOP(Y|CARRIER)|TROOPCARRIER' THEN lc70 := lc70 + 2; END IF;
  IF x ~ '/LC79|/LC78|/LC76|/LC70|/70-SERIES' THEN lc70 := lc70 + 2; END IF;
  -- NEW: Add 79Ser, 76Ser, 78Ser patterns
  IF x ~ '79\s*SER|78\s*SER|76\s*SER|79SER|78SER|76SER' THEN lc70 := lc70 + 3; END IF;
  IF x ~ '\b79\b|\b78\b|\b76\b' AND x ~ 'LANDCRUISER|LAND\s*CRUISER|CRUISER' THEN lc70 := lc70 + 2; END IF;

  -- LC300 signals
  IF x ~ '300\s*SERIES|LC300|LC\s*300' THEN lc300 := lc300 + 2; END IF;
  IF x ~ 'FJA300|VJA300|GRJ300' THEN lc300 := lc300 + 3; END IF;
  IF x ~ 'GR\s*SPORT|GRSPORT|ZX' THEN lc300 := lc300 + 2; END IF;
  IF x ~ '/LC300|/300-SERIES' THEN lc300 := lc300 + 2; END IF;

  IF UPPER(COALESCE(p_make,''))='TOYOTA' AND x ~ 'LANDCRUISER|LAND\s*CRUISER|CRUISER' THEN
    IF lc70 > lc300 AND lc70 >= 2 THEN series := 'LC70'; conf := LEAST(0.95, 0.50 + lc70*0.08); END IF;
    IF lc300 > lc70 AND lc300 >= 2 THEN series := 'LC300'; conf := LEAST(0.95, 0.50 + lc300*0.08); END IF;
  END IF;

  -- Engine family
  IF x ~ 'VDJ|1VD|V8|4\.5' THEN engine := 'V8_4.5TD'; END IF;
  IF x ~ 'GDJ|2\.8' THEN engine := 'I4_2.8TD'; END IF;
  IF x ~ 'GRJ|4\.0' THEN engine := 'V6_4.0'; END IF;

  -- Body / cab
  IF x ~ 'CAB\s*CHASSIS|CABCHASSIS' THEN body := 'CAB_CHASSIS'; END IF;
  IF x ~ 'WAGON' AND body IS NULL THEN body := 'WAGON'; END IF;
  IF x ~ 'DUAL\s*CAB|DOUBLE\s*CAB|D/CAB|DCAB' THEN cab := 'DUAL'; END IF;
  IF x ~ 'SINGLE\s*CAB|S/CAB|SCAB' THEN cab := 'SINGLE'; END IF;

  -- Badge basics
  IF x ~ '\bGXL\b' THEN badge := 'GXL'; END IF;
  IF x ~ 'WORKMATE' THEN badge := 'WORKMATE'; END IF;
  IF x ~ '\bGX\b' AND badge IS NULL THEN badge := 'GX'; END IF;

  ev := jsonb_build_object(
    'lc70_score', lc70,
    'lc300_score', lc300
  );

  RETURN jsonb_build_object(
    'series_family', series,  -- NULL if unknown, not 'UNKNOWN'
    'engine_family', engine,
    'body_type', body,
    'cab_type', cab,
    'badge', badge,
    'confidence', conf,
    'evidence', ev
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Fix 2: Update rpc_build_unified_candidates to treat NULL as missing (UNVERIFIED) not mismatch
-- The proof_gates_pass logic was correct but UNKNOWN string comparison was wrong
-- Now that classifier returns NULL for unknown, the missing_required_fields check works correctly

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
      -- Use NULLIF to convert 'UNKNOWN' strings to NULL for proper gating
      NULLIF(COALESCE(oraw.ext_series_family, (oraw.ident_result)->>'series_family'), 'UNKNOWN') AS computed_series,
      NULLIF(COALESCE(oraw.ext_engine_family, (oraw.ident_result)->>'engine_family'), 'UNKNOWN') AS computed_engine,
      NULLIF(COALESCE(oraw.ext_body_type, (oraw.ident_result)->>'body_type'), 'UNKNOWN') AS computed_body,
      NULLIF(COALESCE(oraw.ext_cab_type, (oraw.ident_result)->>'cab_type'), 'UNKNOWN') AS computed_cab,
      NULLIF(COALESCE(oraw.ext_badge, (oraw.ident_result)->>'badge'), 'UNKNOWN') AS computed_badge,
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
        WHEN LOWER(oc.source_name) ~ 'pickles|manheim|grays|lloyds|slattery' THEN 1
        WHEN LOWER(oc.source_name) ~ 'carsales|autotrader|drive|gumtree' THEN 2
        ELSE 3
      END AS source_tier
    FROM outward_classified oc
  ),
  outward_scored AS (
    SELECT
      ow.*,
      fn_is_verified_listing(ow.source_url, ow.computed_intent_reason, ow.asking_price, ow.year, ow.make, ow.model) AS computed_verified,
      -- Proof gates: only fails if both are NOT NULL and differ
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
      -- Missing fields: required is set but value is NULL
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
      CASE
        WHEN os.computed_intent = 'non_listing' THEN 'IGNORE'
        WHEN os.proof_gates_pass = false THEN 'IGNORE'
        WHEN os.computed_intent = 'unknown' THEN 'UNVERIFIED'
        WHEN os.missing_required_fields = true THEN 'UNVERIFIED'
        WHEN os.computed_intent = 'listing' AND os.computed_verified = true AND os.asking_price IS NOT NULL AND os.dna_score >= 7.0 THEN 'BUY'
        WHEN os.computed_intent = 'listing' AND os.proof_gates_pass = true AND os.dna_score >= 5.0 THEN 'WATCH'
        WHEN os.computed_intent = 'listing' THEN 'UNVERIFIED'
        ELSE 'UNVERIFIED'
      END AS computed_decision,
      CASE
        WHEN os.computed_intent = 'non_listing' THEN 'NOT_LISTING'
        WHEN os.proof_gates_pass = false THEN
          CASE
            WHEN v_hunt.required_series_family IS NOT NULL AND os.computed_series IS NOT NULL AND UPPER(os.computed_series) != UPPER(v_hunt.required_series_family) THEN 'SERIES_MISMATCH'
            WHEN v_hunt.required_engine_family IS NOT NULL AND os.computed_engine IS NOT NULL AND UPPER(os.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'ENGINE_MISMATCH'
            WHEN v_hunt.required_body_type IS NOT NULL AND os.computed_body IS NOT NULL AND UPPER(os.computed_body) != UPPER(v_hunt.required_body_type) THEN 'BODY_MISMATCH'
            WHEN v_hunt.required_badge IS NOT NULL AND os.computed_badge IS NOT NULL AND UPPER(os.computed_badge) != UPPER(v_hunt.required_badge) THEN 'BADGE_MISMATCH'
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
    CASE of.computed_decision WHEN 'BUY' THEN 100 WHEN 'WATCH' THEN 50 WHEN 'UNVERIFIED' THEN 25 ELSE 0 END + of.dna_score,
    of.computed_series, of.computed_engine, of.computed_body, of.computed_cab, of.computed_badge,
    of.computed_identity_key, of.computed_identity_conf,
    of.computed_intent, of.computed_intent_reason, of.computed_verified
  FROM outward_final of
  ON CONFLICT (hunt_id, criteria_version, url) 
  DO UPDATE SET decision = EXCLUDED.decision, match_score = EXCLUDED.match_score, dna_score = EXCLUDED.dna_score,
    blocked_reason = EXCLUDED.blocked_reason, series_family = EXCLUDED.series_family,
    engine_family = EXCLUDED.engine_family, body_type = EXCLUDED.body_type, badge = EXCLUDED.badge,
    listing_intent = EXCLUDED.listing_intent, listing_intent_reason = EXCLUDED.listing_intent_reason,
    verified = EXCLUDED.verified, updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  -- INTERNAL candidates
  WITH internal_base AS (
    SELECT rl.*,
      NULLIF(rl.series_family, 'UNKNOWN') AS computed_series,
      NULLIF(rl.engine_family, 'UNKNOWN') AS computed_engine,
      NULLIF(rl.body_type, 'UNKNOWN') AS computed_body,
      NULLIF(rl.cab_type, 'UNKNOWN') AS computed_cab,
      NULLIF(rl.badge, 'UNKNOWN') AS computed_badge,
      rl.identity_key AS computed_identity_key, rl.identity_confidence AS computed_identity_conf,
      COALESCE(rl.listing_intent, 'listing') AS computed_intent,
      rl.listing_intent_reason AS computed_intent_reason,
      CASE
        WHEN LOWER(rl.source) ~ 'pickles|manheim|grays|lloyds|slattery' THEN 1
        WHEN LOWER(rl.source) ~ 'carsales|autotrader|drive|gumtree' THEN 2
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
        WHEN v_hunt.required_series_family IS NOT NULL AND ib.computed_series IS NOT NULL AND UPPER(ib.computed_series) != UPPER(v_hunt.required_series_family) THEN false
        WHEN v_hunt.required_engine_family IS NOT NULL AND ib.computed_engine IS NOT NULL AND UPPER(ib.computed_engine) != UPPER(v_hunt.required_engine_family) THEN false
        WHEN v_hunt.required_body_type IS NOT NULL AND ib.computed_body IS NOT NULL AND UPPER(ib.computed_body) != UPPER(v_hunt.required_body_type) THEN false
        WHEN v_hunt.required_badge IS NOT NULL AND ib.computed_badge IS NOT NULL AND UPPER(ib.computed_badge) != UPPER(v_hunt.required_badge) THEN false
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
    SELECT isc.*,
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
            WHEN v_hunt.required_series_family IS NOT NULL AND isc.computed_series IS NOT NULL AND UPPER(isc.computed_series) != UPPER(v_hunt.required_series_family) THEN 'SERIES_MISMATCH'
            WHEN v_hunt.required_engine_family IS NOT NULL AND isc.computed_engine IS NOT NULL AND UPPER(isc.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'ENGINE_MISMATCH'
            WHEN v_hunt.required_body_type IS NOT NULL AND isc.computed_body IS NOT NULL AND UPPER(isc.computed_body) != UPPER(v_hunt.required_body_type) THEN 'BODY_MISMATCH'
            WHEN v_hunt.required_badge IS NOT NULL AND isc.computed_badge IS NOT NULL AND UPPER(isc.computed_badge) != UPPER(v_hunt.required_badge) THEN 'BADGE_MISMATCH'
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
    CASE inf.computed_decision WHEN 'BUY' THEN 100 WHEN 'WATCH' THEN 50 WHEN 'UNVERIFIED' THEN 25 ELSE 0 END + inf.dna_score,
    inf.computed_series, inf.computed_engine, inf.computed_body, inf.computed_cab, inf.computed_badge,
    inf.computed_identity_key, inf.computed_identity_conf,
    inf.computed_intent, inf.computed_intent_reason, true
  FROM internal_final inf
  ON CONFLICT (hunt_id, criteria_version, url) 
  DO UPDATE SET decision = EXCLUDED.decision, match_score = EXCLUDED.match_score,
    dna_score = EXCLUDED.dna_score, blocked_reason = EXCLUDED.blocked_reason,
    series_family = EXCLUDED.series_family, verified = EXCLUDED.verified, updated_at = now();

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY hunt_id, criteria_version
      ORDER BY 
        CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END,
        source_tier ASC, price ASC NULLS LAST, dna_score DESC
    ) AS rn
    FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version
  )
  UPDATE hunt_unified_candidates huc SET rank_position = ranked.rn FROM ranked WHERE huc.id = ranked.id;

  UPDATE hunt_unified_candidates SET is_cheapest = false WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;
  UPDATE hunt_unified_candidates SET is_cheapest = true
  WHERE id = (SELECT id FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version AND decision IN ('BUY', 'WATCH') AND price IS NOT NULL ORDER BY price ASC LIMIT 1);

  SELECT COUNT(*) INTO v_total_count FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;

  RETURN jsonb_build_object('internal_count', v_internal_count, 'outward_count', v_outward_count, 'total_count', v_total_count, 'criteria_version', v_hunt.criteria_version);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;