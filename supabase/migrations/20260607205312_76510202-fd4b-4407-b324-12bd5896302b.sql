CREATE OR REPLACE FUNCTION public.take_market_snapshot()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  rows_inserted INT;
  snap_time TIMESTAMPTZ := date_trunc('hour', now());
BEGIN
  -- market_listings view exposes variant_family / variant_raw / variant_resolved.
  -- Use variant_family for grouping (canonical badge), falling back to UNKNOWN.
  INSERT INTO public.model_market_snapshot (
    make, model, variant_resolved, region, observed_at,
    active_listing_count, avg_price, avg_km, avg_days_on_market
  )
  SELECT
    make,
    model,
    COALESCE(variant_family, 'UNKNOWN'),
    COALESCE(location, 'UNKNOWN'),
    snap_time,
    COUNT(*)::INT,
    ROUND(AVG(asking_price)::NUMERIC, 0),
    ROUND(AVG(km)::NUMERIC, 0),
    ROUND(AVG(EXTRACT(EPOCH FROM (now() - first_seen_at)) / 86400)::NUMERIC, 1)
  FROM public.market_listings
  WHERE make IS NOT NULL
    AND model IS NOT NULL
  GROUP BY make, model, COALESCE(variant_family, 'UNKNOWN'), COALESCE(location, 'UNKNOWN')
  ON CONFLICT (make, model, variant_resolved, region, observed_at) DO UPDATE SET
    active_listing_count = EXCLUDED.active_listing_count,
    avg_price = EXCLUDED.avg_price,
    avg_km = EXCLUDED.avg_km,
    avg_days_on_market = EXCLUDED.avg_days_on_market;

  GET DIAGNOSTICS rows_inserted = ROW_COUNT;
  RETURN rows_inserted;
END;
$function$;