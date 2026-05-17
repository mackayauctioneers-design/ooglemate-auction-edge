
-- Ensure pg_net is available for async HTTP from triggers
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.retail_listings_wbm_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_badge text := COALESCE(NEW.price_badge, '');
  v_is_below boolean := v_badge ILIKE '%below market%';
  v_listing_id text;
  v_url text := COALESCE(NEW.listing_url, '');
BEGIN
  -- Only act on rows with a below-market badge and required fields
  IF NOT v_is_below THEN RETURN NEW; END IF;
  IF NEW.make IS NULL OR NEW.model IS NULL OR NEW.year IS NULL
     OR NEW.asking_price IS NULL OR v_url = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.year < 2015 THEN RETURN NEW; END IF;

  -- On UPDATE, only fire when badge transitions INTO below-market
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.price_badge, '') ILIKE '%below market%' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Stable synthetic id from URL for dedup downstream
  v_listing_id := 'rl-' || substr(md5(v_url), 1, 16);

  PERFORM net.http_post(
    url := 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/well-below-market-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmNoeHNidXduZ2Ztd3ZzdmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzY4NzIsImV4cCI6MjA4MjY1Mjg3Mn0.EAtZMU4QRmk00Gomr7R25LR0OyJqZtMQA9ZK-7M19hM'
    ),
    body := jsonb_build_object(
      'listing_id',  v_listing_id,
      'make',        NEW.make,
      'model',       NEW.model,
      'variant',     NEW.variant_raw,
      'year',        NEW.year,
      'price',       NEW.asking_price,
      'km',          NEW.km,
      'listing_url', NEW.listing_url,
      'state',       NEW.state,
      'price_badge', NEW.price_badge,
      'source_table','retail_listings'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retail_listings_wbm_alert ON public.retail_listings;
CREATE TRIGGER trg_retail_listings_wbm_alert
AFTER INSERT OR UPDATE OF price_badge ON public.retail_listings
FOR EACH ROW
EXECUTE FUNCTION public.retail_listings_wbm_alert();
