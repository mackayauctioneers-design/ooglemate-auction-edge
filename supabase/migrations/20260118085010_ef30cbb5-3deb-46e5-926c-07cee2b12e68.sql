-- ============================================================
-- IDENTITY-FIRST KITING MODE
-- Phase 1: LIVE MATCHES (identity + availability only)
-- No price-gap thresholds, no BUY/WATCH based on pricing
-- ============================================================

-- 1) Create identity_score function (NO pricing)
CREATE OR REPLACE FUNCTION public.fn_compute_identity_score(
  p_hunt_series text,
  p_hunt_engine text,
  p_hunt_body text,
  p_hunt_cab text,
  p_hunt_badge text,
  p_hunt_year integer,
  p_hunt_km integer,
  p_hunt_must_tokens text[],
  p_cand_series text,
  p_cand_engine text,
  p_cand_body text,
  p_cand_cab text,
  p_cand_badge text,
  p_cand_year integer,
  p_cand_km integer,
  p_cand_text text
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_score numeric := 5.0;
  v_token text;
  txt text := UPPER(COALESCE(p_cand_text,''));
BEGIN
  -- Series match (very strong - required)
  IF p_hunt_series IS NOT NULL AND p_cand_series IS NOT NULL THEN
    IF UPPER(p_cand_series) = UPPER(p_hunt_series) THEN
      v_score := v_score + 2.5;
    ELSE
      -- Series mismatch is a hard fail - return 0
      RETURN 0;
    END IF;
  ELSIF p_hunt_series IS NOT NULL AND p_cand_series IS NULL THEN
    -- Unknown series with required series = lower score but not rejected
    v_score := v_score - 1.0;
  END IF;

  -- Engine match
  IF p_hunt_engine IS NOT NULL AND p_cand_engine IS NOT NULL THEN
    IF UPPER(p_cand_engine) = UPPER(p_hunt_engine) THEN
      v_score := v_score + 1.0;
    ELSE
      v_score := v_score - 0.5;
    END IF;
  END IF;

  -- Body match
  IF p_hunt_body IS NOT NULL AND p_cand_body IS NOT NULL THEN
    IF UPPER(p_cand_body) = UPPER(p_hunt_body) THEN
      v_score := v_score + 0.75;
    ELSE
      v_score := v_score - 0.25;
    END IF;
  END IF;

  -- Cab match
  IF p_hunt_cab IS NOT NULL AND p_cand_cab IS NOT NULL THEN
    IF UPPER(p_cand_cab) = UPPER(p_hunt_cab) THEN
      v_score := v_score + 0.5;
    END IF;
  END IF;

  -- Badge match
  IF p_hunt_badge IS NOT NULL AND p_cand_badge IS NOT NULL THEN
    IF UPPER(p_cand_badge) = UPPER(p_hunt_badge) THEN
      v_score := v_score + 0.75;
    END IF;
  END IF;

  -- Year closeness
  IF p_hunt_year IS NOT NULL AND p_cand_year IS NOT NULL THEN
    IF p_cand_year = p_hunt_year THEN
      v_score := v_score + 0.5;
    ELSIF ABS(p_cand_year - p_hunt_year) = 1 THEN
      v_score := v_score + 0.25;
    ELSIF ABS(p_cand_year - p_hunt_year) > 3 THEN
      v_score := v_score - 0.5;
    END IF;
  END IF;

  -- KM closeness (if both exist)
  IF p_hunt_km IS NOT NULL AND p_cand_km IS NOT NULL THEN
    IF ABS(p_cand_km - p_hunt_km) < 10000 THEN
      v_score := v_score + 0.5;
    ELSIF ABS(p_cand_km - p_hunt_km) < 25000 THEN
      v_score := v_score + 0.25;
    ELSIF ABS(p_cand_km - p_hunt_km) > 50000 THEN
      v_score := v_score - 0.25;
    END IF;
  END IF;

  -- Must-have tokens (any hit => +0.5)
  IF p_hunt_must_tokens IS NOT NULL AND array_length(p_hunt_must_tokens, 1) > 0 THEN
    FOREACH v_token IN ARRAY p_hunt_must_tokens LOOP
      IF txt LIKE '%' || UPPER(v_token) || '%' THEN
        v_score := v_score + 0.5;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  RETURN GREATEST(LEAST(v_score, 10.0), 0);
END $$;

-- 2) Update rpc_get_unified_candidates for identity-first ranking
-- Order: source_tier ASC, identity_score DESC, km_distance ASC, year_distance ASC, price ASC, created_at DESC
CREATE OR REPLACE FUNCTION public.rpc_get_unified_candidates(
  p_hunt_id UUID,
  p_decision_filter TEXT DEFAULT NULL,
  p_source_filter TEXT DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0,
  p_exclude_ignore BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
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
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_criteria_version INT;
  v_hunt_year INT;
  v_hunt_km INT;
BEGIN
  SELECT sh.criteria_version, sh.year, sh.km 
  INTO v_criteria_version, v_hunt_year, v_hunt_km
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
    -- CRITICAL: Exclude IGNORE by default for LIVE MATCHES
    AND (p_exclude_ignore = FALSE OR huc.decision != 'IGNORE')
  ORDER BY
    -- Identity-first ranking: Auction > Marketplace > Dealer, then identity score
    huc.source_tier ASC,
    huc.dna_score DESC,
    -- KM distance (closer to target km = higher)
    CASE WHEN v_hunt_km IS NOT NULL AND huc.km IS NOT NULL 
         THEN ABS(huc.km - v_hunt_km) 
         ELSE 999999 END ASC,
    -- Year distance (closer to target year = higher)
    CASE WHEN v_hunt_year IS NOT NULL AND huc.year IS NOT NULL 
         THEN ABS(huc.year - v_hunt_year) 
         ELSE 999 END ASC,
    -- Price (cheapest first within same tier/score)
    huc.price ASC NULLS LAST,
    -- Recency (most recently seen first)
    huc.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END $$;

-- 3) Create function to get count of candidates by decision for tab badges
CREATE OR REPLACE FUNCTION public.rpc_get_candidate_counts(p_hunt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_criteria_version INT;
  v_result JSONB;
BEGIN
  SELECT sh.criteria_version INTO v_criteria_version
  FROM sale_hunts sh WHERE sh.id = p_hunt_id;
  
  SELECT jsonb_build_object(
    'total', COUNT(*) FILTER (WHERE decision != 'IGNORE'),
    'buy', COUNT(*) FILTER (WHERE decision = 'BUY'),
    'watch', COUNT(*) FILTER (WHERE decision = 'WATCH'),
    'unverified', COUNT(*) FILTER (WHERE decision = 'UNVERIFIED'),
    'ignore', COUNT(*) FILTER (WHERE decision = 'IGNORE'),
    'live_matches', COUNT(*) FILTER (WHERE decision IN ('BUY', 'WATCH', 'UNVERIFIED')),
    'opportunities', COUNT(*) FILTER (WHERE decision IN ('BUY', 'WATCH')),
    'by_tier', jsonb_build_object(
      'auction', COUNT(*) FILTER (WHERE source_tier = 1 AND decision != 'IGNORE'),
      'marketplace', COUNT(*) FILTER (WHERE source_tier = 2 AND decision != 'IGNORE'),
      'dealer', COUNT(*) FILTER (WHERE source_tier = 3 AND decision != 'IGNORE')
    )
  )
  INTO v_result
  FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id
    AND criteria_version = v_criteria_version;
    
  RETURN COALESCE(v_result, '{}'::jsonb);
END $$;