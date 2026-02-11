-- Add 403 backoff: extend verify interval for sources that consistently return 403
-- Update the RPC to skip rows with recent 403s (48h backoff)
CREATE OR REPLACE FUNCTION rpc_get_verify_batch(p_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  source_name text,
  source_url text,
  identity_key text,
  last_lifecycle_check_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    id,
    source_name,
    source_url,
    identity_key,
    last_lifecycle_check_at
  FROM hunt_external_candidates
  WHERE lifecycle_status = 'active'
    AND source_url IS NOT NULL
    AND source_url <> ''
    AND (
      last_lifecycle_check_at IS NULL
      OR (
        -- 403/WAF backoff: if last check was 403, wait 48h
        lifecycle_http_status = 403 AND last_lifecycle_check_at < now() - interval '48 hours'
      )
      OR (
        -- Normal non-403 checks
        lifecycle_http_status IS DISTINCT FROM 403
        AND (
          (source_name ILIKE '%pickles%' AND last_lifecycle_check_at < now() - interval '6 hours')
          OR
          (source_name NOT ILIKE '%pickles%' AND last_lifecycle_check_at < now() - interval '24 hours')
        )
      )
    )
  ORDER BY COALESCE(last_lifecycle_check_at, '1970-01-01'::timestamptz) ASC
  LIMIT p_limit;
$$;