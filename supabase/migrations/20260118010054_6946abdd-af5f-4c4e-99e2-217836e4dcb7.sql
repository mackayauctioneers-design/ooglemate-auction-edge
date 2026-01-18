-- =====================================================
-- KITING MODE v2 - TIER-FIRST RANKING (FINAL)
-- Auctions ALWAYS above marketplaces ALWAYS above dealers
-- DNA score and price only matter within the same tier
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
  source_tier integer,
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
      -- SOURCE TIER: Tier 1 (auctions) = 1, Tier 2 (marketplaces) = 2, Tier 3 (dealers) = 3
      CASE 
        WHEN huc.domain LIKE '%pickles%' OR huc.domain LIKE '%manheim%' OR huc.domain LIKE '%grays%' OR huc.domain LIKE '%lloyds%' THEN 1
        WHEN huc.domain LIKE '%carsales%' OR huc.domain LIKE '%autotrader%' OR huc.domain LIKE '%drive%' OR huc.domain LIKE '%gumtree%' THEN 2
        ELSE 3
      END as source_tier,
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
    r.source_tier::integer,
    r.title,
    r.first_seen_at,
    r.location,
    r.url,
    r.is_verified_calc as is_verified,
    r.criteria_version,
    r.reasons
  FROM ranked r
  -- =====================================================
  -- TIER-FIRST RANKING (per spec):
  -- 1. source_tier ASC — Auctions (1) ALWAYS above Marketplaces (2) ALWAYS above Dealers (3)
  -- 2. dna_score DESC — Best fingerprint match within tier
  -- 3. asking_price ASC — Cheapest within tier+score
  -- 4. km ASC — Tiebreaker
  -- =====================================================
  ORDER BY 
    r.source_tier ASC,
    r.dna_score DESC NULLS LAST,
    r.asking_price ASC NULLS LAST,
    r.km ASC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Update index to match new sort order
DROP INDEX IF EXISTS idx_hunt_unified_dna_tier_price;
CREATE INDEX idx_hunt_unified_tier_dna_price 
ON hunt_unified_candidates (hunt_id, criteria_version, is_stale, source_tier ASC, dna_score DESC, price ASC NULLS LAST);