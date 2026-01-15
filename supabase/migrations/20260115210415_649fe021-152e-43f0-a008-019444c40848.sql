-- =============================================
-- SOLD-THEN-RETURNED ANOMALY V1
-- =============================================

-- 1) Add anomaly tracking columns to retail_listings
ALTER TABLE public.retail_listings
  ADD COLUMN IF NOT EXISTS anomaly_sold_returned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sold_returned_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS risk_flags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS exclude_from_alerts boolean NOT NULL DEFAULT false;

-- 2) Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_retail_listings_sold_returned
  ON public.retail_listings (source, anomaly_sold_returned)
  WHERE anomaly_sold_returned = true;

CREATE INDEX IF NOT EXISTS idx_retail_listings_exclude_alerts
  ON public.retail_listings (source, exclude_from_alerts)
  WHERE exclude_from_alerts = true;

-- 3) Update upsert_retail_listing RPC with sold-returned detection
CREATE OR REPLACE FUNCTION public.upsert_retail_listing(
  p_source text,
  p_source_listing_id text,
  p_make text,
  p_model text,
  p_variant text DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_km integer DEFAULT NULL,
  p_asking_price integer DEFAULT NULL,
  p_listing_url text DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_dealer_name text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_transmission text DEFAULT NULL,
  p_fuel text DEFAULT NULL,
  p_body_type text DEFAULT NULL,
  p_colour text DEFAULT NULL,
  p_run_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_existing_status text;
  v_existing_delisted_at timestamptz;
  v_existing_last_price integer;
  v_existing_anomaly_sold_returned boolean;
  v_is_new boolean := false;
  v_is_relisted boolean := false;
  v_price_changed boolean := false;
  v_sold_returned_triggered boolean := false;
  v_result_id uuid;
  v_return_window interval := interval '14 days';
BEGIN
  -- Check for existing listing
  SELECT id, lifecycle_status, delisted_at, last_price, anomaly_sold_returned
  INTO v_existing_id, v_existing_status, v_existing_delisted_at, v_existing_last_price, v_existing_anomaly_sold_returned
  FROM retail_listings
  WHERE source = p_source AND source_listing_id = p_source_listing_id;

  IF v_existing_id IS NULL THEN
    -- INSERT: New listing
    v_is_new := true;
    
    INSERT INTO retail_listings (
      source, source_listing_id, make, model, variant, year, km,
      asking_price, listing_url, image_url, dealer_name, location, state,
      transmission, fuel, body_type, colour,
      first_seen_at, last_seen_at, times_seen, lifecycle_status, last_seen_run_id,
      last_price, last_price_changed_at, price_change_count,
      anomaly_sold_returned, sold_returned_at, risk_flags, exclude_from_alerts
    )
    VALUES (
      p_source, p_source_listing_id, p_make, p_model, p_variant, p_year, p_km,
      p_asking_price, p_listing_url, p_image_url, p_dealer_name, p_location, p_state,
      p_transmission, p_fuel, p_body_type, p_colour,
      now(), now(), 1, 'ACTIVE', p_run_id,
      p_asking_price, now(), 0,
      false, null, '{}'::text[], false
    )
    RETURNING id INTO v_result_id;

    -- Write initial price history row
    IF p_asking_price IS NOT NULL AND p_asking_price > 0 THEN
      INSERT INTO listing_price_history (source, source_listing_id, run_id, price, currency)
      VALUES (p_source, p_source_listing_id, p_run_id, p_asking_price, 'AUD')
      ON CONFLICT DO NOTHING;
    END IF;

  ELSE
    -- UPDATE: Existing listing
    v_result_id := v_existing_id;

    -- Detect DELISTED → RELISTED transition within return window
    IF v_existing_status = 'DELISTED' THEN
      v_is_relisted := true;
      
      -- Check if within sold-returned window (14 days)
      IF v_existing_delisted_at IS NOT NULL 
         AND (now() - v_existing_delisted_at) <= v_return_window
         AND NOT COALESCE(v_existing_anomaly_sold_returned, false) THEN
        v_sold_returned_triggered := true;
      END IF;
    END IF;

    -- Detect price change
    IF p_asking_price IS NOT NULL 
       AND p_asking_price > 0 
       AND v_existing_last_price IS NOT NULL
       AND p_asking_price != v_existing_last_price THEN
      v_price_changed := true;
    END IF;

    -- Update the listing
    UPDATE retail_listings
    SET
      make = COALESCE(p_make, make),
      model = COALESCE(p_model, model),
      variant = COALESCE(p_variant, variant),
      year = COALESCE(p_year, year),
      km = COALESCE(p_km, km),
      asking_price = COALESCE(p_asking_price, asking_price),
      listing_url = COALESCE(p_listing_url, listing_url),
      image_url = COALESCE(p_image_url, image_url),
      dealer_name = COALESCE(p_dealer_name, dealer_name),
      location = COALESCE(p_location, location),
      state = COALESCE(p_state, state),
      transmission = COALESCE(p_transmission, transmission),
      fuel = COALESCE(p_fuel, fuel),
      body_type = COALESCE(p_body_type, body_type),
      colour = COALESCE(p_colour, colour),
      last_seen_at = now(),
      times_seen = times_seen + 1,
      last_seen_run_id = COALESCE(p_run_id, last_seen_run_id),
      -- Lifecycle status: RELISTED if was DELISTED, else ACTIVE
      lifecycle_status = CASE 
        WHEN v_is_relisted THEN 'RELISTED'
        ELSE 'ACTIVE'
      END,
      -- Clear delisted_at and set relisted_at when relisting
      delisted_at = CASE WHEN v_is_relisted THEN NULL ELSE delisted_at END,
      relisted_at = CASE WHEN v_is_relisted THEN now() ELSE relisted_at END,
      -- Price tracking updates
      last_price = CASE 
        WHEN v_price_changed THEN p_asking_price
        WHEN last_price IS NULL AND p_asking_price > 0 THEN p_asking_price
        ELSE last_price
      END,
      last_price_changed_at = CASE 
        WHEN v_price_changed THEN now()
        WHEN last_price IS NULL AND p_asking_price > 0 THEN now()
        ELSE last_price_changed_at
      END,
      price_change_count = CASE 
        WHEN v_price_changed THEN price_change_count + 1
        ELSE price_change_count
      END,
      -- Sold-returned anomaly flags (sticky - never cleared once set)
      anomaly_sold_returned = CASE 
        WHEN v_sold_returned_triggered THEN true
        ELSE anomaly_sold_returned
      END,
      sold_returned_at = CASE 
        WHEN v_sold_returned_triggered THEN now()
        ELSE sold_returned_at
      END,
      exclude_from_alerts = CASE 
        WHEN v_sold_returned_triggered THEN true
        ELSE exclude_from_alerts
      END,
      risk_flags = CASE 
        WHEN v_sold_returned_triggered AND NOT ('SOLD_RETURNED' = ANY(risk_flags)) 
          THEN array_append(risk_flags, 'SOLD_RETURNED')
        ELSE risk_flags
      END,
      updated_at = now()
    WHERE id = v_existing_id;

    -- Write price history on change (or first price observation)
    IF v_price_changed THEN
      INSERT INTO listing_price_history (source, source_listing_id, run_id, price, currency)
      VALUES (p_source, p_source_listing_id, p_run_id, p_asking_price, 'AUD')
      ON CONFLICT DO NOTHING;
    ELSIF v_existing_last_price IS NULL AND p_asking_price IS NOT NULL AND p_asking_price > 0 THEN
      -- First price observation for existing listing without price
      INSERT INTO listing_price_history (source, source_listing_id, run_id, price, currency)
      VALUES (p_source, p_source_listing_id, p_run_id, p_asking_price, 'AUD')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_result_id,
    'is_new', v_is_new,
    'is_relisted', v_is_relisted,
    'price_changed', v_price_changed,
    'sold_returned_triggered', v_sold_returned_triggered
  );
END;
$$;