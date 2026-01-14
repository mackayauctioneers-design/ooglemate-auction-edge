-- Seller Attribution + Cross-Post Dedup + Origin Reporting

-- 1. Add seller attribution fields to retail_listings
ALTER TABLE retail_listings 
  ADD COLUMN IF NOT EXISTS seller_name_raw TEXT,
  ADD COLUMN IF NOT EXISTS seller_phone_hash TEXT,
  ADD COLUMN IF NOT EXISTS seller_type TEXT DEFAULT 'unknown', -- 'dealer', 'auction', 'private', 'unknown'
  ADD COLUMN IF NOT EXISTS origin_entity TEXT, -- best effort: "Valley Motor Auctions"
  ADD COLUMN IF NOT EXISTS source_chain JSONB DEFAULT '[]'::jsonb; -- [{origin, distributor, seen_at}]

-- 2. Add cross-post deduplication support
ALTER TABLE retail_listings 
  ADD COLUMN IF NOT EXISTS vehicle_instance_id UUID, -- links same car across sources
  ADD COLUMN IF NOT EXISTS cross_post_confidence NUMERIC(3,2) DEFAULT 0, -- 0-1 confidence it's same vehicle
  ADD COLUMN IF NOT EXISTS cross_post_linked_at TIMESTAMPTZ;

-- Index for cross-post lookups
CREATE INDEX IF NOT EXISTS idx_retail_listings_instance ON retail_listings(vehicle_instance_id) WHERE vehicle_instance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retail_listings_seller ON retail_listings(seller_type, origin_entity);
CREATE INDEX IF NOT EXISTS idx_retail_listings_phone_hash ON retail_listings(seller_phone_hash) WHERE seller_phone_hash IS NOT NULL;

-- 3. Origin reporting view
CREATE OR REPLACE VIEW public.retail_origin_stats AS
SELECT 
  origin_entity,
  seller_type,
  COUNT(*) AS total_listings,
  COUNT(*) FILTER (WHERE delisted_at IS NULL) AS active_listings,
  COUNT(*) FILTER (WHERE first_seen_at >= now() - interval '7 days') AS listings_7d,
  COUNT(*) FILTER (WHERE first_seen_at >= now() - interval '30 days') AS listings_30d,
  COUNT(DISTINCT source) AS source_count,
  ARRAY_AGG(DISTINCT source) AS sources,
  MIN(first_seen_at) AS first_contribution,
  MAX(first_seen_at) AS latest_contribution,
  ROUND(COUNT(*) FILTER (WHERE first_seen_at >= now() - interval '7 days')::NUMERIC / 7, 1) AS avg_per_day_7d
FROM retail_listings
WHERE origin_entity IS NOT NULL
GROUP BY origin_entity, seller_type
ORDER BY listings_7d DESC, total_listings DESC;

-- Grant access
GRANT SELECT ON retail_origin_stats TO anon, authenticated;

-- 4. RPC to link cross-posts (for future use)
CREATE OR REPLACE FUNCTION public.link_cross_posts(
  p_listing_ids UUID[],
  p_confidence NUMERIC DEFAULT 0.9
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance_id UUID;
BEGIN
  -- Check if any already have an instance_id
  SELECT vehicle_instance_id INTO v_instance_id
  FROM retail_listings
  WHERE id = ANY(p_listing_ids) AND vehicle_instance_id IS NOT NULL
  LIMIT 1;
  
  -- Create new instance_id if none exists
  IF v_instance_id IS NULL THEN
    v_instance_id := gen_random_uuid();
  END IF;
  
  -- Link all listings to this instance
  UPDATE retail_listings
  SET 
    vehicle_instance_id = v_instance_id,
    cross_post_confidence = p_confidence,
    cross_post_linked_at = now()
  WHERE id = ANY(p_listing_ids);
  
  RETURN v_instance_id;
END;
$$;

-- 5. Helper view: potential cross-posts (same year/make/model/km-ish from different sources)
CREATE OR REPLACE VIEW public.potential_cross_posts AS
SELECT 
  a.id AS listing_a_id,
  b.id AS listing_b_id,
  a.source AS source_a,
  b.source AS source_b,
  a.year,
  a.make,
  a.model,
  a.km AS km_a,
  b.km AS km_b,
  ABS(COALESCE(a.km, 0) - COALESCE(b.km, 0)) AS km_diff,
  a.asking_price AS price_a,
  b.asking_price AS price_b,
  ABS(a.asking_price - b.asking_price) AS price_diff,
  a.seller_phone_hash,
  a.origin_entity AS origin_a,
  b.origin_entity AS origin_b,
  CASE 
    WHEN a.seller_phone_hash IS NOT NULL AND a.seller_phone_hash = b.seller_phone_hash THEN 0.95
    WHEN ABS(COALESCE(a.km, 0) - COALESCE(b.km, 0)) <= 100 AND ABS(a.asking_price - b.asking_price) <= 500 THEN 0.85
    WHEN ABS(COALESCE(a.km, 0) - COALESCE(b.km, 0)) <= 500 AND ABS(a.asking_price - b.asking_price) <= 1000 THEN 0.70
    ELSE 0.50
  END AS match_confidence
FROM retail_listings a
JOIN retail_listings b ON 
  a.year = b.year 
  AND UPPER(a.make) = UPPER(b.make) 
  AND UPPER(a.model) = UPPER(b.model)
  AND a.source < b.source -- avoid duplicates and self-joins
  AND a.delisted_at IS NULL 
  AND b.delisted_at IS NULL
  AND a.vehicle_instance_id IS NULL -- not already linked
  AND b.vehicle_instance_id IS NULL
WHERE 
  (a.seller_phone_hash IS NOT NULL AND a.seller_phone_hash = b.seller_phone_hash)
  OR (ABS(COALESCE(a.km, 0) - COALESCE(b.km, 0)) <= 1000 AND ABS(a.asking_price - b.asking_price) <= 2000);

GRANT SELECT ON potential_cross_posts TO anon, authenticated;