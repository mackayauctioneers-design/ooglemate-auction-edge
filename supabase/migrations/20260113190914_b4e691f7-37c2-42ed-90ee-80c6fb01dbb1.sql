-- RPC to fetch recent events by source
CREATE OR REPLACE FUNCTION public.get_auction_source_events(
  p_source_key text,
  p_limit int DEFAULT 25
)
RETURNS TABLE(
  id uuid,
  source_key text,
  event_type text,
  message text,
  meta jsonb,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    e.id,
    e.source_key,
    e.event_type,
    e.message,
    e.meta,
    e.created_at
  FROM public.auction_source_events e
  WHERE e.source_key = p_source_key
  ORDER BY e.created_at DESC
  LIMIT LEAST(p_limit, 200);
$$;