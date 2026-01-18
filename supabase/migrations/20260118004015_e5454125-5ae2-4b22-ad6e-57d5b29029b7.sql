-- =====================================================
-- KITING MODE v2 RESET - DNA-First Ranking
-- =====================================================

-- Add dna_score column to unified candidates
ALTER TABLE public.hunt_unified_candidates
ADD COLUMN IF NOT EXISTS dna_score NUMERIC(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS source_class TEXT DEFAULT 'unknown';

-- Add dna_score to hunt_matches for internal candidates
ALTER TABLE public.hunt_matches
ADD COLUMN IF NOT EXISTS dna_score NUMERIC(5,2) DEFAULT 0;

-- Add dna_score to outward_candidates
ALTER TABLE public.outward_candidates
ADD COLUMN IF NOT EXISTS dna_score NUMERIC(5,2) DEFAULT 0;

-- =====================================================
-- UPDATE rpc_get_unified_candidates to sort DNA-first
-- =====================================================
DROP FUNCTION IF EXISTS rpc_get_unified_candidates(uuid, integer, integer, text, text);

CREATE OR REPLACE FUNCTION rpc_get_unified_candidates(
  p_hunt_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_decision_filter text DEFAULT NULL,
  p_source_filter text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  hunt_id uuid,
  source_type text,
  source_listing_id text,
  effective_price integer,
  price_score numeric,
  final_score numeric,
  dna_score numeric,
  decision text,
  confidence text,
  year integer,
  make text,
  model text,
  variant text,
  km integer,
  asking_price integer,
  gap_dollars integer,
  gap_pct numeric,
  listing_url text,
  source_name text,
  source_class text,
  title text,
  first_seen_at timestamptz,
  location text,
  url text,
  is_verified boolean,
  criteria_version integer,
  reasons text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hunt_version INT;
BEGIN
  -- Get current hunt criteria version
  SELECT sh.criteria_version INTO v_hunt_version
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      huc.id,
      huc.hunt_id,
      huc.source_type,
      huc.source_listing_id,
      huc.effective_price,
      huc.price_score,
      huc.final_score,
      COALESCE(huc.dna_score, huc.match_score, 0) as dna_score,
      huc.decision,
      CASE 
        WHEN COALESCE(huc.dna_score, huc.match_score, 0) >= 7.5 THEN 'high'
        WHEN COALESCE(huc.dna_score, huc.match_score, 0) >= 5.5 THEN 'medium'
        ELSE 'low'
      END as confidence,
      huc.year,
      huc.make,
      huc.model,
      huc.variant_raw as variant,
      huc.km,
      huc.price as asking_price,
      huc.gap_dollars,
      huc.gap_pct,
      huc.url as listing_url,
      COALESCE(huc.source, huc.domain) as source_name,
      COALESCE(huc.source_class, 
        CASE 
          WHEN huc.domain LIKE '%pickles%' OR huc.domain LIKE '%manheim%' OR huc.domain LIKE '%grays%' OR huc.domain LIKE '%lloyds%' THEN 'auction'
          WHEN huc.domain LIKE '%autotrader%' OR huc.domain LIKE '%drive%' OR huc.domain LIKE '%carsales%' OR huc.domain LIKE '%gumtree%' THEN 'marketplace'
          WHEN huc.source_type = 'internal' THEN 'internal'
          ELSE 'dealer'
        END
      ) as source_class,
      huc.title,
      huc.created_at as first_seen_at,
      huc.location,
      huc.url,
      huc.criteria_version,
      huc.reasons,
      CASE
        WHEN huc.source_type = 'outward' THEN
          COALESCE(
            (SELECT (oc.extracted->>'asking_price') IS NOT NULL
                 OR (oc.extracted->>'price') IS NOT NULL
             FROM outward_candidates oc
             WHERE oc.id::text = huc.source_listing_id
               AND oc.is_stale = false),
            false
          )
        ELSE true
      END as is_verified_calc
    FROM hunt_unified_candidates huc
    WHERE huc.hunt_id = p_hunt_id
      AND huc.criteria_version = v_hunt_version
      AND huc.is_stale = false
      AND (p_decision_filter IS NULL OR huc.decision = p_decision_filter)
      AND (p_source_filter IS NULL OR huc.source_type = p_source_filter)
  )
  SELECT
    r.id,
    r.hunt_id,
    r.source_type,
    r.source_listing_id,
    r.effective_price,
    r.price_score,
    r.final_score,
    r.dna_score,
    r.decision,
    r.confidence,
    r.year,
    r.make,
    r.model,
    r.variant,
    r.km,
    r.asking_price,
    r.gap_dollars,
    r.gap_pct,
    r.listing_url,
    r.source_name,
    r.source_class,
    r.title,
    r.first_seen_at,
    r.location,
    r.url,
    r.is_verified_calc as is_verified,
    r.criteria_version,
    r.reasons
  FROM ranked r
  -- =====================================================
  -- DNA-FIRST RANKING: dna_score DESC, then price ASC
  -- =====================================================
  ORDER BY 
    r.dna_score DESC NULLS LAST,
    r.asking_price ASC NULLS LAST,
    r.km ASC NULLS LAST;
END;
$$;

-- =====================================================
-- UPDATE rpc_build_unified_candidates to include dna_score and source_class
-- =====================================================
DROP FUNCTION IF EXISTS rpc_build_unified_candidates(uuid);

CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hunt record;
  v_internal_count integer := 0;
  v_outward_count integer := 0;
  v_total_count integer := 0;
  v_min_price integer;
  v_max_price integer;
BEGIN
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF v_hunt.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;

  -- Clear existing unified candidates for this version
  DELETE FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id 
    AND criteria_version = v_hunt.criteria_version;

  -- Insert internal candidates with dna_score and source_class
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source, source_listing_id, url, title, year, make, model,
    variant_raw, km, price, location, domain, extracted, classification,
    match_score, dna_score, decision, reasons, criteria_version, is_stale, source_class
  )
  SELECT 
    hm.hunt_id,
    'internal' as source_type,
    rl.source,
    rl.id::text as source_listing_id,
    COALESCE(rl.listing_url, 'internal://' || rl.id::text) as url,
    COALESCE(rl.title, rl.year || ' ' || rl.make || ' ' || rl.model) as title,
    rl.year,
    rl.make,
    rl.model,
    rl.variant_raw,
    rl.km,
    rl.asking_price as price,
    COALESCE(rl.suburb, rl.state) as location,
    COALESCE(
      CASE 
        WHEN rl.source = 'autotrader' THEN 'autotrader.com.au'
        WHEN rl.source = 'drive' THEN 'drive.com.au'
        WHEN rl.source LIKE 'gumtree%' THEN 'gumtree.com.au'
        ELSE rl.source
      END, 
      'internal'
    ) as domain,
    jsonb_build_object(
      'badge', rl.badge,
      'body_type', rl.body_type,
      'engine_family', rl.engine_family,
      'enrichment_status', rl.enrichment_status
    ) as extracted,
    jsonb_build_object(
      'series_family', rl.series_family,
      'engine_family', rl.engine_family,
      'body_type', rl.body_type,
      'cab_type', rl.cab_type,
      'badge', rl.badge
    ) as classification,
    hm.match_score,
    COALESCE(hm.dna_score, hm.match_score) as dna_score,
    UPPER(hm.decision) as decision,
    hm.reasons,
    v_hunt.criteria_version,
    false as is_stale,
    'internal' as source_class
  FROM hunt_matches hm
  JOIN retail_listings rl ON rl.id = hm.listing_id
  WHERE hm.hunt_id = p_hunt_id
    AND hm.criteria_version = v_hunt.criteria_version
    AND hm.is_stale = false
    AND UPPER(hm.decision) IN ('BUY', 'WATCH');

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- Insert outward candidates with dna_score and source_class
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source, source_listing_id, url, title, year, make, model,
    variant_raw, km, price, location, domain, extracted, classification,
    match_score, dna_score, decision, reasons, alert_emitted, criteria_version, is_stale, source_class
  )
  SELECT 
    oc.hunt_id,
    'outward' as source_type,
    COALESCE(oc.provider, 'firecrawl') as source,
    oc.id::text as source_listing_id,
    oc.url,
    oc.title,
    (oc.extracted->>'year')::integer as year,
    COALESCE(oc.extracted->>'make', oc.classification->>'make') as make,
    COALESCE(oc.extracted->>'model', oc.classification->>'model') as model,
    oc.extracted->>'variant' as variant_raw,
    (oc.extracted->>'km')::integer as km,
    COALESCE(
      (oc.extracted->>'price')::integer,
      (oc.extracted->>'asking_price')::integer
    ) as price,
    oc.extracted->>'location' as location,
    oc.domain,
    oc.extracted,
    oc.classification,
    oc.match_score,
    COALESCE(oc.dna_score, oc.match_score) as dna_score,
    UPPER(COALESCE(oc.decision, 'WATCH')) as decision,
    oc.reasons,
    oc.alert_emitted,
    v_hunt.criteria_version,
    false as is_stale,
    CASE 
      WHEN oc.domain LIKE '%pickles%' OR oc.domain LIKE '%manheim%' OR oc.domain LIKE '%grays%' OR oc.domain LIKE '%lloyds%' THEN 'auction'
      WHEN oc.domain LIKE '%autotrader%' OR oc.domain LIKE '%drive%' OR oc.domain LIKE '%carsales%' OR oc.domain LIKE '%gumtree%' THEN 'marketplace'
      ELSE 'dealer'
    END as source_class
  FROM outward_candidates oc
  WHERE oc.hunt_id = p_hunt_id
    AND oc.criteria_version = v_hunt.criteria_version
    AND oc.is_stale = false
    AND UPPER(COALESCE(oc.decision, 'WATCH')) IN ('BUY', 'WATCH')
  ON CONFLICT (hunt_id, url) DO UPDATE SET
    source_type = EXCLUDED.source_type,
    source = EXCLUDED.source,
    title = EXCLUDED.title,
    year = EXCLUDED.year,
    make = EXCLUDED.make,
    model = EXCLUDED.model,
    km = EXCLUDED.km,
    price = EXCLUDED.price,
    location = EXCLUDED.location,
    domain = EXCLUDED.domain,
    extracted = EXCLUDED.extracted,
    classification = EXCLUDED.classification,
    match_score = EXCLUDED.match_score,
    dna_score = EXCLUDED.dna_score,
    decision = EXCLUDED.decision,
    criteria_version = EXCLUDED.criteria_version,
    is_stale = false,
    source_class = EXCLUDED.source_class,
    updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  -- Calculate effective_price (no complex price scoring - just use raw price)
  UPDATE hunt_unified_candidates
  SET effective_price = price
  WHERE hunt_id = p_hunt_id 
    AND criteria_version = v_hunt.criteria_version
    AND is_stale = false;

  -- Calculate gap metrics if proven_exit_value exists
  IF v_hunt.proven_exit_value IS NOT NULL THEN
    UPDATE hunt_unified_candidates
    SET 
      gap_dollars = v_hunt.proven_exit_value - price,
      gap_pct = CASE WHEN v_hunt.proven_exit_value > 0 
                THEN ((v_hunt.proven_exit_value - price)::numeric / v_hunt.proven_exit_value::numeric) * 100 
                ELSE 0 END
    WHERE hunt_id = p_hunt_id 
      AND price IS NOT NULL
      AND criteria_version = v_hunt.criteria_version
      AND is_stale = false;
  END IF;

  SELECT COUNT(*) INTO v_total_count 
  FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id
    AND criteria_version = v_hunt.criteria_version
    AND is_stale = false;

  RETURN jsonb_build_object(
    'success', true,
    'internal_count', v_internal_count,
    'outward_count', v_outward_count,
    'total_count', v_total_count,
    'criteria_version', v_hunt.criteria_version
  );
END;
$$;

-- Update count function
DROP FUNCTION IF EXISTS rpc_get_unified_candidates_count(uuid, text, text);

CREATE OR REPLACE FUNCTION rpc_get_unified_candidates_count(
  p_hunt_id uuid,
  p_decision_filter text DEFAULT NULL,
  p_source_filter text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
  v_hunt_version INT;
BEGIN
  SELECT sh.criteria_version INTO v_hunt_version
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  SELECT COUNT(*)::integer INTO v_count
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_hunt_version
    AND huc.is_stale = false
    AND (p_decision_filter IS NULL OR huc.decision = p_decision_filter)
    AND (p_source_filter IS NULL OR huc.source_type = p_source_filter);
  
  RETURN v_count;
END;
$$;