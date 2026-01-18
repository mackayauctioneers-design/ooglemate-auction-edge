-- =====================================================
-- KITING MODE v2.1: Deterministic ranking + sort_reason + rank_score
-- =====================================================

-- Add sort_reason column to hunt_unified_candidates if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'hunt_unified_candidates' AND column_name = 'sort_reason') THEN
    ALTER TABLE public.hunt_unified_candidates ADD COLUMN sort_reason text[] DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'hunt_unified_candidates' AND column_name = 'rank_score') THEN
    ALTER TABLE public.hunt_unified_candidates ADD COLUMN rank_score numeric DEFAULT 0;
  END IF;
END $$;

-- Create index for efficient tier+rank sorting
DROP INDEX IF EXISTS idx_hunt_unified_tier_rank;
CREATE INDEX idx_hunt_unified_tier_rank ON public.hunt_unified_candidates (
  hunt_id, 
  criteria_version, 
  is_stale,
  source_tier ASC NULLS LAST,
  rank_score DESC NULLS LAST,
  price ASC NULLS LAST
);

-- =====================================================
-- FUNCTION: rpc_compute_rank_score
-- Computes deterministic rank_score with full audit trail
-- =====================================================
CREATE OR REPLACE FUNCTION public.rpc_compute_rank_score(
  p_hunt_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt record;
  v_updated integer := 0;
BEGIN
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF v_hunt.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;

  -- Compute rank_score and sort_reason for each candidate
  UPDATE hunt_unified_candidates huc
  SET 
    -- Calculate source_tier first (in case not set)
    source_tier = CASE 
      WHEN domain LIKE '%pickles%' OR domain LIKE '%manheim%' OR domain LIKE '%grays%' OR domain LIKE '%lloyds%' THEN 1
      WHEN domain LIKE '%carsales%' OR domain LIKE '%autotrader%' OR domain LIKE '%drive%' OR domain LIKE '%gumtree%' THEN 2
      ELSE 3
    END,
    -- Compute rank_score with formula:
    -- base = dna_score (0-10) + tier_bonus + price_gap + km_bonus + recency
    rank_score = COALESCE(dna_score, match_score, 0)
      -- Tier bonus (auction = +3.0, marketplace = +1.5, dealer = +0.5)
      + CASE 
          WHEN domain LIKE '%pickles%' OR domain LIKE '%manheim%' OR domain LIKE '%grays%' OR domain LIKE '%lloyds%' THEN 3.0
          WHEN domain LIKE '%carsales%' OR domain LIKE '%autotrader%' OR domain LIKE '%drive%' OR domain LIKE '%gumtree%' THEN 1.5
          ELSE 0.5
        END
      -- Price gap bonus (if proven_exit and price exist)
      + CASE 
          WHEN v_hunt.proven_exit_value IS NOT NULL AND price IS NOT NULL AND v_hunt.proven_exit_value > 0 THEN
            CASE 
              WHEN ((v_hunt.proven_exit_value - price)::numeric / v_hunt.proven_exit_value) >= 0.15 THEN 2.0
              WHEN ((v_hunt.proven_exit_value - price)::numeric / v_hunt.proven_exit_value) >= 0.10 THEN 1.5
              WHEN ((v_hunt.proven_exit_value - price)::numeric / v_hunt.proven_exit_value) >= 0.05 THEN 1.0
              WHEN ((v_hunt.proven_exit_value - price)::numeric / v_hunt.proven_exit_value) >= 0.00 THEN 0.3
              ELSE -1.0
            END
          ELSE 0
        END
      -- KM closeness bonus (if hunt.km and listing.km exist)
      + CASE 
          WHEN v_hunt.km IS NOT NULL AND km IS NOT NULL AND v_hunt.km > 0 THEN
            CASE 
              WHEN ABS(km - v_hunt.km)::numeric / v_hunt.km <= 0.10 THEN 0.8
              WHEN ABS(km - v_hunt.km)::numeric / v_hunt.km <= 0.20 THEN 0.4
              ELSE 0
            END
          ELSE 0
        END
      -- Recency bonus (created < 48h)
      + CASE WHEN created_at > (now() - interval '48 hours') THEN 0.3 ELSE 0 END,
    -- Build sort_reason array
    sort_reason = ARRAY[
      'tier=' || CASE 
        WHEN domain LIKE '%pickles%' OR domain LIKE '%manheim%' OR domain LIKE '%grays%' OR domain LIKE '%lloyds%' THEN 'auction'
        WHEN domain LIKE '%carsales%' OR domain LIKE '%autotrader%' OR domain LIKE '%drive%' OR domain LIKE '%gumtree%' THEN 'marketplace'
        ELSE 'dealer'
      END
    ] 
    || CASE 
        WHEN v_hunt.proven_exit_value IS NOT NULL AND price IS NOT NULL AND v_hunt.proven_exit_value > 0 THEN
          ARRAY['price_gap=' || ROUND(((v_hunt.proven_exit_value - price)::numeric / v_hunt.proven_exit_value) * 100, 1)::text || '%']
        ELSE ARRAY[]::text[]
       END
    || CASE 
        WHEN v_hunt.km IS NOT NULL AND km IS NOT NULL AND v_hunt.km > 0 
             AND ABS(km - v_hunt.km)::numeric / v_hunt.km <= 0.20 THEN
          ARRAY['km_close=within_' || CASE 
            WHEN ABS(km - v_hunt.km)::numeric / v_hunt.km <= 0.10 THEN '10%'
            ELSE '20%'
          END]
        ELSE ARRAY[]::text[]
       END
    || CASE WHEN created_at > (now() - interval '48 hours') THEN ARRAY['recent=<48h'] ELSE ARRAY[]::text[] END,
    updated_at = now()
  WHERE hunt_id = p_hunt_id
    AND criteria_version = v_hunt.criteria_version
    AND is_stale = false;
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_updated,
    'hunt_id', p_hunt_id
  );
END;
$$;

-- =====================================================
-- UPDATE rpc_get_unified_candidates to return sort_reason and rank_score
-- =====================================================
DROP FUNCTION IF EXISTS public.rpc_get_unified_candidates(uuid, integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.rpc_get_unified_candidates(
  p_hunt_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_decision_filter text DEFAULT NULL,
  p_source_filter text DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  hunt_id uuid,
  source_type text,
  source_listing_id text,
  effective_price integer,
  price_score numeric,
  final_score numeric,
  dna_score numeric,
  rank_score numeric,
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
  source_tier integer,
  title text,
  first_seen_at timestamptz,
  location text,
  url text,
  is_verified boolean,
  criteria_version integer,
  reasons text[],
  sort_reason text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt_version INT;
BEGIN
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
      COALESCE(huc.rank_score, 0) as rank_score,
      huc.decision,
      CASE 
        WHEN COALESCE(huc.dna_score, huc.match_score, 0) >= 7.0 THEN 'high'
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
      COALESCE(huc.url, 'internal://' || huc.source_listing_id) as listing_url,
      COALESCE(huc.source, huc.domain) as source_name,
      COALESCE(huc.source_class, 
        CASE 
          WHEN huc.domain LIKE '%pickles%' OR huc.domain LIKE '%manheim%' OR huc.domain LIKE '%grays%' OR huc.domain LIKE '%lloyds%' THEN 'auction'
          WHEN huc.domain LIKE '%autotrader%' OR huc.domain LIKE '%drive%' OR huc.domain LIKE '%carsales%' OR huc.domain LIKE '%gumtree%' THEN 'marketplace'
          WHEN huc.source_type = 'internal' THEN 'internal'
          ELSE 'dealer'
        END
      ) as source_class,
      -- SOURCE TIER: 1 (auctions) > 2 (marketplaces) > 3 (dealers)
      COALESCE(huc.source_tier,
        CASE 
          WHEN huc.domain LIKE '%pickles%' OR huc.domain LIKE '%manheim%' OR huc.domain LIKE '%grays%' OR huc.domain LIKE '%lloyds%' THEN 1
          WHEN huc.domain LIKE '%carsales%' OR huc.domain LIKE '%autotrader%' OR huc.domain LIKE '%drive%' OR huc.domain LIKE '%gumtree%' THEN 2
          ELSE 3
        END
      ) as source_tier,
      huc.title,
      huc.created_at as first_seen_at,
      huc.location,
      huc.url,
      huc.criteria_version,
      COALESCE(huc.reasons, ARRAY[]::text[]) as reasons,
      COALESCE(huc.sort_reason, ARRAY[]::text[]) as sort_reason,
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
    r.rank_score,
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
    r.source_tier::integer,
    r.title,
    r.first_seen_at,
    r.location,
    r.url,
    r.is_verified_calc as is_verified,
    r.criteria_version,
    r.reasons,
    r.sort_reason
  FROM ranked r
  -- =====================================================
  -- TIER-FIRST RANKING with rank_score:
  -- 1. source_tier ASC — Auctions (1) > Marketplaces (2) > Dealers (3)
  -- 2. rank_score DESC — Combined score (DNA + tier bonus + gap + km + recency)
  -- 3. asking_price ASC — Cheapest within tier+rank_score (only if price exists)
  -- 4. km ASC — Tiebreaker
  -- =====================================================
  ORDER BY 
    r.source_tier ASC,
    r.rank_score DESC NULLS LAST,
    r.asking_price ASC NULLS LAST,
    r.km ASC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- =====================================================
-- UPDATE rpc_build_unified_candidates to compute rank_score after building
-- =====================================================
CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    match_score, dna_score, decision, reasons, criteria_version, is_stale, source_class, source_tier
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
    'internal' as source_class,
    -- Source tier for internal: autotrader/drive/gumtree = 2, others = 3
    CASE 
      WHEN rl.source IN ('autotrader', 'drive', 'gumtree', 'gumtree_dealer') THEN 2
      ELSE 3
    END as source_tier
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
    match_score, dna_score, decision, reasons, alert_emitted, criteria_version, is_stale, source_class, source_tier
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
    END as source_class,
    CASE 
      WHEN oc.domain LIKE '%pickles%' OR oc.domain LIKE '%manheim%' OR oc.domain LIKE '%grays%' OR oc.domain LIKE '%lloyds%' THEN 1
      WHEN oc.domain LIKE '%autotrader%' OR oc.domain LIKE '%drive%' OR oc.domain LIKE '%carsales%' OR oc.domain LIKE '%gumtree%' THEN 2
      ELSE 3
    END as source_tier
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
    source_tier = EXCLUDED.source_tier,
    updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  -- Calculate effective_price
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

  -- =====================================================
  -- COMPUTE RANK_SCORE AND SORT_REASON
  -- =====================================================
  PERFORM rpc_compute_rank_score(p_hunt_id);

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