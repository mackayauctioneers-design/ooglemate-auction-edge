-- Fix ambiguous "verified" column reference in rpc_build_unified_candidates
-- The issue is both the function output and table have "verified" column

CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

  /* -------------------------
     OUTWARD PIPELINE
     ------------------------- */
  WITH outward_raw AS (
    SELECT
      hec.*,
      fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet) AS intent_result,
      fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet) AS ident_result
    FROM hunt_external_candidates hec
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

      NULLIF(COALESCE(oraw.ext_series_family, (oraw.ident_result)->>'series_family'), 'UNKNOWN') AS computed_series,
      NULLIF(COALESCE(oraw.ext_engine_family, (oraw.ident_result)->>'engine_family'), 'UNKNOWN') AS computed_engine,
      NULLIF(COALESCE(oraw.ext_body_type,   (oraw.ident_result)->>'body_type'),   'UNKNOWN') AS computed_body,
      NULLIF(COALESCE(oraw.ext_cab_type,    (oraw.ident_result)->>'cab_type'),    'UNKNOWN') AS computed_cab,
      NULLIF(COALESCE(oraw.ext_badge,       (oraw.ident_result)->>'badge'),       'UNKNOWN') AS computed_badge,

      COALESCE(oraw.ext_identity_confidence, ((oraw.ident_result)->>'confidence')::NUMERIC) AS computed_identity_conf
    FROM outward_raw oraw
  ),
  outward_scored AS (
    SELECT
      oc.*,
      fn_build_identity_key(oc.make, oc.model, oc.computed_series, oc.computed_badge, oc.computed_body, oc.computed_cab, oc.computed_engine) AS computed_identity_key,
      fn_compute_outward_dna_score(
        oc.computed_series, oc.computed_engine, oc.computed_body, oc.computed_badge,
        oc.year, oc.raw_snippet,
        v_hunt.required_series_family, v_hunt.required_engine_family, v_hunt.required_body_type, v_hunt.required_badge,
        v_hunt.year, v_hunt.must_have_tokens
      ) AS dna_score,
      fn_is_verified_listing(oc.source_url, oc.computed_intent_reason, oc.asking_price, oc.year, oc.make, oc.model) AS is_verified,
      CASE
        WHEN LOWER(oc.source_name) ~ 'pickles|manheim|grays|lloyds|slattery' THEN 1
        WHEN LOWER(oc.source_name) ~ 'carsales|autotrader|drive|gumtree' THEN 2
        ELSE 3
      END AS computed_source_tier
    FROM outward_classified oc
  ),
  outward_final AS (
    SELECT
      os.*,
      CASE
        WHEN v_hunt.required_series_family IS NOT NULL AND os.computed_series IS NOT NULL AND UPPER(os.computed_series) != UPPER(v_hunt.required_series_family) THEN false
        WHEN v_hunt.required_engine_family IS NOT NULL AND os.computed_engine IS NOT NULL AND UPPER(os.computed_engine) != UPPER(v_hunt.required_engine_family) THEN false
        WHEN v_hunt.required_body_type   IS NOT NULL AND os.computed_body   IS NOT NULL AND UPPER(os.computed_body)   != UPPER(v_hunt.required_body_type)   THEN false
        WHEN v_hunt.required_badge       IS NOT NULL AND os.computed_badge  IS NOT NULL AND UPPER(os.computed_badge)  != UPPER(v_hunt.required_badge)       THEN false
        ELSE true
      END AS proof_gates_pass,
      CASE
        WHEN v_hunt.required_series_family IS NOT NULL AND os.computed_series IS NULL THEN true
        WHEN v_hunt.required_engine_family IS NOT NULL AND os.computed_engine IS NULL THEN true
        WHEN v_hunt.required_body_type   IS NOT NULL AND os.computed_body   IS NULL THEN true
        WHEN v_hunt.required_badge       IS NOT NULL AND os.computed_badge  IS NULL THEN true
        ELSE false
      END AS missing_required_fields
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
    p_hunt_id,
    v_hunt.criteria_version,
    'outward',
    of.source_name,
    of.source_url,
    of.title,
    of.year, of.make, of.model, of.variant_raw, of.km,
    of.asking_price,
    of.location,
    of.dna_score,
    of.dna_score,

    /* Decision with WATCH fallback */
    CASE
      WHEN of.computed_intent = 'non_listing' THEN 'IGNORE'
      WHEN of.proof_gates_pass = false THEN 'IGNORE'
      WHEN of.computed_intent = 'unknown' THEN 'UNVERIFIED'
      WHEN of.missing_required_fields = true THEN 'UNVERIFIED'
      WHEN of.computed_intent = 'listing' AND of.is_verified = true AND of.asking_price IS NOT NULL AND of.dna_score >= 7.0 THEN 'BUY'
      WHEN of.computed_intent = 'listing' AND of.proof_gates_pass = true AND of.dna_score >= 5.0 THEN 'WATCH'
      WHEN of.computed_intent = 'listing' THEN 'UNVERIFIED'
      ELSE 'UNVERIFIED'
    END,

    /* blocked_reason */
    CASE
      WHEN of.computed_intent = 'non_listing' THEN 'NOT_LISTING'
      WHEN of.proof_gates_pass = false THEN
        CASE
          WHEN v_hunt.required_series_family IS NOT NULL AND of.computed_series IS NOT NULL AND UPPER(of.computed_series) != UPPER(v_hunt.required_series_family) THEN 'SERIES_MISMATCH'
          WHEN v_hunt.required_engine_family IS NOT NULL AND of.computed_engine IS NOT NULL AND UPPER(of.computed_engine) != UPPER(v_hunt.required_engine_family) THEN 'ENGINE_MISMATCH'
          WHEN v_hunt.required_body_type   IS NOT NULL AND of.computed_body   IS NOT NULL AND UPPER(of.computed_body)   != UPPER(v_hunt.required_body_type)   THEN 'BODY_MISMATCH'
          WHEN v_hunt.required_badge       IS NOT NULL AND of.computed_badge  IS NOT NULL AND UPPER(of.computed_badge)  != UPPER(v_hunt.required_badge)       THEN 'BADGE_MISMATCH'
          ELSE 'PROOF_GATE_FAIL'
        END
      WHEN of.computed_intent = 'unknown' THEN 'UNKNOWN_INTENT'
      WHEN of.missing_required_fields = true THEN 'MISSING_REQUIRED_FIELD'
      ELSE NULL
    END,

    of.computed_source_tier,
    CASE of.computed_source_tier WHEN 1 THEN 'auction' WHEN 2 THEN 'marketplace' ELSE 'other' END,

    /* rank_score for ordering */
    CASE
      WHEN of.computed_intent = 'non_listing' OR of.proof_gates_pass = false THEN 0
      WHEN of.computed_intent = 'listing' AND of.is_verified = true AND of.asking_price IS NOT NULL AND of.dna_score >= 7.0 THEN 100 + of.dna_score
      WHEN of.computed_intent = 'listing' AND of.proof_gates_pass = true AND of.dna_score >= 5.0 THEN 50 + of.dna_score
      ELSE 25 + of.dna_score
    END,

    of.computed_series, of.computed_engine, of.computed_body, of.computed_cab, of.computed_badge,
    of.computed_identity_key, of.computed_identity_conf,
    of.computed_intent, of.computed_intent_reason, of.is_verified
  FROM outward_final of
  ON CONFLICT (hunt_id, criteria_version, url) DO UPDATE SET
    decision = EXCLUDED.decision,
    match_score = EXCLUDED.match_score,
    dna_score = EXCLUDED.dna_score,
    blocked_reason = EXCLUDED.blocked_reason,
    series_family = EXCLUDED.series_family,
    engine_family = EXCLUDED.engine_family,
    body_type = EXCLUDED.body_type,
    badge = EXCLUDED.badge,
    listing_intent = EXCLUDED.listing_intent,
    listing_intent_reason = EXCLUDED.listing_intent_reason,
    verified = EXCLUDED.verified,
    updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  /* -------------------------
     INTERNAL PIPELINE (retail_listings)
     ------------------------- */
  WITH internal_raw AS (
    SELECT
      vl.id AS listing_id,
      vl.source_url,
      vl.source_name,
      vl.title,
      vl.year,
      vl.make,
      vl.model,
      vl.variant_raw,
      vl.km,
      vl.price,
      vl.location,
      vl.series_family AS vl_series,
      vl.engine_family AS vl_engine,
      vl.body_type AS vl_body,
      vl.cab_type AS vl_cab,
      vl.badge AS vl_badge,
      fn_classify_vehicle_identity(vl.make, vl.model, vl.variant_raw, vl.source_url, vl.title) AS ident_result
    FROM vehicle_listings vl
    WHERE vl.status = 'active'
      AND UPPER(vl.make) = UPPER(v_hunt.make)
      AND UPPER(vl.model) = UPPER(v_hunt.model)
      AND (v_hunt.year_min IS NULL OR vl.year >= v_hunt.year_min)
      AND (v_hunt.year_max IS NULL OR vl.year <= v_hunt.year_max)
    LIMIT 500
  ),
  internal_classified AS (
    SELECT
      ir.*,
      COALESCE(ir.vl_series, (ir.ident_result)->>'series_family') AS computed_series,
      COALESCE(ir.vl_engine, (ir.ident_result)->>'engine_family') AS computed_engine,
      COALESCE(ir.vl_body, (ir.ident_result)->>'body_type') AS computed_body,
      COALESCE(ir.vl_cab, (ir.ident_result)->>'cab_type') AS computed_cab,
      COALESCE(ir.vl_badge, (ir.ident_result)->>'badge') AS computed_badge,
      COALESCE(((ir.ident_result)->>'confidence')::NUMERIC, 0.5) AS computed_identity_conf
    FROM internal_raw ir
  ),
  internal_scored AS (
    SELECT
      ic.*,
      fn_build_identity_key(ic.make, ic.model, ic.computed_series, ic.computed_badge, ic.computed_body, ic.computed_cab, ic.computed_engine) AS computed_identity_key,
      fn_compute_outward_dna_score(
        ic.computed_series, ic.computed_engine, ic.computed_body, ic.computed_badge,
        ic.year, ic.title,
        v_hunt.required_series_family, v_hunt.required_engine_family, v_hunt.required_body_type, v_hunt.required_badge,
        v_hunt.year, v_hunt.must_have_tokens
      ) AS dna_score,
      CASE
        WHEN LOWER(ic.source_name) ~ 'pickles|manheim|grays|lloyds|slattery' THEN 1
        WHEN LOWER(ic.source_name) ~ 'carsales|autotrader|drive|gumtree' THEN 2
        ELSE 3
      END AS computed_source_tier
    FROM internal_classified ic
  ),
  internal_final AS (
    SELECT
      ins.*,
      CASE
        WHEN v_hunt.required_series_family IS NOT NULL AND ins.computed_series IS NOT NULL AND UPPER(ins.computed_series) != UPPER(v_hunt.required_series_family) THEN false
        ELSE true
      END AS proof_gates_pass
    FROM internal_scored ins
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
    'internal',
    inf.source_name,
    inf.source_url,
    inf.title,
    inf.year, inf.make, inf.model, inf.variant_raw, inf.km,
    inf.price,
    inf.location,
    inf.dna_score,
    inf.dna_score,
    CASE
      WHEN inf.proof_gates_pass = false THEN 'IGNORE'
      WHEN inf.price IS NOT NULL AND inf.dna_score >= 7.0 THEN 'BUY'
      WHEN inf.dna_score >= 5.0 THEN 'WATCH'
      ELSE 'UNVERIFIED'
    END,
    CASE WHEN inf.proof_gates_pass = false THEN 'SERIES_MISMATCH' ELSE NULL END,
    inf.computed_source_tier,
    CASE inf.computed_source_tier WHEN 1 THEN 'auction' WHEN 2 THEN 'marketplace' ELSE 'other' END,
    CASE
      WHEN inf.proof_gates_pass = false THEN 0
      WHEN inf.price IS NOT NULL AND inf.dna_score >= 7.0 THEN 100 + inf.dna_score
      WHEN inf.dna_score >= 5.0 THEN 50 + inf.dna_score
      ELSE 25 + inf.dna_score
    END,
    inf.computed_series, inf.computed_engine, inf.computed_body, inf.computed_cab, inf.computed_badge,
    inf.computed_identity_key, inf.computed_identity_conf,
    'listing', 'INTERNAL_LISTING', true
  FROM internal_final inf
  ON CONFLICT (hunt_id, criteria_version, url) DO UPDATE SET
    decision = EXCLUDED.decision,
    match_score = EXCLUDED.match_score,
    dna_score = EXCLUDED.dna_score,
    blocked_reason = EXCLUDED.blocked_reason,
    updated_at = now();

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- Update rank_position
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
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
  UPDATE hunt_unified_candidates huc
  SET rank_position = ranked.rn
  FROM ranked
  WHERE huc.id = ranked.id;

  -- Mark cheapest in BUY/WATCH
  UPDATE hunt_unified_candidates
  SET is_cheapest = false
  WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;

  UPDATE hunt_unified_candidates
  SET is_cheapest = true
  WHERE id = (
    SELECT id
    FROM hunt_unified_candidates
    WHERE hunt_id = p_hunt_id
      AND criteria_version = v_hunt.criteria_version
      AND decision IN ('BUY','WATCH')
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
END $$;