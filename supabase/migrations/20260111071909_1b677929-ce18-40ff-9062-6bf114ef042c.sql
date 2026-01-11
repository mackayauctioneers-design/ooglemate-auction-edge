-- Drop and recreate evaluate_watch_status with confidence output
DROP FUNCTION IF EXISTS public.evaluate_watch_status(uuid, boolean);

CREATE FUNCTION public.evaluate_watch_status(
  p_listing_id uuid,
  p_force_recalc boolean DEFAULT false
)
RETURNS TABLE(
  new_status text,
  new_reason text,
  should_avoid boolean,
  avoid_reason text,
  watch_confidence text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_make text;
  v_model text;
  v_year int;
  v_km int;
  v_variant_family text;
  v_source_class text;
  v_first_seen_at timestamptz;
  v_asking_price numeric;
  v_sold_returned_suspected boolean;
  v_sold_returned_reason text;
  v_attempt_count int;
  v_fingerprint RECORD;
  v_outcome RECORD;
  v_status text := NULL;
  v_reason text := NULL;
  v_avoid boolean := false;
  v_avoid_reason text := NULL;
  v_days_on_market int;
  v_confidence text := 'low';
BEGIN
  SELECT 
    vl.make, vl.model, vl.year, vl.km, vl.variant_family,
    vl.source_class, vl.first_seen_at, vl.asking_price,
    vl.sold_returned_suspected, vl.sold_returned_reason,
    EXTRACT(DAY FROM NOW() - vl.first_seen_at)::int,
    COALESCE(vl.attempt_count, 0)
  INTO 
    v_make, v_model, v_year, v_km, v_variant_family,
    v_source_class, v_first_seen_at, v_asking_price,
    v_sold_returned_suspected, v_sold_returned_reason,
    v_days_on_market, v_attempt_count
  FROM vehicle_listings vl 
  WHERE vl.id = p_listing_id;
  
  IF NOT FOUND THEN RETURN; END IF;
  
  -- AVOID: Sold-returned suspects
  IF v_sold_returned_suspected THEN
    RETURN QUERY SELECT 
      'avoid'::text, 
      COALESCE(v_sold_returned_reason, 'SOLD_RETURNED_MECHANICAL'), 
      true, 
      COALESCE(v_sold_returned_reason, 'SOLD_RETURNED_MECHANICAL'),
      'low'::text;
    RETURN;
  END IF;
  
  -- Check fingerprint match
  SELECT df.* INTO v_fingerprint
  FROM dealer_fingerprints df
  WHERE df.is_active = true
    AND UPPER(df.make) = UPPER(v_make)
    AND UPPER(df.model) = UPPER(v_model)
    AND v_year BETWEEN df.year_min AND df.year_max
  LIMIT 1;
  
  IF FOUND THEN
    v_status := 'watching';
    v_reason := 'Matches fingerprint: ' || v_fingerprint.dealer_name;
    
    -- Determine confidence from fingerprint_outcomes
    SELECT fo.cleared_total INTO v_outcome
    FROM fingerprint_outcomes_latest fo
    WHERE UPPER(fo.make) = UPPER(v_make)
      AND UPPER(fo.model) = UPPER(v_model)
      AND v_year BETWEEN fo.year_min AND fo.year_max
    LIMIT 1;
    
    IF FOUND THEN
      IF v_outcome.cleared_total >= 10 THEN
        v_confidence := 'high';
      ELSIF v_outcome.cleared_total >= 3 THEN
        v_confidence := 'med';
      ELSE
        v_confidence := 'low';
      END IF;
    END IF;
    
    -- BUY_WINDOW triggers (only for med/high confidence)
    IF v_confidence IN ('med', 'high') THEN
      IF v_source_class = 'auction' AND v_attempt_count >= 3 THEN
        v_status := 'buy_window';
        v_reason := 'Auction run #' || v_attempt_count || ' - seller breaking point';
      ELSIF v_source_class = 'classifieds' AND v_days_on_market >= 60 THEN
        v_status := 'buy_window';
        v_reason := 'Retail fatigue: ' || v_days_on_market || ' days on market';
      END IF;
    END IF;
  END IF;
  
  RETURN QUERY SELECT v_status, v_reason, v_avoid, v_avoid_reason, v_confidence;
END;
$$;

-- Add watch_confidence column
ALTER TABLE public.vehicle_listings
ADD COLUMN IF NOT EXISTS watch_confidence text;

-- Update refresh_watch_statuses to store confidence
CREATE OR REPLACE FUNCTION public.refresh_watch_statuses()
RETURNS TABLE(
  total_evaluated integer,
  watching_count integer,
  buy_window_count integer,
  avoid_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total int := 0;
  v_watching int := 0;
  v_buy_window int := 0;
  v_avoid int := 0;
BEGIN
  WITH evaluated AS (
    SELECT 
      vl.id,
      (evaluate_watch_status(vl.id)).*
    FROM vehicle_listings vl
    WHERE vl.status IN ('catalogue', 'listed', 'active', 'passed_in')
      AND vl.is_dealer_grade = true
  ),
  updated AS (
    UPDATE vehicle_listings vl
    SET 
      watch_status = e.new_status,
      watch_reason = e.new_reason,
      watch_confidence = e.watch_confidence,
      avoid_reason = CASE WHEN e.should_avoid THEN e.avoid_reason ELSE vl.avoid_reason END,
      buy_window_at = CASE 
        WHEN e.new_status = 'buy_window' AND vl.watch_status != 'buy_window' 
        THEN NOW() 
        ELSE vl.buy_window_at 
      END,
      updated_at = NOW()
    FROM evaluated e
    WHERE vl.id = e.id
      AND (
        vl.watch_status IS DISTINCT FROM e.new_status
        OR vl.watch_confidence IS DISTINCT FROM e.watch_confidence
      )
    RETURNING vl.watch_status
  )
  SELECT 
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE watch_status = 'watching')::int,
    COUNT(*) FILTER (WHERE watch_status = 'buy_window')::int,
    COUNT(*) FILTER (WHERE watch_status = 'avoid')::int
  INTO v_total, v_watching, v_buy_window, v_avoid
  FROM updated;
  
  RETURN QUERY SELECT v_total, v_watching, v_buy_window, v_avoid;
END;
$$;

-- Improved update_auction_attempts
CREATE OR REPLACE FUNCTION public.update_auction_attempts()
RETURNS TABLE(updated_count integer, stage_counts jsonb)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_updated int := 0;
  v_stages jsonb;
BEGIN
  WITH to_update AS (
    SELECT 
      vl.id,
      CASE 
        WHEN vl.attempt_count IS NULL OR vl.attempt_count = 0 THEN 1
        WHEN vl.last_seen_at > COALESCE(vl.last_attempt_at, vl.first_seen_at) + INTERVAL '5 days' 
        THEN vl.attempt_count + 1
        ELSE vl.attempt_count
      END as new_attempt_count
    FROM vehicle_listings vl
    WHERE vl.source_class = 'auction'
      AND vl.status IN ('catalogue', 'passed_in')
      AND vl.last_seen_at > NOW() - INTERVAL '7 days'
  ),
  updated AS (
    UPDATE vehicle_listings vl
    SET 
      attempt_count = tu.new_attempt_count,
      attempt_stage = CASE 
        WHEN tu.new_attempt_count = 1 THEN 'first_run'
        WHEN tu.new_attempt_count = 2 THEN 'second_run'
        WHEN tu.new_attempt_count >= 3 THEN 'third_run_plus'
        ELSE 'unknown'
      END,
      last_attempt_at = vl.last_seen_at,
      updated_at = NOW()
    FROM to_update tu
    WHERE vl.id = tu.id
      AND (vl.attempt_count IS DISTINCT FROM tu.new_attempt_count)
    RETURNING vl.attempt_stage
  )
  SELECT COUNT(*)::int INTO v_updated FROM updated;
  
  SELECT jsonb_object_agg(stage, cnt) INTO v_stages
  FROM (
    SELECT attempt_stage as stage, COUNT(*)::int as cnt 
    FROM vehicle_listings 
    WHERE source_class = 'auction' AND status IN ('catalogue', 'passed_in')
    AND attempt_stage IS NOT NULL
    GROUP BY attempt_stage
  ) s;
  
  RETURN QUERY SELECT v_updated, COALESCE(v_stages, '{}'::jsonb);
END;
$$;

-- Improved detect_sold_returned_suspects
CREATE OR REPLACE FUNCTION public.detect_sold_returned_suspects()
RETURNS TABLE(listing_uuid uuid, listing_id text, reason text, flagged_count integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH suspects AS (
    SELECT 
      vl.id,
      vl.listing_id as lid,
      'Cleared then reappeared within 21 days'::text as rsn
    FROM vehicle_listings vl
    WHERE vl.source_class = 'auction'
      AND vl.last_seen_at > NOW() - INTERVAL '7 days'
      AND COALESCE(vl.sold_returned_suspected, false) = false
      AND vl.status = 'catalogue'
      AND vl.relist_count >= 1
      AND EXISTS (
        SELECT 1 FROM clearance_events ce 
        WHERE ce.listing_id = vl.id 
        AND ce.cleared_at > NOW() - INTERVAL '21 days'
      )
  )
  SELECT 
    s.id,
    s.lid,
    s.rsn,
    (SELECT COUNT(*)::int FROM suspects)
  FROM suspects s;
$$;