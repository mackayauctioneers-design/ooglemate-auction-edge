-- IDENTITY KEY + PROOF-GATED MATCHING MIGRATION
-- This adds missing columns and creates required functions

-- A1) Add missing required field to sale_hunts
ALTER TABLE public.sale_hunts
ADD COLUMN IF NOT EXISTS required_series_family TEXT NULL;

-- A2) Add identity + intent + verification columns to hunt_unified_candidates
ALTER TABLE public.hunt_unified_candidates
ADD COLUMN IF NOT EXISTS identity_key TEXT,
ADD COLUMN IF NOT EXISTS identity_confidence NUMERIC(4,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS identity_evidence JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS series_family TEXT,
ADD COLUMN IF NOT EXISTS engine_family TEXT,
ADD COLUMN IF NOT EXISTS body_type TEXT,
ADD COLUMN IF NOT EXISTS cab_type TEXT,
ADD COLUMN IF NOT EXISTS badge TEXT,
ADD COLUMN IF NOT EXISTS listing_intent TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS listing_intent_reason TEXT,
ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS rank_score NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS sort_reason TEXT[] DEFAULT '{}';

-- A3) Add identity + intent columns to hunt_external_candidates
ALTER TABLE public.hunt_external_candidates
ADD COLUMN IF NOT EXISTS listing_intent TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS listing_intent_reason TEXT,
ADD COLUMN IF NOT EXISTS series_family TEXT,
ADD COLUMN IF NOT EXISTS engine_family TEXT,
ADD COLUMN IF NOT EXISTS body_type TEXT,
ADD COLUMN IF NOT EXISTS cab_type TEXT,
ADD COLUMN IF NOT EXISTS badge TEXT,
ADD COLUMN IF NOT EXISTS identity_key TEXT,
ADD COLUMN IF NOT EXISTS identity_confidence NUMERIC(4,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS identity_evidence JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;

-- A4) Add identity columns to retail_listings (internal enrichment target)
ALTER TABLE public.retail_listings
ADD COLUMN IF NOT EXISTS series_family TEXT,
ADD COLUMN IF NOT EXISTS engine_family TEXT,
ADD COLUMN IF NOT EXISTS body_type TEXT,
ADD COLUMN IF NOT EXISTS cab_type TEXT,
ADD COLUMN IF NOT EXISTS badge TEXT,
ADD COLUMN IF NOT EXISTS identity_key TEXT,
ADD COLUMN IF NOT EXISTS identity_confidence NUMERIC(4,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS identity_evidence JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS listing_intent TEXT DEFAULT 'listing',
ADD COLUMN IF NOT EXISTS listing_intent_reason TEXT;

-- B1) Listing intent classifier (URL + content)
CREATE OR REPLACE FUNCTION public.fn_classify_listing_intent(
  p_url TEXT,
  p_title TEXT DEFAULT NULL,
  p_snippet TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  u TEXT := LOWER(COALESCE(p_url,''));
  t TEXT := LOWER(COALESCE(p_title,'') || ' ' || COALESCE(p_snippet,''));
  signals INT := 0;
BEGIN
  -- Hard blocklist
  IF u ~ '/news|/blog|/review|/reviews|/guide|/guides|price-and-specs|/spec|/specs|/comparison|/compare|/insurance|/finance|/about|/help|/contact|/privacy|/terms|/category|/search|/login|/signup' THEN
    RETURN jsonb_build_object('intent','non_listing','reason','NON_LISTING_URL');
  END IF;

  -- Hard allowlist patterns
  IF u ~ 'autotrader\.com\.au/.*/car/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_AUTOTRADER_CAR');
  END IF;
  IF u ~ 'gumtree\.com\.au/s-ad/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_GUMTREE_SAD');
  END IF;
  IF u ~ 'drive\.com\.au/cars-for-sale/.*/dealer-listing/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_DRIVE_DEALER_LISTING');
  END IF;
  IF u ~ 'pickles\.com\.au|manheim\.com\.au|lloydsauctions\.com\.au|grays\.com' AND u ~ '/lot|/auction|/item|/vehicle' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_AUCTION_DETAIL');
  END IF;

  -- Content signals (2+ required)
  IF t ~ '\$[0-9,]+' THEN signals := signals + 1; END IF;
  IF t ~ '[0-9,]+\s*(km|kms|kilometres|kilometers)' THEN signals := signals + 1; END IF;
  IF t ~ 'dealer|used|for sale|selling|available' THEN signals := signals + 1; END IF;
  IF t ~ '\b(nsw|vic|qld|wa|sa|tas|nt|act)\b|sydney|melbourne|brisbane|perth|adelaide' THEN signals := signals + 1; END IF;
  IF t ~ 'stock\s*(no|num|#)|vin|rego|registration' THEN signals := signals + 1; END IF;

  IF signals >= 2 THEN
    RETURN jsonb_build_object('intent','listing','reason','CONTENT_SIGNALS_'||signals);
  ELSIF signals = 1 THEN
    RETURN jsonb_build_object('intent','unknown','reason','WEAK_SIGNALS');
  ELSE
    RETURN jsonb_build_object('intent','non_listing','reason','NO_SIGNALS');
  END IF;
END $$;

-- B2) Identity classifier (LC70 vs LC300 must be correct)
CREATE OR REPLACE FUNCTION public.fn_classify_vehicle_identity(
  p_make TEXT,
  p_model TEXT,
  p_variant_raw TEXT DEFAULT NULL,
  p_url TEXT DEFAULT NULL,
  p_text TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  x TEXT := UPPER(COALESCE(p_make,'')||' '||COALESCE(p_model,'')||' '||COALESCE(p_variant_raw,'')||' '||COALESCE(p_url,'')||' '||COALESCE(p_text,''));
  series TEXT := 'UNKNOWN';
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

  -- LC300 signals
  IF x ~ '300\s*SERIES|LC300|LC\s*300' THEN lc300 := lc300 + 2; END IF;
  IF x ~ 'FJA300|VJA300|GRJ300' THEN lc300 := lc300 + 3; END IF;
  IF x ~ 'GR\s*SPORT|GRSPORT|ZX' THEN lc300 := lc300 + 2; END IF;
  IF x ~ '/LC300|/300-SERIES' THEN lc300 := lc300 + 2; END IF;

  IF UPPER(COALESCE(p_make,''))='TOYOTA' AND x ~ 'LANDCRUISER|LAND\s*CRUISER' THEN
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
    'series_family', series,
    'engine_family', COALESCE(engine,'UNKNOWN'),
    'body_type', COALESCE(body,'UNKNOWN'),
    'cab_type', COALESCE(cab,'UNKNOWN'),
    'badge', COALESCE(badge,'UNKNOWN'),
    'confidence', conf,
    'evidence', ev
  );
END $$;

-- B3) Identity key builder
CREATE OR REPLACE FUNCTION public.fn_build_identity_key(
  p_make TEXT, p_model TEXT, p_series TEXT, p_badge TEXT, p_body TEXT, p_cab TEXT, p_engine TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN UPPER(
    COALESCE(p_make,'UNKNOWN')||'|'||
    COALESCE(p_model,'UNKNOWN')||'|'||
    COALESCE(p_series,'UNKNOWN')||'|'||
    COALESCE(p_badge,'UNKNOWN')||'|'||
    COALESCE(p_body,'UNKNOWN')||'|'||
    COALESCE(p_cab,'UNKNOWN')||'|'||
    COALESCE(p_engine,'UNKNOWN')
  );
END $$;

-- C) Updated rpc_build_unified_candidates with proof gating
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
      rl.price AS asking_price,
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

-- D) Updated rpc_get_unified_candidates for UI
DROP FUNCTION IF EXISTS public.rpc_get_unified_candidates(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS public.rpc_get_unified_candidates(UUID, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.rpc_get_unified_candidates(
  p_hunt_id UUID,
  p_decision_filter TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  hunt_id UUID,
  criteria_version INT,
  source_type TEXT,
  source_key TEXT,
  source_tier INT,
  url TEXT,
  asking_price INT,
  km INT,
  year INT,
  identity_key TEXT,
  identity_confidence NUMERIC,
  identity_evidence JSONB,
  series_family TEXT,
  engine_family TEXT,
  body_type TEXT,
  cab_type TEXT,
  badge TEXT,
  listing_intent TEXT,
  listing_intent_reason TEXT,
  match_score NUMERIC,
  decision TEXT,
  reasons TEXT[],
  verified BOOLEAN,
  rank_score NUMERIC,
  rank_position INT,
  sort_reason TEXT[],
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_criteria_version INT;
BEGIN
  -- Get current criteria version
  SELECT sh.criteria_version INTO v_criteria_version
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  RETURN QUERY
  SELECT
    huc.id,
    huc.hunt_id,
    huc.criteria_version,
    huc.source_type,
    huc.source_key,
    huc.source_tier,
    huc.url,
    huc.asking_price,
    huc.km,
    huc.year,
    huc.identity_key,
    huc.identity_confidence,
    huc.identity_evidence,
    huc.series_family,
    huc.engine_family,
    huc.body_type,
    huc.cab_type,
    huc.badge,
    huc.listing_intent,
    huc.listing_intent_reason,
    huc.match_score,
    huc.decision,
    huc.reasons,
    huc.verified,
    huc.rank_score,
    huc.rank_position,
    huc.sort_reason,
    huc.created_at,
    huc.updated_at
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_criteria_version
    AND (p_decision_filter IS NULL OR huc.decision = p_decision_filter)
  ORDER BY
    CASE huc.decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'UNVERIFIED' THEN 3 ELSE 4 END,
    huc.source_tier ASC,
    huc.rank_score DESC,
    huc.asking_price ASC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_huc_hunt_version_decision ON hunt_unified_candidates(hunt_id, criteria_version, decision);
CREATE INDEX IF NOT EXISTS idx_huc_identity_key ON hunt_unified_candidates(identity_key);
CREATE INDEX IF NOT EXISTS idx_huc_listing_intent ON hunt_unified_candidates(listing_intent);
CREATE INDEX IF NOT EXISTS idx_retail_identity ON retail_listings(make, model, series_family);
CREATE INDEX IF NOT EXISTS idx_retail_intent ON retail_listings(listing_intent);
CREATE INDEX IF NOT EXISTS idx_hec_identity ON hunt_external_candidates(series_family, listing_intent);