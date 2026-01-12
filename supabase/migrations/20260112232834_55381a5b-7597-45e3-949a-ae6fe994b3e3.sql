-- ============================================================
-- MISSING STREAK: 2-run confirmation before marking gone
-- ============================================================

-- 1) Add missing_streak column
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS missing_streak int NOT NULL DEFAULT 0;

-- 2) Index for missing_streak queries
CREATE INDEX IF NOT EXISTS vehicle_listings_missing_streak_idx
  ON public.vehicle_listings (source, is_dealer_grade, missing_streak)
  WHERE status IN ('catalogue', 'listed', 'active');

-- 3) Create enhanced presence tracking function with 2-strike system
CREATE OR REPLACE FUNCTION public.derive_presence_events_v2(
  p_run_id uuid,
  p_source text DEFAULT NULL,
  p_min_seen_pct numeric DEFAULT 0.30  -- Circuit breaker: min 30% of expected
)
RETURNS TABLE(
  new_listings integer, 
  still_active integer, 
  pending_missing integer,  -- 1 strike
  went_missing integer,     -- 2+ strikes, now inactive
  returned integer,
  circuit_breaker_tripped boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new INT := 0;
  v_active INT := 0;
  v_pending INT := 0;
  v_missing INT := 0;
  v_returned INT := 0;
  v_run_started_at TIMESTAMPTZ;
  v_prev_active_count INT;
  v_seen_this_run INT;
  v_breaker_tripped BOOLEAN := false;
BEGIN
  -- Get run start time
  SELECT started_at INTO v_run_started_at
  FROM pipeline_runs WHERE id = p_run_id;
  
  IF v_run_started_at IS NULL THEN
    v_run_started_at := now();
  END IF;

  -- Count how many were active before this run (for circuit breaker)
  SELECT COUNT(*) INTO v_prev_active_count
  FROM vehicle_listings
  WHERE (p_source IS NULL OR source = p_source)
    AND status IN ('catalogue', 'listed', 'active')
    AND is_dealer_grade = true;

  -- Count how many were seen in this run
  SELECT COUNT(*) INTO v_seen_this_run
  FROM vehicle_listings
  WHERE (p_source IS NULL OR source = p_source)
    AND last_ingest_run_id = p_run_id;

  -- CIRCUIT BREAKER: If seen < 30% of previous active, abort missing logic
  IF v_prev_active_count > 100 AND v_seen_this_run < (v_prev_active_count * p_min_seen_pct) THEN
    v_breaker_tripped := true;
    
    -- Just count new listings, don't process missing
    SELECT COUNT(*) INTO v_new
    FROM vehicle_listings
    WHERE last_ingest_run_id = p_run_id
      AND first_seen_at >= v_run_started_at - INTERVAL '2 hours'
      AND (p_source IS NULL OR source = p_source);
    
    SELECT COUNT(*) INTO v_active
    FROM vehicle_listings
    WHERE last_ingest_run_id = p_run_id
      AND status IN ('catalogue', 'listed', 'active')
      AND (p_source IS NULL OR source = p_source);
    
    RETURN QUERY SELECT v_new, v_active, 0, 0, 0, v_breaker_tripped;
    RETURN;
  END IF;

  -- 1. Count NEW: listings first seen in this run
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

  -- 2. RETURNED: listings that were inactive but seen this run
  WITH returned AS (
    SELECT vl.id, vl.source
    FROM vehicle_listings vl
    WHERE vl.last_ingest_run_id = p_run_id
      AND vl.status IN ('catalogue', 'listed', 'active')
      AND vl.missing_streak = 0  -- Was reset to 0 by upsert
      AND (p_source IS NULL OR vl.source = p_source)
      AND EXISTS (
        SELECT 1 FROM listing_events le
        WHERE le.listing_id = vl.id
          AND le.event_type = 'WENT_MISSING'
          AND le.event_at > now() - INTERVAL '60 days'
      )
      AND NOT EXISTS (
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

  -- 3. INCREMENT MISSING STREAK for listings not seen this run
  -- Only touch active, dealer-grade listings not updated in this run
  UPDATE vehicle_listings v
  SET 
    missing_streak = v.missing_streak + 1,
    updated_at = now()
  WHERE (p_source IS NULL OR v.source = p_source)
    AND v.status IN ('catalogue', 'listed', 'active')
    AND v.is_dealer_grade = true
    AND v.last_seen_at < v_run_started_at;

  -- 4. Count PENDING MISSING (1 strike, not yet gone)
  SELECT COUNT(*) INTO v_pending
  FROM vehicle_listings
  WHERE (p_source IS NULL OR source = p_source)
    AND status IN ('catalogue', 'listed', 'active')
    AND is_dealer_grade = true
    AND missing_streak = 1;

  -- 5. WENT_MISSING: Mark as cleared when missing_streak >= 2
  WITH gone AS (
    UPDATE vehicle_listings v
    SET 
      status = 'cleared',
      status_changed_at = now(),
      updated_at = now()
    WHERE (p_source IS NULL OR v.source = p_source)
      AND v.status IN ('catalogue', 'listed', 'active')
      AND v.is_dealer_grade = true
      AND v.missing_streak >= 2
    RETURNING v.id, v.source
  ),
  logged AS (
    INSERT INTO listing_events (listing_id, event_type, run_id, source, previous_status, new_status, meta)
    SELECT 
      g.id, 
      'WENT_MISSING', 
      p_run_id, 
      g.source,
      'active', 
      'cleared', 
      jsonb_build_object('missing_streak', 2, 'confirmed_gone', true)
    FROM gone g
    RETURNING listing_id
  )
  SELECT COUNT(*) INTO v_missing FROM logged;

  -- 6. Count still active
  SELECT COUNT(*) INTO v_active
  FROM vehicle_listings
  WHERE (p_source IS NULL OR source = p_source)
    AND status IN ('catalogue', 'listed', 'active')
    AND is_dealer_grade = true;

  RETURN QUERY SELECT v_new, v_active, v_pending, v_missing, v_returned, v_breaker_tripped;
END;
$function$;