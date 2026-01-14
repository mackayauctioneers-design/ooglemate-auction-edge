-- Update mark_stale_listings_delisted to support optional source filter
CREATE OR REPLACE FUNCTION public.mark_stale_listings_delisted(
  p_stale_days integer DEFAULT 3,
  p_source text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_source IS NOT NULL THEN
    UPDATE retail_listings
    SET delisted_at = now(), updated_at = now()
    WHERE delisted_at IS NULL
      AND source = p_source
      AND last_seen_at < now() - (p_stale_days || ' days')::INTERVAL;
  ELSE
    UPDATE retail_listings
    SET delisted_at = now(), updated_at = now()
    WHERE delisted_at IS NULL
      AND last_seen_at < now() - (p_stale_days || ' days')::INTERVAL;
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;