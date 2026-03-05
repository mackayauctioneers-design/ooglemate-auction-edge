CREATE OR REPLACE FUNCTION public.rpc_ingestion_audit_sources()
RETURNS TABLE(
  source text,
  total bigint,
  active bigint,
  added_24h bigint,
  updated_24h bigint,
  older_30d bigint,
  last_scrape timestamptz,
  zombie_pct integer
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH combined AS (
    SELECT
      COALESCE(vl.source, 'unknown') AS source,
      vl.first_seen_at,
      vl.last_seen_at,
      CASE WHEN vl.status IN ('catalogue','listed') THEN true ELSE false END AS is_active
    FROM vehicle_listings vl

    UNION ALL

    SELECT
      COALESCE(rl.source, 'unknown') AS source,
      rl.first_seen_at,
      rl.last_seen_at,
      CASE WHEN rl.lifecycle_status IN ('active','listed') OR rl.delisted_at IS NULL THEN true ELSE false END AS is_active
    FROM retail_listings rl
  )
  SELECT
    c.source,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE c.is_active) AS active,
    COUNT(*) FILTER (WHERE c.first_seen_at >= NOW() - INTERVAL '24 hours') AS added_24h,
    COUNT(*) FILTER (WHERE c.last_seen_at >= NOW() - INTERVAL '24 hours') AS updated_24h,
    COUNT(*) FILTER (WHERE c.last_seen_at < NOW() - INTERVAL '14 days') AS older_30d,
    MAX(c.last_seen_at) AS last_scrape,
    CASE WHEN COUNT(*) > 0
      THEN (COUNT(*) FILTER (WHERE c.last_seen_at < NOW() - INTERVAL '14 days') * 100 / COUNT(*))::integer
      ELSE 0
    END AS zombie_pct
  FROM combined c
  GROUP BY c.source
  ORDER BY COUNT(*) DESC;
$$;