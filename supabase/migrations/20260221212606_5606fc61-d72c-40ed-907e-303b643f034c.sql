DROP FUNCTION IF EXISTS public.mark_listings_delisted(text, interval);

CREATE OR REPLACE FUNCTION public.mark_listings_delisted(p_source text, p_stale_interval interval DEFAULT '3 days'::interval)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
DECLARE
  affected_count integer := 0;
  batch_count integer;
BEGIN
  -- Process in a single bulk UPDATE (skip events for performance on large backlog)
  UPDATE public.retail_listings
  SET lifecycle_status = 'DELISTED', delisted_at = now()
  WHERE source = p_source
    AND lifecycle_status = 'ACTIVE'
    AND last_seen_at < (now() - p_stale_interval);

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$;