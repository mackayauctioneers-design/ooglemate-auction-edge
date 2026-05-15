-- 1. Add price_badge to scanned_deals so Apify ingest stops dropping the signal
ALTER TABLE public.scanned_deals
  ADD COLUMN IF NOT EXISTS price_badge text,
  ADD COLUMN IF NOT EXISTS market_price numeric,
  ADD COLUMN IF NOT EXISTS price_difference numeric;

CREATE INDEX IF NOT EXISTS idx_scanned_deals_price_badge
  ON public.scanned_deals (price_badge)
  WHERE price_badge IS NOT NULL;

-- 2. Attach the existing trigger_well_below_market_alert to retail_listings
DROP TRIGGER IF EXISTS trg_wbm_alert_retail_listings ON public.retail_listings;
CREATE TRIGGER trg_wbm_alert_retail_listings
AFTER INSERT OR UPDATE OF price_badge ON public.retail_listings
FOR EACH ROW
EXECUTE FUNCTION public.trigger_well_below_market_alert();

-- 3. Adapter function for cheap_car_queue (auction lane has `location`, not `state`)
CREATE OR REPLACE FUNCTION public.trigger_wbm_alert_cheap_car_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _payload jsonb;
  _url text := 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/well-below-market-alert';
  _anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmNoeHNidXduZ2Ztd3ZzdmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzY4NzIsImV4cCI6MjA4MjY1Mjg3Mn0.EAtZMU4QRmk00Gomr7R25LR0OyJqZtMQA9ZK-7M19hM';
BEGIN
  IF NEW.price_badge IS NULL OR lower(NEW.price_badge) NOT LIKE '%well below market%' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM well_below_market_alerts_sent WHERE listing_id = NEW.id::text) THEN
    RETURN NEW;
  END IF;

  _payload := jsonb_build_object(
    'listing_id', NEW.id,
    'make', NEW.make,
    'model', NEW.model,
    'variant', COALESCE(NEW.variant_raw, NEW.variant_family),
    'year', NEW.year,
    'price', COALESCE(NEW.asking_price, NEW.highest_bid, NEW.reserve),
    'km', NEW.km,
    'listing_url', NEW.listing_url,
    'state', NULL,
    'location', NEW.location,
    'source_table', 'cheap_car_queue'
  );

  PERFORM net.http_post(
    url := _url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _anon_key
    ),
    body := _payload
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wbm_alert_cheap_car_queue ON public.cheap_car_queue;
CREATE TRIGGER trg_wbm_alert_cheap_car_queue
AFTER INSERT OR UPDATE OF price_badge ON public.cheap_car_queue
FOR EACH ROW
EXECUTE FUNCTION public.trigger_wbm_alert_cheap_car_queue();