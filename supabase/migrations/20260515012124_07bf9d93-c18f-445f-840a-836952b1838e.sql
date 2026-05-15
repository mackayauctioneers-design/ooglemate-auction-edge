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
    'variant', NEW.variant,
    'year', NEW.year,
    'price', NEW.price,
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