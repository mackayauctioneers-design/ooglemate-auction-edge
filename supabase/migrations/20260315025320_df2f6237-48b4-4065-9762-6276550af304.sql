
-- Dedup table for well-below-market alerts
CREATE TABLE IF NOT EXISTS public.well_below_market_alerts_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id text NOT NULL UNIQUE,
  alerted boolean NOT NULL DEFAULT false,
  reason text,
  median_sell_price numeric,
  below_pct numeric,
  comp_count integer,
  thin_data boolean DEFAULT false,
  whatsapp_sent boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable pg_net extension if not already
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Trigger function: fires on retail_listings INSERT/UPDATE with well below market badge
CREATE OR REPLACE FUNCTION public.trigger_well_below_market_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _payload jsonb;
  _url text;
  _anon_key text;
BEGIN
  -- Only fire on 'well below market' badge (case-insensitive)
  IF NEW.price_badge IS NULL OR lower(NEW.price_badge) NOT LIKE '%well below market%' THEN
    RETURN NEW;
  END IF;

  -- Quick dedup: skip if already sent
  IF EXISTS (SELECT 1 FROM well_below_market_alerts_sent WHERE listing_id = NEW.id::text) THEN
    RETURN NEW;
  END IF;

  -- Build payload
  _payload := jsonb_build_object(
    'listing_id', NEW.id,
    'make', NEW.make,
    'model', NEW.model,
    'variant', COALESCE(NEW.variant_raw, NEW.variant_family),
    'year', NEW.year,
    'price', NEW.asking_price,
    'km', NEW.km,
    'listing_url', NEW.listing_url,
    'state', NEW.state
  );

  -- Construct edge function URL
  _url := 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/well-below-market-alert';
  _anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmNoeHNidXduZ2Ztd3ZzdmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzY4NzIsImV4cCI6MjA4MjY1Mjg3Mn0.EAtZMU4QRmk00Gomr7R25LR0OyJqZtMQA9ZK-7M19hM';

  -- Call edge function via pg_net (async, non-blocking)
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

-- Create trigger on retail_listings
DROP TRIGGER IF EXISTS trg_well_below_market_alert ON public.retail_listings;

CREATE TRIGGER trg_well_below_market_alert
  AFTER INSERT OR UPDATE OF price_badge
  ON public.retail_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_well_below_market_alert();
