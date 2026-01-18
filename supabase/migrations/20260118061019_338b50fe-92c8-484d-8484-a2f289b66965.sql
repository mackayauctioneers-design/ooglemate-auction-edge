
-- Fix 1: Create helper function to compute outward DNA score
CREATE OR REPLACE FUNCTION public.fn_compute_outward_dna_score(
  p_hunt_make TEXT,
  p_hunt_model TEXT,
  p_hunt_year_min INT,
  p_hunt_year_max INT,
  p_hunt_required_series TEXT,
  p_hunt_required_badge TEXT,
  p_hunt_required_body TEXT,
  p_hunt_required_engine TEXT,
  p_hunt_must_have_tokens TEXT[],
  p_cand_series TEXT,
  p_cand_badge TEXT,
  p_cand_body TEXT,
  p_cand_engine TEXT,
  p_cand_year INT,
  p_cand_km INT,
  p_cand_text TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  score NUMERIC := 5.0;
  txt TEXT := UPPER(COALESCE(p_cand_text, ''));
  token TEXT;
BEGIN
  -- Series match: +2.0 if matches required or hunt series
  IF p_hunt_required_series IS NOT NULL THEN
    IF UPPER(COALESCE(p_cand_series, '')) = UPPER(p_hunt_required_series) THEN
      score := score + 2.0;
    END IF;
  END IF;

  -- Badge match: +1.0 when known and matches
  IF p_hunt_required_badge IS NOT NULL AND p_cand_badge IS NOT NULL 
     AND p_cand_badge != 'UNKNOWN' THEN
    IF UPPER(p_cand_badge) = UPPER(p_hunt_required_badge) THEN
      score := score + 1.0;
    END IF;
  END IF;

  -- Body match: +1.0 when known and matches
  IF p_hunt_required_body IS NOT NULL AND p_cand_body IS NOT NULL 
     AND p_cand_body != 'UNKNOWN' THEN
    IF UPPER(p_cand_body) = UPPER(p_hunt_required_body) THEN
      score := score + 1.0;
    END IF;
  END IF;

  -- Engine match: +0.5 when known and matches
  IF p_hunt_required_engine IS NOT NULL AND p_cand_engine IS NOT NULL 
     AND p_cand_engine != 'UNKNOWN' THEN
    IF UPPER(p_cand_engine) = UPPER(p_hunt_required_engine) THEN
      score := score + 0.5;
    END IF;
  END IF;

  -- Year closeness: +0.5 if within ±1 of hunt range
  IF p_cand_year IS NOT NULL AND p_hunt_year_min IS NOT NULL AND p_hunt_year_max IS NOT NULL THEN
    IF p_cand_year >= (p_hunt_year_min - 1) AND p_cand_year <= (p_hunt_year_max + 1) THEN
      score := score + 0.5;
    END IF;
  END IF;

  -- Must-have token hits: +0.5 for any hit
  IF p_hunt_must_have_tokens IS NOT NULL AND array_length(p_hunt_must_have_tokens, 1) > 0 THEN
    FOREACH token IN ARRAY p_hunt_must_have_tokens LOOP
      IF txt LIKE '%' || UPPER(token) || '%' THEN
        score := score + 0.5;
        EXIT; -- Only count once
      END IF;
    END LOOP;
  END IF;

  -- Cap at 10
  RETURN LEAST(score, 10.0);
END $$;

-- Fix 2: Update rpc_build_unified_candidates with proper BUY qualification and DNA scoring
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
  -- Get hunt details
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;
  
  v_criteria_version := v_hunt.criteria_version;

  -- Clear existing candidates for this hunt/version
  DELETE FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version;

  -- Insert INTERNAL candidates (from retail_listings matching hunt criteria)
  INSERT INTO hunt_unified_candidates (
    hunt_id, criteria_version, source, source_tier, url, title, snippet,
    make, model, year, km, asking_price, location, state,
    series_family, engine_family, body_type, cab_type, badge,
    identity_key, identity_confidence, identity_evidence,
    listing_intent, listing_intent_reason, verified,
    match_score, rank_score, sort_reason, decision
  )
  SELECT 
    p_hunt_id,
    v_criteria_version,
    COALESCE(rl.source_name, 'internal'),
    CASE
      WHEN rl.source_name IN ('pickles','manheim','grays','lloyds') OR rl.auction_house IS NOT NULL THEN 1
      WHEN rl.source_name IN ('carsales','autotrader','drive','gumtree','gumtree_dealer') THEN 2
      ELSE 3
    END,
    rl.listing_url,
    rl.title,
    rl.description,
    rl.make,
    rl.model,
    rl.year,
    rl.km,
    rl.asking_price,
    rl.location,
    rl.state,
    COALESCE(rl.series_family, 'UNKNOWN'),
    COALESCE(rl.engine_family, 'UNKNOWN'),
    COALESCE(rl.body_type, 'UNKNOWN'),
    COALESCE(rl.cab_type, 'UNKNOWN'),
    COALESCE(rl.badge, 'UNKNOWN'),
    fn_build_identity_key(rl.make, rl.model, rl.series_family, rl.badge, rl.body_type, rl.cab_type, rl.engine_family),
    COALESCE(rl.identity_confidence, 0.5),
    COALESCE(rl.identity_evidence, '{}'::jsonb),
    COALESCE(rl.listing_intent, 'listing'),
    rl.listing_intent_reason,
    true, -- Internal listings are verified
    COALESCE(rl.match_score, 7.0), -- Internal listings have proper match scores
    COALESCE(rl.match_score, 7.0),
    ARRAY['INTERNAL'],
    -- Decision logic for internal: stricter BUY rules
    CASE
      -- Must be a listing
      WHEN COALESCE(rl.listing_intent, 'listing') != 'listing' THEN 'IGNORE'
      -- Series mismatch check
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND rl.series_family IS NOT NULL 
           AND rl.series_family != 'UNKNOWN'
           AND UPPER(rl.series_family) != UPPER(v_hunt.required_series_family) THEN 'IGNORE'
      -- Unknown required fields = UNVERIFIED
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (rl.series_family IS NULL OR rl.series_family = 'UNKNOWN') THEN 'UNVERIFIED'
      -- BUY: listing + match_score >= 7.0 + has price
      WHEN COALESCE(rl.match_score, 0) >= 7.0 
           AND rl.asking_price IS NOT NULL THEN 'BUY'
      -- WATCH: listing + match_score >= 5.0
      WHEN COALESCE(rl.match_score, 0) >= 5.0 THEN 'WATCH'
      -- Everything else is UNVERIFIED
      ELSE 'UNVERIFIED'
    END
  FROM retail_listings rl
  WHERE UPPER(rl.make) = UPPER(v_hunt.make)
    AND UPPER(rl.model) = UPPER(v_hunt.model)
    AND (v_hunt.year_min IS NULL OR rl.year >= v_hunt.year_min)
    AND (v_hunt.year_max IS NULL OR rl.year <= v_hunt.year_max)
    AND rl.status = 'active'
  ON CONFLICT (hunt_id, criteria_version, url) DO UPDATE SET
    updated_at = now(),
    decision = EXCLUDED.decision,
    match_score = EXCLUDED.match_score;

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- Insert OUTWARD candidates with proper DNA scoring and decision logic
  INSERT INTO hunt_unified_candidates (
    hunt_id, criteria_version, source, source_tier, url, title, snippet,
    make, model, year, km, asking_price, location, state,
    series_family, engine_family, body_type, cab_type, badge,
    identity_key, identity_confidence, identity_evidence,
    listing_intent, listing_intent_reason, verified,
    match_score, rank_score, sort_reason, decision
  )
  SELECT 
    p_hunt_id,
    v_criteria_version,
    COALESCE(hec.source_name, 'outward'),
    CASE
      WHEN hec.source_name IN ('pickles','manheim','grays','lloyds') THEN 1
      WHEN hec.source_name IN ('carsales','autotrader','drive','gumtree','facebook') THEN 2
      ELSE 3
    END,
    hec.source_url,
    hec.title,
    hec.raw_snippet,
    hec.make,
    hec.model,
    hec.year,
    hec.km,
    hec.asking_price,
    hec.location,
    hec.state,
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'), 'UNKNOWN'),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family'), 'UNKNOWN'),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'), 'UNKNOWN'),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'cab_type'), 'UNKNOWN'),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'), 'UNKNOWN'),
    fn_build_identity_key(
      hec.make, hec.model,
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'),
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'),
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'),
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'cab_type'),
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family')
    ),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'confidence')::numeric, 0.3),
    COALESCE((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->'evidence'), '{}'::jsonb),
    (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent'),
    (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'reason'),
    COALESCE(hec.verified, false),
    -- Compute real DNA score for outward
    fn_compute_outward_dna_score(
      v_hunt.make,
      v_hunt.model,
      v_hunt.year_min,
      v_hunt.year_max,
      v_hunt.required_series_family,
      NULL, -- required_badge (add to hunt if needed)
      NULL, -- required_body
      NULL, -- required_engine
      v_hunt.must_have_tokens,
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'),
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'),
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'),
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family'),
      hec.year,
      hec.km,
      COALESCE(hec.title, '') || ' ' || COALESCE(hec.raw_snippet, '')
    ),
    -- rank_score = DNA score
    fn_compute_outward_dna_score(
      v_hunt.make,
      v_hunt.model,
      v_hunt.year_min,
      v_hunt.year_max,
      v_hunt.required_series_family,
      NULL, NULL, NULL,
      v_hunt.must_have_tokens,
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'),
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'),
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'),
      (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family'),
      hec.year,
      hec.km,
      COALESCE(hec.title, '') || ' ' || COALESCE(hec.raw_snippet, '')
    ),
    ARRAY['OUTWARD'],
    -- Decision logic with proper BUY qualification
    CASE
      -- Non-listing intent = IGNORE
      WHEN (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent') = 'non_listing' THEN 'IGNORE'
      
      -- Carsales unknown intent = UNVERIFIED (Fix 3)
      WHEN hec.source_name = 'carsales' 
           AND (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent') = 'unknown' THEN 'UNVERIFIED'
      
      -- Series mismatch = IGNORE
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family') != 'UNKNOWN'
           AND UPPER((fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family')) != UPPER(v_hunt.required_series_family) 
      THEN 'IGNORE'
      
      -- Unknown series when required = UNVERIFIED
      WHEN v_hunt.required_series_family IS NOT NULL 
           AND (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family') = 'UNKNOWN' 
      THEN 'UNVERIFIED'
      
      -- Unknown intent = UNVERIFIED (not listing-confirmed)
      WHEN (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent') = 'unknown' THEN 'UNVERIFIED'
      
      -- BUY: listing intent + DNA score >= 7.0 + verified + has price
      WHEN (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent') = 'listing'
           AND fn_compute_outward_dna_score(
                 v_hunt.make, v_hunt.model, v_hunt.year_min, v_hunt.year_max,
                 v_hunt.required_series_family, NULL, NULL, NULL, v_hunt.must_have_tokens,
                 (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'),
                 (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'),
                 (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'),
                 (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family'),
                 hec.year, hec.km, COALESCE(hec.title, '') || ' ' || COALESCE(hec.raw_snippet, '')
               ) >= 7.0
           AND COALESCE(hec.verified, false) = true
           AND hec.asking_price IS NOT NULL
      THEN 'BUY'
      
      -- WATCH: listing intent + DNA score >= 5.0
      WHEN (fn_classify_listing_intent(hec.source_url, hec.title, hec.raw_snippet)->>'intent') = 'listing'
           AND fn_compute_outward_dna_score(
                 v_hunt.make, v_hunt.model, v_hunt.year_min, v_hunt.year_max,
                 v_hunt.required_series_family, NULL, NULL, NULL, v_hunt.must_have_tokens,
                 (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'series_family'),
                 (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'badge'),
                 (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'body_type'),
                 (fn_classify_vehicle_identity(hec.make, hec.model, hec.variant_raw, hec.source_url, hec.raw_snippet)->>'engine_family'),
                 hec.year, hec.km, COALESCE(hec.title, '') || ' ' || COALESCE(hec.raw_snippet, '')
               ) >= 5.0
      THEN 'WATCH'
      
      -- Everything else = UNVERIFIED
      ELSE 'UNVERIFIED'
    END
  FROM hunt_external_candidates hec
  WHERE hec.hunt_id = p_hunt_id
    AND hec.criteria_version = v_criteria_version
    AND hec.is_stale = false
  ON CONFLICT (hunt_id, criteria_version, url) DO UPDATE SET
    updated_at = now(),
    decision = EXCLUDED.decision,
    match_score = EXCLUDED.match_score,
    rank_score = EXCLUDED.rank_score,
    series_family = EXCLUDED.series_family,
    listing_intent = EXCLUDED.listing_intent;

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  -- Count results by decision
  SELECT COUNT(*) INTO v_ignore_count FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'IGNORE';
  
  SELECT COUNT(*) INTO v_unverified_count FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'UNVERIFIED';
  
  SELECT COUNT(*) INTO v_buy_count FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'BUY';
  
  SELECT COUNT(*) INTO v_watch_count FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version AND decision = 'WATCH';

  RETURN jsonb_build_object(
    'hunt_id', p_hunt_id,
    'criteria_version', v_criteria_version,
    'internal_count', v_internal_count,
    'outward_count', v_outward_count,
    'buy_count', v_buy_count,
    'watch_count', v_watch_count,
    'unverified_count', v_unverified_count,
    'ignore_count', v_ignore_count
  );
END $$;
