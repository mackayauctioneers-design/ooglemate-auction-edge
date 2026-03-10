-- Dealer pressure scores materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS public.dealer_pressure_scores AS
SELECT
  seller_name_raw AS seller_name,
  source,
  COUNT(*) AS listing_count,
  ROUND(AVG(EXTRACT(EPOCH FROM (now() - first_seen_at)) / 86400), 1) AS avg_days_on_market,
  COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (now() - first_seen_at)) / 86400 > 30) AS stale_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (now() - first_seen_at)) / 86400 > 30) 
    / NULLIF(COUNT(*), 0), 1
  ) AS stale_pct,
  ROUND(AVG(asking_price) FILTER (WHERE asking_price IS NOT NULL), 0) AS avg_price
FROM public.retail_listings
WHERE COALESCE(lifecycle_status, 'ACTIVE') NOT IN ('DELISTED', 'SOLD', 'DEAD')
  AND seller_name_raw IS NOT NULL
  AND last_seen_at > now() - interval '14 days'
GROUP BY seller_name_raw, source
HAVING COUNT(*) >= 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dps_seller ON public.dealer_pressure_scores (seller_name, source);

-- Cross-source price mismatches view
CREATE OR REPLACE VIEW public.cross_source_price_mismatches AS
WITH grouped AS (
  SELECT
    fingerprint_hash,
    MIN(price) AS lowest_price,
    MAX(price) AS highest_price,
    MAX(price) - MIN(price) AS price_spread,
    COUNT(DISTINCT source) AS source_count,
    ARRAY_AGG(DISTINCT source) AS sources
  FROM public.market_listings
  WHERE fingerprint_hash IS NOT NULL
    AND price IS NOT NULL
    AND last_seen_at > now() - interval '14 days'
  GROUP BY fingerprint_hash
  HAVING COUNT(DISTINCT source) > 1
    AND MAX(price) - MIN(price) > 500
)
SELECT
  g.fingerprint_hash,
  g.lowest_price,
  g.highest_price,
  g.price_spread,
  ROUND(100.0 * g.price_spread / NULLIF(g.highest_price, 0), 1) AS spread_pct,
  g.source_count,
  g.sources,
  ml.make, ml.model, ml.year, ml.variant_resolved,
  ml.listing_url AS cheapest_url,
  ml.source AS cheapest_source,
  ml.seller_name
FROM grouped g
JOIN public.market_listings ml 
  ON ml.fingerprint_hash = g.fingerprint_hash 
  AND ml.price = g.lowest_price
  AND ml.last_seen_at > now() - interval '14 days'
ORDER BY g.price_spread DESC;