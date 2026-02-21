DROP FUNCTION IF EXISTS public.mark_listings_delisted(text, interval);

CREATE OR REPLACE FUNCTION public.mark_listings_delisted(p_source text, p_stale_interval interval DEFAULT '3 days'::interval)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_count integer := 0;
  batch_count integer;
  batch_ids uuid[];
BEGIN
  -- Process in batches of 500 to avoid statement timeout
  LOOP
    -- Get a batch of IDs to process
    SELECT array_agg(id) INTO batch_ids
    FROM (
      SELECT id FROM public.retail_listings
      WHERE source = p_source
        AND lifecycle_status = 'ACTIVE'
        AND last_seen_at < (now() - p_stale_interval)
      LIMIT 500
    ) sub;

    EXIT WHEN batch_ids IS NULL OR array_length(batch_ids, 1) IS NULL;

    -- Insert DELISTED events for this batch
    INSERT INTO public.retail_listing_events (
      event_type, source, source_listing_id, listing_id, event_at, event_date,
      make, model, year, price, days_live, state, suburb, postcode,
      lat, lng, sa2, sa3, sa4, lga, meta
    )
    SELECT 
      'DELISTED', rl.source, rl.source_listing_id, rl.id, now(), CURRENT_DATE,
      rl.make, rl.model, rl.year, rl.asking_price,
      EXTRACT(DAY FROM (now() - rl.first_seen_at))::integer,
      rl.state, rl.suburb, rl.postcode, rl.lat, rl.lng,
      rl.sa2, rl.sa3, rl.sa4, rl.lga,
      jsonb_build_object(
        'first_seen_at', rl.first_seen_at,
        'last_seen_at', rl.last_seen_at,
        'times_seen', rl.times_seen
      )
    FROM public.retail_listings rl
    WHERE rl.id = ANY(batch_ids)
    ON CONFLICT (event_type, source, source_listing_id, event_date) DO NOTHING;

    -- Mark this batch as delisted
    UPDATE public.retail_listings
    SET lifecycle_status = 'DELISTED', delisted_at = now()
    WHERE id = ANY(batch_ids);

    GET DIAGNOSTICS batch_count = ROW_COUNT;
    affected_count := affected_count + batch_count;
  END LOOP;

  RETURN affected_count;
END;
$$;