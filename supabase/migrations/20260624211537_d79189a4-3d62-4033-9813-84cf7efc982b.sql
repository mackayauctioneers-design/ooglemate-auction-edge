
-- Phase 1: raw_ingest_events — append-only raw audit for every scraper
CREATE TABLE IF NOT EXISTS public.raw_ingest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_run_id text,
  source_record_id text,
  listing_url text,
  raw_payload jsonb NOT NULL,
  scraped_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  ingestion_status text NOT NULL DEFAULT 'pending',  -- pending | normalised | failed | skipped
  normalised_at timestamptz,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_raw_ingest_source_received ON public.raw_ingest_events (source, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_ingest_status ON public.raw_ingest_events (ingestion_status, received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_ingest_source_record
  ON public.raw_ingest_events (source, source_record_id)
  WHERE source_record_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.raw_ingest_events TO authenticated;
GRANT ALL ON public.raw_ingest_events TO service_role;

ALTER TABLE public.raw_ingest_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access raw_ingest_events"
  ON public.raw_ingest_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "operators read raw_ingest_events"
  ON public.raw_ingest_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Phase 2: normalise_market_listing — router from raw event to per-source normalised table.
-- Reference implementation: Apify_carsales-cheerio → retail_listings.
-- Other sources will be added incrementally; unknown sources return 'skipped'.
CREATE OR REPLACE FUNCTION public.normalise_market_listing(_raw_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev public.raw_ingest_events%ROWTYPE;
  p jsonb;
  v_source_listing_id text;
  v_state text;
  v_loc text;
BEGIN
  SELECT * INTO ev FROM public.raw_ingest_events WHERE id = _raw_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'raw event not found');
  END IF;

  p := ev.raw_payload;

  -- Router by source
  IF ev.source = 'Apify_carsales-cheerio' THEN
    v_source_listing_id := COALESCE(
      ev.source_record_id,
      (regexp_match(COALESCE(ev.listing_url,''), '(SSE|OAG)-AD-(\d+)', 'i'))[1] || '-AD-' ||
      (regexp_match(COALESCE(ev.listing_url,''), '(SSE|OAG)-AD-(\d+)', 'i'))[2],
      ev.listing_url
    );

    v_loc := p->>'location';
    v_state := upper((regexp_match(COALESCE(v_loc,''), '\m(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\M', 'i'))[1]);

    BEGIN
      INSERT INTO public.retail_listings (
        source, source_listing_id, listing_url, year, make, model,
        variant_raw, badge, asking_price, km, state, region_raw,
        title, colour, fuel_type, transmission, body_type,
        seller_name_raw, seller_type, image_urls,
        price_badge, market_price, source_type, lifecycle_status,
        last_seen_at, updated_at
      ) VALUES (
        'Apify_carsales-cheerio',
        v_source_listing_id,
        ev.listing_url,
        NULLIF(p->>'year','')::int,
        upper(trim(p->>'make')),
        upper(trim(p->>'model')),
        p->>'variant_raw',
        p->>'variant_raw',
        NULLIF(p->>'price','')::numeric::int,
        NULLIF(p->>'mileage','')::numeric::int,
        v_state,
        v_loc,
        p->>'title',
        p->>'colour',
        p->>'fuel_type',
        p->>'transmission',
        p->>'body_type',
        p->>'seller_name',
        COALESCE(p->>'seller_type','unknown'),
        CASE WHEN jsonb_typeof(p->'images') = 'array'
             THEN ARRAY(SELECT jsonb_array_elements_text(p->'images'))
             ELSE NULL END,
        p->>'price_badge',
        NULLIF(p->>'market_price','')::numeric::int,
        'RETAIL',
        'ACTIVE',
        COALESCE(ev.scraped_at, now()),
        now()
      )
      ON CONFLICT (source, source_listing_id) DO UPDATE SET
        listing_url = EXCLUDED.listing_url,
        asking_price = EXCLUDED.asking_price,
        km = COALESCE(EXCLUDED.km, retail_listings.km),
        price_badge = EXCLUDED.price_badge,
        market_price = EXCLUDED.market_price,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = now();

      UPDATE public.raw_ingest_events
        SET ingestion_status = 'normalised', normalised_at = now(), error_message = NULL
        WHERE id = _raw_event_id;

      RETURN jsonb_build_object('ok', true, 'source', ev.source, 'source_listing_id', v_source_listing_id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.raw_ingest_events
        SET ingestion_status = 'failed', error_message = SQLERRM
        WHERE id = _raw_event_id;
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
    END;
  END IF;

  -- Unknown source — leave raw event for future router
  UPDATE public.raw_ingest_events
    SET ingestion_status = 'skipped', error_message = 'no router for source'
    WHERE id = _raw_event_id;
  RETURN jsonb_build_object('ok', false, 'skipped', true, 'source', ev.source);
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalise_market_listing(uuid) TO service_role, authenticated;

-- Phase 4: ingestion_health — freshness view across all sources writing to raw_ingest_events
CREATE OR REPLACE VIEW public.ingestion_health AS
WITH raw_stats AS (
  SELECT
    source,
    max(scraped_at) AS latest_scraped_at,
    max(received_at) AS latest_received_at,
    count(*) FILTER (WHERE received_at > now() - interval '1 hour')  AS records_last_1h,
    count(*) FILTER (WHERE received_at > now() - interval '24 hours') AS records_last_24h,
    count(*) FILTER (WHERE ingestion_status = 'normalised' AND normalised_at > now() - interval '24 hours') AS normalised_last_24h,
    count(*) FILTER (WHERE ingestion_status = 'failed' AND received_at > now() - interval '24 hours') AS failed_last_24h
  FROM public.raw_ingest_events
  GROUP BY source
)
SELECT
  source,
  latest_scraped_at,
  latest_received_at,
  records_last_1h,
  records_last_24h,
  normalised_last_24h,
  failed_last_24h,
  CASE
    WHEN latest_received_at > now() - interval '2 hours'  THEN 'live'
    WHEN latest_received_at > now() - interval '24 hours' THEN 'stale'
    ELSE 'dead'
  END AS status
FROM raw_stats
ORDER BY latest_received_at DESC NULLS LAST;

GRANT SELECT ON public.ingestion_health TO authenticated, service_role;
