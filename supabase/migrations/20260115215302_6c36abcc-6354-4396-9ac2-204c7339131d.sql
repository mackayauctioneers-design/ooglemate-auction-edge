
-- Fix the two new views to use SECURITY INVOKER instead of SECURITY DEFINER
DROP VIEW IF EXISTS public.offmarket_heatmap_30d;
DROP VIEW IF EXISTS public.model_strength_by_region;

-- Recreate with SECURITY INVOKER
CREATE VIEW public.offmarket_heatmap_30d 
WITH (security_invoker = on)
AS
SELECT 
  state,
  suburb,
  sa2,
  sa3,
  lga,
  make,
  model,
  COUNT(*) as delist_count,
  AVG(days_live)::numeric(10,1) as avg_days_live,
  MIN(event_at) as earliest_delist,
  MAX(event_at) as latest_delist
FROM public.retail_listing_events
WHERE event_type = 'DELISTED'
  AND event_at >= now() - interval '30 days'
GROUP BY state, suburb, sa2, sa3, lga, make, model
ORDER BY delist_count DESC;

CREATE VIEW public.model_strength_by_region
WITH (security_invoker = on)
AS
SELECT 
  state,
  sa3,
  make,
  model,
  COUNT(*) as total_delists,
  COUNT(*) FILTER (WHERE event_at >= now() - interval '7 days') as delists_last_7d,
  COUNT(*) FILTER (WHERE event_at >= now() - interval '30 days') as delists_last_30d,
  AVG(days_live)::numeric(10,1) as avg_days_live,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_live) as median_days_live,
  AVG(price)::integer as avg_price
FROM public.retail_listing_events
WHERE event_type = 'DELISTED'
  AND event_at >= now() - interval '90 days'
GROUP BY state, sa3, make, model
HAVING COUNT(*) >= 3
ORDER BY delists_last_7d DESC, total_delists DESC;

COMMENT ON VIEW public.offmarket_heatmap_30d IS 'Off-market counts by geo + make/model for last 30 days. Use for heatmaps.';
COMMENT ON VIEW public.model_strength_by_region IS 'Model turnover velocity by region. Higher delists_last_7d = faster moving.';
