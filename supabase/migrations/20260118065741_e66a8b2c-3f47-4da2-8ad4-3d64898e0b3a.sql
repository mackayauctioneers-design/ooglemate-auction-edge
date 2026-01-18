-- Drop all conflicting functions first
DROP FUNCTION IF EXISTS public.fn_is_verified_listing(text,text,integer,integer,text,text);
DROP FUNCTION IF EXISTS public.fn_compute_outward_dna_score(text,text,text,text,integer,text,text,text,text,text,integer,text[]);
DROP FUNCTION IF EXISTS public.fn_build_identity_key(text,text,text,text,text,text,text);

-- 3) Deterministic verified listing
CREATE OR REPLACE FUNCTION public.fn_is_verified_listing(
  p_url text, p_intent_reason text, p_price integer, p_year integer, p_make text, p_model text
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE u TEXT := LOWER(COALESCE(p_url,'')); r TEXT := COALESCE(p_intent_reason,'');
BEGIN
  IF r IN ('URL_AUCTION_DETAIL','URL_AUTOTRADER_CAR','URL_GUMTREE_SAD','URL_DRIVE_DEALER_LISTING') THEN RETURN true; END IF;
  IF u ~ 'autotrader\.com\.au/.*/car/' THEN RETURN true; END IF;
  IF u ~ 'gumtree\.com\.au/s-ad/' THEN RETURN true; END IF;
  IF u ~ 'drive\.com\.au/cars-for-sale/.*/dealer-listing/' THEN RETURN true; END IF;
  IF u ~ '(pickles\.com\.au|manheim\.com\.au|lloydsauctions\.com\.au|grays\.com|slatteryauctions\.com\.au)' AND u ~ '(/lot|/auction|/item|/vehicle|/listing|/details)' THEN RETURN true; END IF;
  IF p_price IS NOT NULL AND p_year IS NOT NULL AND p_make IS NOT NULL AND p_model IS NOT NULL THEN RETURN true; END IF;
  RETURN false;
END $$;

-- 4) DNA score
CREATE OR REPLACE FUNCTION public.fn_compute_outward_dna_score(
  p_cand_series text, p_cand_engine text, p_cand_body text, p_cand_badge text, p_cand_year integer, p_snippet text,
  p_req_series text, p_req_engine text, p_req_body text, p_req_badge text, p_hunt_year integer, p_must_have_tokens text[]
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_score numeric := 5.0; v_token text; txt text := UPPER(COALESCE(p_snippet,''));
BEGIN
  IF p_req_series IS NOT NULL AND p_cand_series IS NOT NULL AND UPPER(p_cand_series)=UPPER(p_req_series) THEN v_score := v_score + 2.0; END IF;
  IF p_req_engine IS NOT NULL AND p_cand_engine IS NOT NULL AND UPPER(p_cand_engine)=UPPER(p_req_engine) THEN v_score := v_score + 1.0; END IF;
  IF p_req_body IS NOT NULL AND p_cand_body IS NOT NULL AND UPPER(p_cand_body)=UPPER(p_req_body) THEN v_score := v_score + 1.0; END IF;
  IF p_req_badge IS NOT NULL AND p_cand_badge IS NOT NULL AND UPPER(p_cand_badge)=UPPER(p_req_badge) THEN v_score := v_score + 1.0; END IF;
  IF p_hunt_year IS NOT NULL AND p_cand_year IS NOT NULL THEN
    IF p_cand_year = p_hunt_year THEN v_score := v_score + 0.5;
    ELSIF ABS(p_cand_year - p_hunt_year) = 1 THEN v_score := v_score + 0.25; END IF;
  END IF;
  IF p_must_have_tokens IS NOT NULL AND array_length(p_must_have_tokens, 1) > 0 THEN
    FOREACH v_token IN ARRAY p_must_have_tokens LOOP
      IF txt LIKE '%' || UPPER(v_token) || '%' THEN v_score := v_score + 0.5; EXIT; END IF;
    END LOOP;
  END IF;
  RETURN LEAST(v_score, 10.0);
END $$;

-- 5) Identity key builder
CREATE OR REPLACE FUNCTION public.fn_build_identity_key(
  p_make text, p_model text, p_series text, p_badge text, p_body text, p_cab text, p_engine text
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN UPPER(COALESCE(p_make,'') || '|' || COALESCE(p_model,'') || '|' || COALESCE(p_series,'') || '|' || COALESCE(p_badge,'') || '|' || COALESCE(p_body,'') || '|' || COALESCE(p_cab,'') || '|' || COALESCE(p_engine,''));
END $$;

-- 6) FINAL BUILD RPC
CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_hunt RECORD; v_internal_count INT := 0; v_outward_count INT := 0; v_total_count INT := 0;
BEGIN
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF v_hunt IS NULL THEN RETURN jsonb_build_object('error', 'Hunt not found'); END IF;
  DELETE FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;

  WITH outward_raw AS (
    SELECT hec.*, fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet) AS intent_result,
           fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet) AS ident_result
    FROM hunt_external_candidates_v hec WHERE hec.hunt_id = p_hunt_id AND hec.criteria_version = v_hunt.criteria_version AND hec.is_stale = false
  ),
  outward_classified AS (
    SELECT oraw.*,
      CASE WHEN oraw.ext_listing_intent IS NOT NULL AND oraw.ext_listing_intent != 'unknown' THEN oraw.ext_listing_intent ELSE (oraw.intent_result)->>'intent' END AS computed_intent,
      CASE WHEN oraw.ext_listing_intent IS NOT NULL AND oraw.ext_listing_intent != 'unknown' THEN oraw.ext_listing_intent_reason ELSE (oraw.intent_result)->>'reason' END AS computed_intent_reason,
      NULLIF(COALESCE(oraw.ext_series_family, (oraw.ident_result)->>'series_family'), 'UNKNOWN') AS computed_series,
      NULLIF(COALESCE(oraw.ext_engine_family, (oraw.ident_result)->>'engine_family'), 'UNKNOWN') AS computed_engine,
      NULLIF(COALESCE(oraw.ext_body_type, (oraw.ident_result)->>'body_type'), 'UNKNOWN') AS computed_body,
      NULLIF(COALESCE(oraw.ext_cab_type, (oraw.ident_result)->>'cab_type'), 'UNKNOWN') AS computed_cab,
      NULLIF(COALESCE(oraw.ext_badge, (oraw.ident_result)->>'badge'), 'UNKNOWN') AS computed_badge,
      COALESCE(oraw.ext_identity_confidence, ((oraw.ident_result)->>'confidence')::NUMERIC) AS computed_identity_conf
    FROM outward_raw oraw
  ),
  outward_scored AS (
    SELECT oc.*, fn_build_identity_key(oc.make, oc.model, oc.computed_series, oc.computed_badge, oc.computed_body, oc.computed_cab, oc.computed_engine) AS identity_key,
      fn_compute_outward_dna_score(oc.computed_series, oc.computed_engine, oc.computed_body, oc.computed_badge, oc.year, oc.raw_snippet, v_hunt.required_series_family, v_hunt.required_engine_family, v_hunt.required_body_type, v_hunt.required_badge, v_hunt.year, v_hunt.must_have_tokens) AS dna_score,
      fn_is_verified_listing(oc.source_url, oc.computed_intent_reason, oc.asking_price, oc.year, oc.make, oc.model) AS verified,
      CASE WHEN LOWER(oc.source_name) ~ 'pickles|manheim|grays|lloyds|slattery' THEN 1 WHEN LOWER(oc.source_name) ~ 'carsales|autotrader|drive|gumtree' THEN 2 ELSE 3 END AS source_tier
    FROM outward_classified oc
  ),
  outward_final AS (
    SELECT os.*,
      CASE WHEN v_hunt.required_series_family IS NOT NULL AND os.computed_series IS NOT NULL AND UPPER(os.computed_series) != UPPER(v_hunt.required_series_family) THEN false
           WHEN v_hunt.required_engine_family IS NOT NULL AND os.computed_engine IS NOT NULL AND UPPER(os.computed_engine) != UPPER(v_hunt.required_engine_family) THEN false
           WHEN v_hunt.required_body_type IS NOT NULL AND os.computed_body IS NOT NULL AND UPPER(os.computed_body) != UPPER(v_hunt.required_body_type) THEN false
           WHEN v_hunt.required_badge IS NOT NULL AND os.computed_badge IS NOT NULL AND UPPER(os.computed_badge) != UPPER(v_hunt.required_badge) THEN false ELSE true END AS proof_gates_pass,
      CASE WHEN v_hunt.required_series_family IS NOT NULL AND os.computed_series IS NULL THEN true
           WHEN v_hunt.required_engine_family IS NOT NULL AND os.computed_engine IS NULL THEN true
           WHEN v_hunt.required_body_type IS NOT NULL AND os.computed_body IS NULL THEN true
           WHEN v_hunt.required_badge IS NOT NULL AND os.computed_badge IS NULL THEN true ELSE false END AS missing_required_fields
    FROM outward_scored os
  )
  INSERT INTO hunt_unified_candidates (hunt_id, criteria_version, source_type, source, url, title, year, make, model, variant_raw, km, price, location, match_score, dna_score, decision, blocked_reason, source_tier, source_class, rank_score, series_family, engine_family, body_type, cab_type, badge, identity_key, identity_confidence, listing_intent, listing_intent_reason, verified)
  SELECT p_hunt_id, v_hunt.criteria_version, 'outward', of.source_name, of.source_url, of.title, of.year, of.make, of.model, of.variant_raw, of.km, of.asking_price, of.location, of.dna_score, of.dna_score,
    CASE WHEN of.computed_intent = 'non_listing' THEN 'IGNORE' WHEN of.proof_gates_pass = false THEN 'IGNORE' WHEN of.computed_intent = 'unknown' THEN 'UNVERIFIED' WHEN of.missing_required_fields = true THEN 'UNVERIFIED' WHEN of.computed_intent = 'listing' AND of.verified = true AND of.asking_price IS NOT NULL AND of.dna_score >= 7.0 THEN 'BUY' WHEN of.computed_intent = 'listing' AND of.proof_gates_pass = true AND of.dna_score >= 5.0 THEN 'WATCH' WHEN of.computed_intent = 'listing' THEN 'UNVERIFIED' ELSE 'UNVERIFIED' END,
    CASE WHEN of.computed_intent = 'non_listing' THEN 'NOT_LISTING' WHEN of.proof_gates_pass = false THEN CASE WHEN v_hunt.required_series_family IS NOT NULL AND of.computed_series IS NOT NULL AND UPPER(of.computed_series) != UPPER(v_hunt.required_series_family) THEN 'SERIES_MISMATCH' ELSE 'PROOF_GATE_FAIL' END WHEN of.computed_intent = 'unknown' THEN 'UNKNOWN_INTENT' WHEN of.missing_required_fields = true THEN 'MISSING_REQUIRED_FIELD' ELSE NULL END,
    of.source_tier, CASE of.source_tier WHEN 1 THEN 'auction' WHEN 2 THEN 'marketplace' ELSE 'other' END,
    CASE WHEN of.computed_intent = 'non_listing' OR of.proof_gates_pass = false THEN 0 WHEN of.computed_intent = 'unknown' OR of.missing_required_fields = true THEN 25 WHEN of.computed_intent = 'listing' AND of.verified = true AND of.asking_price IS NOT NULL AND of.dna_score >= 7.0 THEN 100 WHEN of.computed_intent = 'listing' AND of.proof_gates_pass = true AND of.dna_score >= 5.0 THEN 50 ELSE 25 END + of.dna_score,
    of.computed_series, of.computed_engine, of.computed_body, of.computed_cab, of.computed_badge, of.identity_key, of.computed_identity_conf, of.computed_intent, of.computed_intent_reason, of.verified
  FROM outward_final of ON CONFLICT (hunt_id, criteria_version, url) DO UPDATE SET decision = EXCLUDED.decision, match_score = EXCLUDED.match_score, dna_score = EXCLUDED.dna_score, blocked_reason = EXCLUDED.blocked_reason, series_family = EXCLUDED.series_family, listing_intent = EXCLUDED.listing_intent, listing_intent_reason = EXCLUDED.listing_intent_reason, verified = EXCLUDED.verified, updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  WITH ranked AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY hunt_id, criteria_version ORDER BY CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END, source_tier ASC, price ASC NULLS LAST, dna_score DESC) AS rn FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version)
  UPDATE hunt_unified_candidates huc SET rank_position = ranked.rn FROM ranked WHERE huc.id = ranked.id;

  UPDATE hunt_unified_candidates SET is_cheapest = false WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;
  UPDATE hunt_unified_candidates SET is_cheapest = true WHERE id = (SELECT id FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version AND decision IN ('BUY','WATCH') AND price IS NOT NULL ORDER BY price ASC LIMIT 1);

  SELECT COUNT(*) INTO v_total_count FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_hunt.criteria_version;
  RETURN jsonb_build_object('internal_count', v_internal_count, 'outward_count', v_outward_count, 'total_count', v_total_count, 'criteria_version', v_hunt.criteria_version);
END $$;

-- 7) FINAL UI QUERY RPC
CREATE OR REPLACE FUNCTION public.rpc_get_unified_candidates(p_hunt_id UUID, p_decision_filter TEXT DEFAULT NULL, p_source_filter TEXT DEFAULT NULL, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS TABLE (id UUID, hunt_id UUID, criteria_version INT, source_type TEXT, source TEXT, url TEXT, title TEXT, year INT, make TEXT, model TEXT, variant_raw TEXT, km INT, price INT, location TEXT, match_score NUMERIC, dna_score NUMERIC, decision TEXT, blocked_reason TEXT, source_tier INT, source_class TEXT, rank_position INT, is_cheapest BOOLEAN, series_family TEXT, engine_family TEXT, body_type TEXT, cab_type TEXT, badge TEXT, identity_key TEXT, identity_confidence NUMERIC, listing_intent TEXT, listing_intent_reason TEXT, verified BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_criteria_version INT;
BEGIN
  SELECT sh.criteria_version INTO v_criteria_version FROM sale_hunts sh WHERE sh.id = p_hunt_id;
  RETURN QUERY SELECT huc.id, huc.hunt_id, huc.criteria_version, huc.source_type, huc.source, huc.url, huc.title, huc.year, huc.make, huc.model, huc.variant_raw, huc.km, huc.price, huc.location, huc.match_score, huc.dna_score, huc.decision, huc.blocked_reason, huc.source_tier, huc.source_class, huc.rank_position, huc.is_cheapest, huc.series_family, huc.engine_family, huc.body_type, huc.cab_type, huc.badge, huc.identity_key, huc.identity_confidence, huc.listing_intent, huc.listing_intent_reason, huc.verified, huc.created_at
  FROM hunt_unified_candidates huc WHERE huc.hunt_id = p_hunt_id AND huc.criteria_version = v_criteria_version AND (p_decision_filter IS NULL OR huc.decision = p_decision_filter) AND (p_source_filter IS NULL OR huc.source_type = p_source_filter)
  ORDER BY CASE huc.decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END, huc.source_tier ASC, huc.price ASC NULLS LAST, huc.dna_score DESC LIMIT p_limit OFFSET p_offset;
END $$;