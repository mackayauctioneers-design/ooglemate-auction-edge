CREATE OR REPLACE VIEW public.vw_wbm_clean AS
WITH ranked AS (
  SELECT
    ml.listing_url,
    COALESCE(
      NULLIF(TRIM(BOTH FROM CONCAT_WS(' ', ml.year::text, ml.make, ml.model, ml.variant_raw)), ''),
      ml.make || ' ' || ml.model
    ) AS title,
    ml.make,
    ml.model,
    ml.variant_raw,
    ml.variant_resolved AS badge,
    ml.year,
    ml.km,
    ml.price,
    ml.location,
    ml.state,
    ml.seller_name AS seller,
    ml.price_badge,
    ml.last_seen_at AS scraped_at,
    ml.first_seen_at,
    ml.lifecycle_status,
    jsonb_build_object(
      'source', ml.source,
      'source_listing_id', ml.source_listing_id,
      'make', ml.make,
      'model', ml.model,
      'variant_raw', ml.variant_raw,
      'year', ml.year,
      'km', ml.km,
      'price', ml.price,
      'state', ml.state,
      'location', ml.location,
      'seller_name', ml.seller_name,
      'price_badge', ml.price_badge,
      'market_price', ml.market_price,
      'price_difference', ml.price_difference,
      'last_seen_at', ml.last_seen_at
    ) AS raw_payload,
    ROW_NUMBER() OVER (
      PARTITION BY ml.listing_url
      ORDER BY ml.last_seen_at DESC NULLS LAST, ml.created_at DESC NULLS LAST
    ) AS rn
  FROM public.market_listings ml
  WHERE ml.source = 'Apify_carsales-cheerio'
    AND ml.price_badge IS NOT NULL
    AND lower(ml.price_badge) IN ('well below market', 'below market')
    AND ml.year IS NOT NULL AND ml.year >= 2015
    AND ml.price IS NOT NULL AND ml.price > 0
    AND ml.make IS NOT NULL
    AND ml.model IS NOT NULL
    AND ml.listing_url IS NOT NULL
    AND (
      ml.lifecycle_status IS NULL
      OR upper(ml.lifecycle_status) NOT IN ('SOLD','DEAD','UNAVAILABLE','REMOVED','INACTIVE')
    )
)
SELECT
  listing_url, title, make, model, badge, variant_raw, year, km, price,
  location, state, seller, price_badge, scraped_at, first_seen_at,
  lifecycle_status, raw_payload
FROM ranked
WHERE rn = 1;

GRANT SELECT ON public.vw_wbm_clean TO authenticated, service_role, anon;