
-- Fix rpc_build_unified_candidates to use correct sale_hunts column names
CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hunt RECORD;
  v_criteria_version INT;
  v_internal_count INT := 0;
  v_outward_count INT := 0;
  v_ignore_count INT := 0;
  v_unverified_count INT := 0;
  v_buy_count INT := 0;
  v_watch_count INT := 0;
BEGIN
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Hunt not found'); END IF;
  v_criteria_version := v_hunt.criteria_version;

  DELETE FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version;

  -- INTERNAL candidates
  INSERT INTO hunt_unified_candidates (hunt_id, criteria_version, source, source_tier, url, title, variant_raw, make, model, year, km, price, location, series_family, engine_family, body_type, cab_type, badge, identity_key, identity_confidence, identity_evidence, listing_intent, listing_intent_reason, verified, match_score, rank_score, sort_reason, decision)
  SELECT p_hunt_id, v_criteria_version, COALESCE(rl.source, 'internal'),
    CASE WHEN rl.source IN ('pickles','manheim','grays','lloyds') THEN 1 WHEN rl.source IN ('carsales','autotrader','drive','gumtree') THEN 2 ELSE 3 END,
    rl.listing_url, NULL, rl.variant_raw, rl.make, rl.model, rl.year, rl.km, rl.asking_price, COALESCE(rl.suburb, rl.state),
    COALESCE(rl.series_family, 'UNKNOWN'), 'UNKNOWN', COALESCE(rl.body_type, 'UNKNOWN'), COALESCE(rl.cab_type, 'UNKNOWN'), COALESCE(rl.badge, 'UNKNOWN'),
    fn_build_identity_key(rl.make, rl.model, rl.series_family, rl.badge, rl.body_type, rl.cab_type, NULL), 0.7, '{}'::jsonb, 'listing', 'INTERNAL', true, 7.0, 7.0, ARRAY['INTERNAL'],
    CASE
      WHEN v_hunt.required_series_family IS NOT NULL AND rl.series_family IS NOT NULL AND rl.series_family != 'UNKNOWN' AND UPPER(rl.series_family) != UPPER(v_hunt.required_series_family) THEN 'IGNORE'
      WHEN v_hunt.required_series_family IS NOT NULL AND (rl.series_family IS NULL OR rl.series_family = 'UNKNOWN') THEN 'UNVERIFIED'
      WHEN rl.asking_price IS NOT NULL THEN 'BUY' ELSE 'WATCH' END
  FROM retail_listings rl WHERE UPPER(rl.make) = UPPER(v_hunt.make) AND UPPER(rl.model) = UPPER(v_hunt.model) AND (v_hunt.year IS NULL OR rl.year = v_hunt.year) AND rl.lifecycle_status = 'active'
  ON CONFLICT (hunt_id, criteria_version, url) DO UPDATE SET updated_at = now(), decision = EXCLUDED.decision;
  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- OUTWARD candidates with DNA scoring
  INSERT INTO hunt_unified_candidates (hunt_id, criteria_version, source, source_tier, url, title, variant_raw, make, model, year, km, price, location, series_family, engine_family, body_type, cab_type, badge, identity_key, identity_confidence, identity_evidence, listing_intent, listing_intent_reason, verified, match_score, rank_score, sort_reason, decision)
  SELECT p_hunt_id, v_criteria_version, COALESCE(hec.source_name, 'outward'),
    CASE WHEN hec.source_name IN ('pickles','manheim','grays','lloyds') THEN 1 WHEN hec.source_name IN ('carsales','autotrader','drive','gumtree','facebook') THEN 2 ELSE 3 END,
    hec.source_url, hec.title, hec.variant_raw, hec.make, hec.model, hec.year, hec.km, hec.asking_price, hec.location,
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'), 'UNKNOWN'),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family'), 'UNKNOWN'),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'), 'UNKNOWN'),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'cab_type'), 'UNKNOWN'),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'), 'UNKNOWN'),
    fn_build_identity_key(hec.make, hec.model, (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'cab_type'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family')),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'confidence')::numeric, 0.3),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->'evidence'), '{}'::jsonb),
    (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent'),
    (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'reason'),
    COALESCE(hec.verified, false),
    fn_compute_outward_dna_score(v_hunt.make, v_hunt.model, v_hunt.year, v_hunt.year, v_hunt.required_series_family, NULL, NULL, NULL, v_hunt.must_have_tokens, (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family'), hec.year, hec.km, COALESCE(hec.title, '') || ' ' || COALESCE(hec.raw_snippet, '')),
    fn_compute_outward_dna_score(v_hunt.make, v_hunt.model, v_hunt.year, v_hunt.year, v_hunt.required_series_family, NULL, NULL, NULL, v_hunt.must_have_tokens, (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family'), hec.year, hec.km, COALESCE(hec.title, '') || ' ' || COALESCE(hec.raw_snippet, '')),
    ARRAY['OUTWARD'],
    CASE
      WHEN (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent') = 'non_listing' THEN 'IGNORE'
      WHEN hec.source_name = 'carsales' AND (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent') = 'unknown' THEN 'UNVERIFIED'
      WHEN v_hunt.required_series_family IS NOT NULL AND (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family') != 'UNKNOWN' AND UPPER((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family')) != UPPER(v_hunt.required_series_family) THEN 'IGNORE'
      WHEN v_hunt.required_series_family IS NOT NULL AND (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family') = 'UNKNOWN' THEN 'UNVERIFIED'
      WHEN (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent') = 'unknown' THEN 'UNVERIFIED'
      WHEN (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent') = 'listing' AND fn_compute_outward_dna_score(v_hunt.make, v_hunt.model, v_hunt.year, v_hunt.year, v_hunt.required_series_family, NULL, NULL, NULL, v_hunt.must_have_tokens, (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family'), hec.year, hec.km, COALESCE(hec.title, '') || ' ' || COALESCE(hec.raw_snippet, '')) >= 7.0 AND COALESCE(hec.verified, false) = true AND hec.asking_price IS NOT NULL THEN 'BUY'
      WHEN (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent') = 'listing' AND fn_compute_outward_dna_score(v_hunt.make, v_hunt.model, v_hunt.year, v_hunt.year, v_hunt.required_series_family, NULL, NULL, NULL, v_hunt.must_have_tokens, (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'), (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family'), hec.year, hec.km, COALESCE(hec.title, '') || ' ' || COALESCE(hec.raw_snippet, '')) >= 5.0 THEN 'WATCH'
      ELSE 'UNVERIFIED' END
  FROM hunt_external_candidates hec WHERE hec.hunt_id = p_hunt_id AND hec.criteria_version = v_criteria_version AND hec.is_stale = false
  ON CONFLICT (hunt_id, criteria_version, url) DO UPDATE SET updated_at = now(), decision = EXCLUDED.decision, match_score = EXCLUDED.match_score, rank_score = EXCLUDED.rank_score, series_family = EXCLUDED.series_family, listing_intent = EXCLUDED.listing_intent;
  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  SELECT COUNT(*) INTO v_ignore_count FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'IGNORE';
  SELECT COUNT(*) INTO v_unverified_count FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'UNVERIFIED';
  SELECT COUNT(*) INTO v_buy_count FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'BUY';
  SELECT COUNT(*) INTO v_watch_count FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'WATCH';

  RETURN jsonb_build_object('hunt_id', p_hunt_id, 'criteria_version', v_criteria_version, 'internal_count', v_internal_count, 'outward_count', v_outward_count, 'buy_count', v_buy_count, 'watch_count', v_watch_count, 'unverified_count', v_unverified_count, 'ignore_count', v_ignore_count);
END $$;
