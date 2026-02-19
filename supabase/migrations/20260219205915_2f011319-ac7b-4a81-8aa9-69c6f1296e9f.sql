
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
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    COALESCE(vl.source, 'unknown') AS source,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE vl.status IN ('catalogue','listed')) AS active,
    COUNT(*) FILTER (WHERE vl.first_seen_at >= NOW() - INTERVAL '24 hours') AS added_24h,
    COUNT(*) FILTER (WHERE vl.last_seen_at >= NOW() - INTERVAL '24 hours') AS updated_24h,
    COUNT(*) FILTER (WHERE vl.first_seen_at < NOW() - INTERVAL '30 days') AS older_30d,
    MAX(vl.last_seen_at) AS last_scrape,
    CASE WHEN COUNT(*) > 0
      THEN (COUNT(*) FILTER (WHERE vl.first_seen_at < NOW() - INTERVAL '30 days') * 100 / COUNT(*))::integer
      ELSE 0
    END AS zombie_pct
  FROM vehicle_listings vl
  GROUP BY COALESCE(vl.source, 'unknown')
  ORDER BY COUNT(*) DESC;
$$;
