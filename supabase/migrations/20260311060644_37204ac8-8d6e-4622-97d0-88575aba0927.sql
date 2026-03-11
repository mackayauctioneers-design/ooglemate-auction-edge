
CREATE OR REPLACE FUNCTION public.compute_comparable_median(
  p_listing_id uuid,
  p_make text,
  p_model text,
  p_year int,
  p_km int,
  p_asking_price numeric
)
RETURNS TABLE(
  median_price numeric,
  comp_count int,
  p25_price numeric,
  p75_price numeric,
  confidence text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH comps AS (
    SELECT asking_price
    FROM retail_listings
    WHERE UPPER(make) = UPPER(p_make)
      AND UPPER(model) = UPPER(p_model)
      AND year BETWEEN (p_year - 1) AND (p_year + 1)
      AND lifecycle_status IN ('ACTIVE', 'NEW')
      AND asking_price > 0
      AND id != p_listing_id
      -- KM filter: only apply if subject has >10k km, and require comp within ±30%
      AND (
        p_km IS NULL 
        OR p_km < 10000 
        OR km IS NULL 
        OR km BETWEEN (p_km * 0.7)::int AND (p_km * 1.3)::int
      )
  ),
  trimmed AS (
    SELECT asking_price
    FROM comps
    WHERE asking_price >= (SELECT percentile_cont(0.05) WITHIN GROUP (ORDER BY asking_price) FROM comps)
      AND asking_price <= (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY asking_price) FROM comps)
  )
  SELECT
    percentile_cont(0.5) WITHIN GROUP (ORDER BY asking_price)::numeric AS median_price,
    count(*)::int AS comp_count,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY asking_price)::numeric AS p25_price,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY asking_price)::numeric AS p75_price,
    CASE
      WHEN count(*) >= 10 THEN 'HIGH'
      WHEN count(*) >= 5 THEN 'MEDIUM'
      WHEN count(*) >= 3 THEN 'LOW'
      ELSE 'INSUFFICIENT'
    END AS confidence
  FROM trimmed;
$$;
