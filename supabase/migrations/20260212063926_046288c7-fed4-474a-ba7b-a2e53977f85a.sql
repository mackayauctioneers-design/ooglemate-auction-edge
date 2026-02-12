-- Add series, badge, description_raw to vehicle_sales_truth
ALTER TABLE public.vehicle_sales_truth
  ADD COLUMN IF NOT EXISTS series text,
  ADD COLUMN IF NOT EXISTS badge text,
  ADD COLUMN IF NOT EXISTS description_raw text;

-- Add series and badge to sales_target_candidates
ALTER TABLE public.sales_target_candidates
  ADD COLUMN IF NOT EXISTS series text,
  ADD COLUMN IF NOT EXISTS badge text;

-- Recreate fingerprint_opportunities view with correct uuid join
DROP VIEW IF EXISTS public.fingerprint_opportunities;
CREATE VIEW public.fingerprint_opportunities AS
SELECT
  c.id AS candidate_id,
  c.make,
  c.model,
  c.variant,
  c.series,
  c.badge,
  c.median_sale_price,
  c.median_km,
  c.target_score,
  fc.id AS candidate_listing_id,
  fc.year AS listing_year,
  fc.make AS listing_make,
  fc.model AS listing_model,
  fc.variant AS listing_variant,
  fc.kms AS listing_kms,
  fc.price AS listing_price,
  fc.location AS listing_location,
  fc.seller AS listing_seller,
  fc.url AS listing_url,
  fc.source AS listing_source,
  fc.scraped_at,
  fc.match_score,
  fc.upgrade_flag,
  fc.downgrade_flag
FROM public.sales_target_candidates c
JOIN public.firecrawl_candidates fc
  ON fc.fingerprint_id = c.id
WHERE fc.match_score >= 6
ORDER BY fc.match_score DESC, fc.upgrade_flag DESC;