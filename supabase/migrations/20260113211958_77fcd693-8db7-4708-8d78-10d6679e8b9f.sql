-- Sales Sync Health RPC
CREATE OR REPLACE FUNCTION public.get_sales_sync_health()
RETURNS TABLE(
  total_rows bigint,
  latest_sale_date date,
  latest_updated_at timestamptz,
  sync_freshness_hours numeric,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT
      COUNT(*)::bigint AS total_rows,
      MAX(sale_date) AS latest_sale_date,
      MAX(updated_at) AS latest_updated_at
    FROM public.sales_normalised
  ),
  calc AS (
    SELECT
      b.*,
      CASE
        WHEN b.latest_updated_at IS NULL THEN NULL
        ELSE ROUND(EXTRACT(EPOCH FROM (now() - b.latest_updated_at)) / 3600.0, 2)
      END AS freshness_hours
    FROM base b
  )
  SELECT
    c.total_rows,
    c.latest_sale_date,
    c.latest_updated_at,
    c.freshness_hours AS sync_freshness_hours,
    CASE
      WHEN c.total_rows = 0 THEN 'empty'
      WHEN c.latest_updated_at IS NULL THEN 'broken'
      WHEN c.freshness_hours <= 18 THEN 'fresh'
      WHEN c.freshness_hours <= 48 THEN 'stale'
      ELSE 'critical'
    END AS status
  FROM calc c;
$$;