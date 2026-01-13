-- Buy Window summary RPC
CREATE OR REPLACE FUNCTION public.get_buy_window_summary()
RETURNS TABLE(
  total bigint,
  auctions bigint,
  traps bigint,
  unassigned bigint,
  assigned bigint,
  top_unassigned jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT
      id,
      source_class,
      source,
      make,
      model,
      variant_used,
      year,
      km,
      location,
      buy_window_at,
      watch_reason,
      watch_confidence,
      assigned_to,
      assigned_at,
      listing_url
    FROM public.vehicle_listings
    WHERE watch_status = 'buy_window'
      AND COALESCE(sold_returned_suspected, false) = false
      AND COALESCE(watch_status, '') <> 'avoid'
  ),
  counts AS (
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE source_class = 'auction')::bigint AS auctions,
      COUNT(*) FILTER (WHERE source_class <> 'auction')::bigint AS traps,
      COUNT(*) FILTER (WHERE assigned_to IS NULL)::bigint AS unassigned,
      COUNT(*) FILTER (WHERE assigned_to IS NOT NULL)::bigint AS assigned
    FROM base
  ),
  top_unassigned_rows AS (
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'source_class', source_class,
          'source', source,
          'make', make,
          'model', model,
          'variant', COALESCE(variant_used, ''),
          'year', year,
          'km', km,
          'location', location,
          'buy_window_at', buy_window_at,
          'watch_reason', watch_reason,
          'watch_confidence', watch_confidence,
          'listing_url', listing_url
        )
        ORDER BY buy_window_at DESC NULLS LAST
      ) AS items
    FROM (
      SELECT *
      FROM base
      WHERE assigned_to IS NULL
      ORDER BY buy_window_at DESC NULLS LAST
      LIMIT 5
    ) t
  )
  SELECT
    c.total,
    c.auctions,
    c.traps,
    c.unassigned,
    c.assigned,
    COALESCE(t.items, '[]'::jsonb) AS top_unassigned
  FROM counts c
  CROSS JOIN top_unassigned_rows t;
$$;