
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

  IF ev.source = 'Apify_carsales-cheerio' THEN
    v_source_listing_id := COALESCE(
      ev.source_record_id,
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
        CASE WHEN jsonb_typeof(p->'images') = 'array' AND jsonb_array_length(p->'images') > 0
             THEN p->'images'
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

  UPDATE public.raw_ingest_events
    SET ingestion_status = 'skipped', error_message = 'no router for source'
    WHERE id = _raw_event_id;
  RETURN jsonb_build_object('ok', false, 'skipped', true, 'source', ev.source);
END;
$$;
