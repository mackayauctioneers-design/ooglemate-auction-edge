-- =============================================
-- PRICE HISTORY TRACKING
-- =============================================

-- 1) Create listing_price_history table
CREATE TABLE IF NOT EXISTS public.listing_price_history (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  source_listing_id text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid,
  price integer NOT NULL,
  currency text DEFAULT 'AUD'
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pricehist_lookup
  ON public.listing_price_history (source, source_listing_id, observed_at DESC);

-- Prevent duplicate history entries per run
CREATE UNIQUE INDEX IF NOT EXISTS uq_pricehist_per_run
  ON public.listing_price_history (source, source_listing_id, run_id)
  WHERE run_id IS NOT NULL;

-- 2) Add price tracking columns to retail_listings
ALTER TABLE public.retail_listings
  ADD COLUMN IF NOT EXISTS last_price integer,
  ADD COLUMN IF NOT EXISTS last_price_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS price_change_count int DEFAULT 0;

-- 3) Upgrade upsert_retail_listing to write price history on change
CREATE OR REPLACE FUNCTION public.upsert_retail_listing(
  p_source text,
  p_source_listing_id text,
  p_listing_url text,
  p_year integer,
  p_make text,
  p_model text,
  p_variant_raw text DEFAULT NULL::text,
  p_variant_family text DEFAULT NULL::text,
  p_km integer DEFAULT NULL::integer,
  p_asking_price integer DEFAULT NULL::integer,
  p_state text DEFAULT NULL::text,
  p_suburb text DEFAULT NULL::text,
  p_run_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(listing_id uuid, identity_id uuid, is_new boolean, price_changed boolean, evaluation_result text, was_relisted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_listing_id UUID;
  v_identity_id UUID;
  v_is_new BOOLEAN := FALSE;
  v_price_changed BOOLEAN := FALSE;
  v_was_relisted BOOLEAN := FALSE;
  v_old_price INTEGER;
  v_eval_result TEXT := NULL;
  v_existing RECORD;
BEGIN
  -- Check if listing exists
  SELECT rl.id, rl.asking_price, rl.last_price, rl.identity_id, rl.delisted_at, rl.lifecycle_status
  INTO v_existing
  FROM retail_listings rl
  WHERE rl.source = p_source AND rl.source_listing_id = p_source_listing_id;

  IF v_existing.id IS NULL THEN
    -- ===================
    -- NEW LISTING
    -- ===================
    v_is_new := TRUE;
    
    INSERT INTO retail_listings (
      source, source_listing_id, listing_url, year, make, model,
      variant_raw, variant_family, km, asking_price, state, suburb,
      first_seen_at, last_seen_at, lifecycle_status, times_seen, last_seen_run_id,
      last_price, last_price_changed_at, price_change_count
    ) VALUES (
      p_source, p_source_listing_id, p_listing_url, p_year,
      UPPER(TRIM(p_make)), UPPER(TRIM(p_model)),
      NULLIF(TRIM(p_variant_raw), ''), NULLIF(TRIM(p_variant_family), ''),
      p_km, p_asking_price, UPPER(TRIM(p_state)), p_suburb,
      now(), now(), 'ACTIVE', 1, p_run_id,
      p_asking_price, now(), 0
    )
    RETURNING id INTO v_listing_id;
    
    -- Write first price history record
    IF p_asking_price IS NOT NULL AND p_asking_price > 0 THEN
      INSERT INTO listing_price_history (source, source_listing_id, observed_at, run_id, price)
      VALUES (p_source, p_source_listing_id, now(), p_run_id, p_asking_price);
    END IF;
    
  ELSE
    -- ===================
    -- EXISTING LISTING
    -- ===================
    v_listing_id := v_existing.id;
    v_old_price := COALESCE(v_existing.last_price, v_existing.asking_price);
    
    -- Detect price change (only if new price is valid and different)
    v_price_changed := (
      p_asking_price IS NOT NULL 
      AND p_asking_price > 0 
      AND p_asking_price IS DISTINCT FROM v_old_price
    );
    
    -- Check if this is a relist (was DELISTED, now seen again)
    IF v_existing.lifecycle_status = 'DELISTED' THEN
      v_was_relisted := TRUE;
    END IF;

    -- Update the listing
    UPDATE retail_listings SET
      last_seen_at = now(),
      asking_price = COALESCE(p_asking_price, asking_price),
      price_changed_at = CASE WHEN v_price_changed THEN now() ELSE price_changed_at END,
      delisted_at = NULL,
      lifecycle_status = CASE 
        WHEN v_existing.lifecycle_status = 'DELISTED' THEN 'RELISTED'
        ELSE 'ACTIVE'
      END,
      relisted_at = CASE 
        WHEN v_existing.lifecycle_status = 'DELISTED' THEN now()
        ELSE relisted_at
      END,
      times_seen = COALESCE(times_seen, 0) + 1,
      last_seen_run_id = COALESCE(p_run_id, last_seen_run_id),
      -- Price tracking updates
      last_price = CASE WHEN v_price_changed THEN p_asking_price ELSE last_price END,
      last_price_changed_at = CASE WHEN v_price_changed THEN now() ELSE last_price_changed_at END,
      price_change_count = CASE WHEN v_price_changed THEN COALESCE(price_change_count, 0) + 1 ELSE price_change_count END
    WHERE id = v_listing_id;
    
    -- Write price history ONLY on change
    IF v_price_changed THEN
      INSERT INTO listing_price_history (source, source_listing_id, observed_at, run_id, price)
      VALUES (p_source, p_source_listing_id, now(), p_run_id, p_asking_price)
      ON CONFLICT DO NOTHING;  -- Prevent duplicate per run
    END IF;
  END IF;

  -- Return results
  RETURN QUERY SELECT 
    v_listing_id,
    v_identity_id,
    v_is_new,
    v_price_changed,
    v_eval_result,
    v_was_relisted;
END;
$$;