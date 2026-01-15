-- =============================================
-- LIFECYCLE TRACKING v1 - Full implementation
-- =============================================

-- 1) Add lifecycle columns to retail_listings
ALTER TABLE public.retail_listings
  ADD COLUMN IF NOT EXISTS lifecycle_status text DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS relisted_at timestamptz,
  ADD COLUMN IF NOT EXISTS times_seen int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_run_id uuid;

-- Create indexes for lifecycle queries
CREATE INDEX IF NOT EXISTS idx_retail_listings_source_last_seen
  ON public.retail_listings (source, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_retail_listings_source_status
  ON public.retail_listings (source, lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_retail_listings_lifecycle_status
  ON public.retail_listings (lifecycle_status);

-- 2) Create source_runs table for run tracking
CREATE TABLE IF NOT EXISTS public.source_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  listings_processed int DEFAULT 0,
  listings_new int DEFAULT 0,
  listings_updated int DEFAULT 0,
  meta jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_source_runs_source_started
  ON public.source_runs (source, started_at DESC);

COMMENT ON TABLE public.source_runs IS 'Tracks each ingestion run for lifecycle auditing';

-- No RLS on internal table
ALTER TABLE public.source_runs DISABLE ROW LEVEL SECURITY;

-- 3) Upgrade upsert_retail_listing RPC with lifecycle + run_id
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
  SELECT rl.id, rl.asking_price, rl.identity_id, rl.delisted_at, rl.lifecycle_status
  INTO v_existing
  FROM retail_listings rl
  WHERE rl.source = p_source AND rl.source_listing_id = p_source_listing_id;

  IF v_existing.id IS NULL THEN
    -- New listing
    v_is_new := TRUE;
    INSERT INTO retail_listings (
      source, source_listing_id, listing_url, year, make, model,
      variant_raw, variant_family, km, asking_price, state, suburb,
      first_seen_at, last_seen_at, lifecycle_status, times_seen, last_seen_run_id
    ) VALUES (
      p_source, p_source_listing_id, p_listing_url, p_year,
      UPPER(TRIM(p_make)), UPPER(TRIM(p_model)),
      NULLIF(TRIM(p_variant_raw), ''), NULLIF(TRIM(p_variant_family), ''),
      p_km, p_asking_price, UPPER(TRIM(p_state)), p_suburb,
      now(), now(), 'ACTIVE', 1, p_run_id
    )
    RETURNING id INTO v_listing_id;
  ELSE
    -- Existing listing
    v_listing_id := v_existing.id;
    v_old_price := v_existing.asking_price;
    v_price_changed := (p_asking_price IS DISTINCT FROM v_old_price);
    
    -- Check if this is a relist (was DELISTED, now seen again)
    IF v_existing.lifecycle_status = 'DELISTED' THEN
      v_was_relisted := TRUE;
    END IF;

    UPDATE retail_listings SET
      last_seen_at = now(),
      asking_price = COALESCE(p_asking_price, asking_price),
      price_changed_at = CASE WHEN v_price_changed THEN now() ELSE price_changed_at END,
      delisted_at = NULL,  -- Clear delisted timestamp
      -- Lifecycle status: DELISTED → RELISTED, otherwise ACTIVE
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
      km = COALESCE(p_km, km),
      variant_raw = COALESCE(NULLIF(TRIM(p_variant_raw), ''), variant_raw),
      variant_family = COALESCE(NULLIF(TRIM(p_variant_family), ''), variant_family),
      updated_at = now()
    WHERE id = v_listing_id;

    v_identity_id := v_existing.identity_id;
  END IF;

  -- Map to identity if not already mapped and we have required fields
  IF v_identity_id IS NULL AND p_year IS NOT NULL AND p_make IS NOT NULL AND p_model IS NOT NULL THEN
    v_identity_id := map_listing_to_identity(
      p_year, UPPER(TRIM(p_make)), UPPER(TRIM(p_model)),
      NULLIF(TRIM(p_variant_family), ''),
      NULL, NULL, NULL,
      p_km,
      COALESCE(UPPER(TRIM(p_state)), 'AU-NATIONAL')
    );

    UPDATE retail_listings SET
      identity_id = v_identity_id,
      identity_mapped_at = now()
    WHERE id = v_listing_id;
  END IF;

  -- Auto-evaluate on new listing or price change (only if identity exists)
  IF v_identity_id IS NOT NULL AND (v_is_new OR v_price_changed) THEN
    SELECT et.result INTO v_eval_result
    FROM evaluate_and_emit_trigger(v_listing_id, 'v0_provisional') et;

    UPDATE retail_listings SET
      last_evaluated_at = now(),
      last_evaluation_result = v_eval_result
    WHERE id = v_listing_id;
  END IF;

  RETURN QUERY SELECT v_listing_id, v_identity_id, v_is_new, v_price_changed, v_eval_result, v_was_relisted;
END;
$$;

-- 4) Upgrade mark_stale_listings_delisted to set lifecycle_status
CREATE OR REPLACE FUNCTION public.mark_listings_delisted(
  p_source text,
  p_stale_interval interval DEFAULT interval '3 days'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.retail_listings
  SET 
    lifecycle_status = 'DELISTED',
    delisted_at = now(),
    updated_at = now()
  WHERE source = p_source
    AND lifecycle_status IN ('ACTIVE', 'RELISTED')  -- Only delist active/relisted
    AND last_seen_at < now() - p_stale_interval;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.mark_listings_delisted IS 'Marks listings not seen within stale_interval as DELISTED';

-- 5) Keep backwards-compatible version for existing callers
CREATE OR REPLACE FUNCTION public.mark_stale_listings_delisted(
  p_source text DEFAULT NULL::text,
  p_stale_days integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_source IS NOT NULL THEN
    UPDATE retail_listings
    SET 
      delisted_at = now(), 
      lifecycle_status = 'DELISTED',
      updated_at = now()
    WHERE delisted_at IS NULL
      AND source = p_source
      AND lifecycle_status IN ('ACTIVE', 'RELISTED')
      AND last_seen_at < now() - (p_stale_days || ' days')::INTERVAL;
  ELSE
    UPDATE retail_listings
    SET 
      delisted_at = now(), 
      lifecycle_status = 'DELISTED',
      updated_at = now()
    WHERE delisted_at IS NULL
      AND lifecycle_status IN ('ACTIVE', 'RELISTED')
      AND last_seen_at < now() - (p_stale_days || ' days')::INTERVAL;
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;