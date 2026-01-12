-- ============================================================
-- INGESTION RELIABILITY SCHEMA UPGRADE
-- Adds fingerprint columns, tracking columns, and better indexes
-- ============================================================

-- 1) Add fingerprint columns for cross-source matching
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS fingerprint_version int NOT NULL DEFAULT 1;

-- 2) Add status tracking columns
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

-- 3) Add ingestion run tracking columns
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS last_ingest_run_id uuid,
  ADD COLUMN IF NOT EXISTS last_ingested_at timestamptz;

-- 4) Create indexes for fingerprint + presence tracking

-- Source + listing_id unique index (Pickles dedupe key)
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_listings_source_listing_id_uq
  ON public.vehicle_listings (source, listing_id)
  WHERE listing_id IS NOT NULL;

-- Fingerprint index for cross-source matching
CREATE INDEX IF NOT EXISTS vehicle_listings_fingerprint_idx
  ON public.vehicle_listings (fingerprint)
  WHERE fingerprint IS NOT NULL;

-- Active filtering by source
CREATE INDEX IF NOT EXISTS vehicle_listings_source_status_idx
  ON public.vehicle_listings (source, status, last_seen_at DESC);

-- Last ingest run lookup
CREATE INDEX IF NOT EXISTS vehicle_listings_last_ingest_run_idx
  ON public.vehicle_listings (last_ingest_run_id)
  WHERE last_ingest_run_id IS NOT NULL;

-- 5) Add listing_events indexes if not exist
CREATE INDEX IF NOT EXISTS listing_events_listing_event_at_idx
  ON public.listing_events (listing_id, event_at DESC);

CREATE INDEX IF NOT EXISTS listing_events_run_type_idx
  ON public.listing_events (run_id, event_type);

-- 6) Add FK constraint for last_ingest_run_id (references pipeline_runs)
-- First check if pipeline_runs table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pipeline_runs') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'vehicle_listings_last_ingest_run_id_fkey'
    ) THEN
      ALTER TABLE public.vehicle_listings
        ADD CONSTRAINT vehicle_listings_last_ingest_run_id_fkey
        FOREIGN KEY (last_ingest_run_id) REFERENCES public.pipeline_runs(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- 7) Backfill status_changed_at from updated_at where missing
UPDATE public.vehicle_listings
SET status_changed_at = COALESCE(updated_at, first_seen_at, now())
WHERE status_changed_at IS NULL;

-- 8) Create or replace enhanced derive_presence_events function
CREATE OR REPLACE FUNCTION public.derive_presence_events(
  p_run_id uuid, 
  p_source text DEFAULT NULL, 
  p_stale_hours integer DEFAULT 36
)
RETURNS TABLE(new_listings integer, still_active integer, went_missing integer, returned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new INT := 0;
  v_active INT := 0;
  v_missing INT := 0;
  v_returned INT := 0;
  v_run_started_at TIMESTAMPTZ;
BEGIN
  -- Get run start time
  SELECT started_at INTO v_run_started_at
  FROM pipeline_runs WHERE id = p_run_id;
  
  IF v_run_started_at IS NULL THEN
    v_run_started_at := now();
  END IF;

  -- 1. Mark NEW: listings first seen in this run (first_seen_at within last 2 hours of run start)
  WITH new_listings AS (
    INSERT INTO listing_events (listing_id, event_type, run_id, source, meta)
    SELECT 
      id, 
      'FIRST_SEEN', 
      p_run_id, 
      source,
      jsonb_build_object('first_seen_at', first_seen_at)
    FROM vehicle_listings
    WHERE last_ingest_run_id = p_run_id
      AND first_seen_at >= v_run_started_at - INTERVAL '2 hours'
      AND (p_source IS NULL OR source = p_source)
      AND NOT EXISTS (
        SELECT 1 FROM listing_events le
        WHERE le.listing_id = vehicle_listings.id AND le.event_type = 'FIRST_SEEN'
      )
    RETURNING listing_id
  )
  SELECT COUNT(*) INTO v_new FROM new_listings;

  -- 2. WENT_MISSING: was active, not touched by this run
  WITH missing AS (
    UPDATE vehicle_listings vl
    SET 
      status = 'cleared',
      status_changed_at = now(),
      updated_at = now()
    WHERE vl.status IN ('catalogue', 'listed', 'active')
      AND vl.is_dealer_grade = true
      AND (p_source IS NULL OR vl.source = p_source)
      AND (vl.last_ingest_run_id IS NULL OR vl.last_ingest_run_id != p_run_id)
      AND vl.last_seen_at < v_run_started_at - make_interval(hours => p_stale_hours)
    RETURNING vl.id, vl.source
  ),
  logged AS (
    INSERT INTO listing_events (listing_id, event_type, run_id, source, previous_status, new_status, meta)
    SELECT 
      m.id, 
      'WENT_MISSING', 
      p_run_id, 
      m.source,
      'active', 
      'cleared', 
      jsonb_build_object('stale_hours', p_stale_hours)
    FROM missing m
    RETURNING listing_id
  )
  SELECT COUNT(*) INTO v_missing FROM logged;

  -- 3. RETURNED: listings that were cleared/inactive but now touched by this run
  WITH returned AS (
    SELECT vl.id, vl.source
    FROM vehicle_listings vl
    WHERE vl.last_ingest_run_id = p_run_id
      AND vl.status IN ('catalogue', 'listed', 'active')
      AND (p_source IS NULL OR vl.source = p_source)
      AND EXISTS (
        -- Was marked as WENT_MISSING previously
        SELECT 1 FROM listing_events le
        WHERE le.listing_id = vl.id
          AND le.event_type = 'WENT_MISSING'
          AND le.event_at > now() - INTERVAL '30 days'
      )
      AND NOT EXISTS (
        -- Don't double-log RETURNED in same run
        SELECT 1 FROM listing_events le
        WHERE le.listing_id = vl.id
          AND le.event_type = 'RETURNED'
          AND le.run_id = p_run_id
      )
  ),
  logged AS (
    INSERT INTO listing_events (listing_id, event_type, run_id, source, meta)
    SELECT 
      r.id, 
      'RETURNED', 
      p_run_id, 
      r.source,
      jsonb_build_object('returned_after_missing', true)
    FROM returned r
    RETURNING listing_id
  )
  SELECT COUNT(*) INTO v_returned FROM logged;

  -- 4. Count still active (for reporting only)
  SELECT COUNT(*) INTO v_active
  FROM vehicle_listings
  WHERE status IN ('catalogue', 'listed', 'active')
    AND last_ingest_run_id = p_run_id
    AND (p_source IS NULL OR source = p_source);

  RETURN QUERY SELECT v_new, v_active, v_missing, v_returned;
END;
$function$;

-- 9) Create fingerprint generation function (v1)
CREATE OR REPLACE FUNCTION public.generate_vehicle_fingerprint(
  p_year int,
  p_make text,
  p_model text,
  p_variant text DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_transmission text DEFAULT NULL,
  p_fuel text DEFAULT NULL,
  p_drivetrain text DEFAULT NULL,
  p_km int DEFAULT NULL,
  p_region text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_odo_bucket int;
  v_canonical text;
BEGIN
  -- Bucket odometer to nearest 5000
  IF p_km IS NOT NULL THEN
    v_odo_bucket := floor(p_km / 5000.0) * 5000;
  END IF;
  
  -- Build canonical string (normalized)
  v_canonical := concat_ws('|',
    COALESCE(p_year::text, ''),
    UPPER(COALESCE(TRIM(p_make), '')),
    UPPER(COALESCE(TRIM(p_model), '')),
    UPPER(COALESCE(TRIM(p_variant), '')),
    UPPER(COALESCE(TRIM(p_body), '')),
    UPPER(COALESCE(TRIM(p_transmission), '')),
    UPPER(COALESCE(TRIM(p_fuel), '')),
    UPPER(COALESCE(TRIM(p_drivetrain), '')),
    COALESCE(v_odo_bucket::text, ''),
    UPPER(COALESCE(TRIM(p_region), ''))
  );
  
  -- Return MD5 hash (32 chars, good enough for matching)
  RETURN md5(v_canonical);
END;
$function$;

-- 10) Create view for presence-based queries by run_id
CREATE OR REPLACE VIEW public.listing_presence_by_run AS
SELECT 
  le.run_id,
  le.event_type,
  le.event_at,
  vl.id,
  vl.listing_id,
  vl.make,
  vl.model,
  vl.variant_family,
  vl.year,
  vl.km,
  vl.asking_price,
  vl.location,
  vl.source,
  vl.status,
  vl.listing_url,
  vl.first_seen_at,
  vl.last_seen_at,
  vl.status_changed_at
FROM listing_events le
JOIN vehicle_listings vl ON vl.id = le.listing_id
WHERE le.event_type IN ('FIRST_SEEN', 'WENT_MISSING', 'RETURNED');