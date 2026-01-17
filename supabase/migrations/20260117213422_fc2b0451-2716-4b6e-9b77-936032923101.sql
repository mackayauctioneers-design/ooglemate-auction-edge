-- ============================================
-- UNIFIED KITING MODE V2: Cheapest On The Internet
-- ============================================

-- 1) Add new columns to sale_hunts for unified ranking
ALTER TABLE sale_hunts
ADD COLUMN IF NOT EXISTS strict_must_have boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS max_outward_age_days integer DEFAULT 14,
ADD COLUMN IF NOT EXISTS sort_mode text DEFAULT 'best_buy',
ADD COLUMN IF NOT EXISTS outward_weight numeric DEFAULT 1.0;

-- Ensure outward_enabled is always true (remove the toggle concept)
UPDATE sale_hunts SET outward_enabled = true WHERE outward_enabled IS NULL OR outward_enabled = false;

-- 2) Create hunt_unified_candidates table for merged internal+external candidates
CREATE TABLE IF NOT EXISTS hunt_unified_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id uuid NOT NULL REFERENCES sale_hunts(id) ON DELETE CASCADE,
  source_type text NOT NULL, -- 'internal' | 'outward'
  source text NOT NULL, -- autotrader | drive | gumtree | firecrawl | pickles etc
  source_listing_id text, -- UUID for internal, URL for outward
  url text NOT NULL,
  title text,
  year integer,
  make text,
  model text,
  variant_raw text,
  km integer,
  price integer, -- asking/guide price
  location text,
  domain text,
  extracted jsonb, -- raw scrape fields
  classification jsonb, -- engine/body/cab/badge classification
  match_score numeric DEFAULT 0, -- 0-10
  price_score numeric DEFAULT 0, -- 0-10 (cheapest = 10)
  final_score numeric DEFAULT 0, -- weighted combination
  effective_price integer, -- used for sorting, defaults to price
  decision text DEFAULT 'IGNORE', -- BUY | WATCH | IGNORE
  reasons text[],
  alert_emitted boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT hunt_unified_candidates_url_unique UNIQUE(hunt_id, url)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_hunt_unified_candidates_hunt_id ON hunt_unified_candidates(hunt_id);
CREATE INDEX IF NOT EXISTS idx_hunt_unified_candidates_hunt_decision ON hunt_unified_candidates(hunt_id, decision);
CREATE INDEX IF NOT EXISTS idx_hunt_unified_candidates_hunt_final_score ON hunt_unified_candidates(hunt_id, final_score DESC);
CREATE INDEX IF NOT EXISTS idx_hunt_unified_candidates_hunt_price ON hunt_unified_candidates(hunt_id, effective_price ASC);

-- Enable RLS
ALTER TABLE hunt_unified_candidates ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "hunt_unified_candidates_public_read" ON hunt_unified_candidates
  FOR SELECT USING (true);

CREATE POLICY "hunt_unified_candidates_service_all" ON hunt_unified_candidates
  FOR ALL USING (true) WITH CHECK (true);

-- 3) Create RPC to build unified candidates for a hunt
CREATE OR REPLACE FUNCTION rpc_build_unified_candidates(p_hunt_id uuid)
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
  -- Get hunt details
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF v_hunt.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;

  -- Clear existing unified candidates for this hunt
  DELETE FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id;

  -- Insert internal candidates from hunt_matches
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source, source_listing_id, url, title, year, make, model,
    variant_raw, km, price, location, domain, extracted, classification,
    match_score, decision, reasons
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
    rl.variant as variant_raw,
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
    UPPER(hm.decision) as decision,
    hm.reasons
  FROM hunt_matches hm
  JOIN retail_listings rl ON rl.id = hm.listing_id
  WHERE hm.hunt_id = p_hunt_id
    AND hm.decision IN ('buy', 'watch'); -- Only include BUY/WATCH matches

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- Insert outward candidates
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source, source_listing_id, url, title, year, make, model,
    variant_raw, km, price, location, domain, extracted, classification,
    match_score, decision, reasons, alert_emitted
  )
  SELECT 
    oc.hunt_id,
    'outward' as source_type,
    'firecrawl' as source,
    oc.url as source_listing_id,
    oc.url,
    oc.title,
    (oc.extracted->>'year')::integer as year,
    oc.extracted->>'make' as make,
    oc.extracted->>'model' as model,
    NULL as variant_raw,
    (oc.extracted->>'km')::integer as km,
    (oc.extracted->>'asking_price')::integer as price,
    oc.location,
    oc.domain,
    oc.extracted,
    oc.classification,
    oc.match_score,
    oc.decision,
    oc.reasons,
    oc.alert_emitted
  FROM outward_candidates oc
  WHERE oc.hunt_id = p_hunt_id
    AND oc.decision IN ('BUY', 'WATCH')
  ON CONFLICT (hunt_id, url) DO UPDATE SET
    source_type = 'outward',
    match_score = EXCLUDED.match_score,
    decision = EXCLUDED.decision,
    reasons = EXCLUDED.reasons,
    updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  -- Calculate price scores (cheapest = 10, most expensive = 0)
  SELECT MIN(price), MAX(price) INTO v_min_price, v_max_price
  FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND price IS NOT NULL;

  IF v_max_price IS NOT NULL AND v_max_price > v_min_price THEN
    UPDATE hunt_unified_candidates
    SET 
      effective_price = COALESCE(price, v_max_price + 1), -- No price = rank last
      price_score = CASE 
        WHEN price IS NULL THEN 0
        ELSE 10.0 * (1.0 - (price - v_min_price)::numeric / NULLIF(v_max_price - v_min_price, 0))
      END
    WHERE hunt_id = p_hunt_id;
  ELSE
    -- All same price or no prices
    UPDATE hunt_unified_candidates
    SET 
      effective_price = COALESCE(price, 999999999),
      price_score = CASE WHEN price IS NOT NULL THEN 5.0 ELSE 0 END
    WHERE hunt_id = p_hunt_id;
  END IF;

  -- Calculate final score based on hunt sort_mode
  IF v_hunt.sort_mode = 'best_match' THEN
    -- Best match: prioritize match score
    UPDATE hunt_unified_candidates
    SET final_score = (match_score * 0.70) + (price_score * 0.30)
    WHERE hunt_id = p_hunt_id;
  ELSE
    -- Best buy (default): prioritize price
    UPDATE hunt_unified_candidates
    SET final_score = (price_score * 0.60) + (match_score * 0.40)
    WHERE hunt_id = p_hunt_id;
  END IF;

  SELECT COUNT(*) INTO v_total_count FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id;

  RETURN jsonb_build_object(
    'success', true,
    'internal_count', v_internal_count,
    'outward_count', v_outward_count,
    'total_count', v_total_count,
    'min_price', v_min_price,
    'max_price', v_max_price
  );
END;
$$;

-- 4) Create helper function to get unified candidates sorted
CREATE OR REPLACE FUNCTION rpc_get_unified_candidates(
  p_hunt_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_decision_filter text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  source_type text,
  source text,
  url text,
  title text,
  year integer,
  make text,
  model text,
  variant_raw text,
  km integer,
  price integer,
  location text,
  domain text,
  match_score numeric,
  price_score numeric,
  final_score numeric,
  decision text,
  reasons text[],
  is_cheapest boolean,
  rank_position integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT 
      huc.*,
      ROW_NUMBER() OVER (ORDER BY huc.final_score DESC, huc.effective_price ASC) as rank_pos,
      huc.effective_price = MIN(huc.effective_price) OVER () as is_cheapest_calc
    FROM hunt_unified_candidates huc
    WHERE huc.hunt_id = p_hunt_id
      AND (p_decision_filter IS NULL OR huc.decision = p_decision_filter)
  )
  SELECT 
    r.id,
    r.source_type,
    r.source,
    r.url,
    r.title,
    r.year,
    r.make,
    r.model,
    r.variant_raw,
    r.km,
    r.price,
    r.location,
    r.domain,
    r.match_score,
    r.price_score,
    r.final_score,
    r.decision,
    r.reasons,
    r.is_cheapest_calc as is_cheapest,
    r.rank_pos::integer as rank_position
  FROM ranked r
  ORDER BY r.final_score DESC, r.effective_price ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;