-- Add WATCH_MODE, BUY_WINDOW, and tracking fields to vehicle_listings
ALTER TABLE public.vehicle_listings
ADD COLUMN IF NOT EXISTS watch_status text,
ADD COLUMN IF NOT EXISTS watch_reason text,
ADD COLUMN IF NOT EXISTS buy_window_at timestamptz,
ADD COLUMN IF NOT EXISTS avoid_reason text,
ADD COLUMN IF NOT EXISTS tracked_by text;

-- Add index for watch_status queries
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_watch_status 
ON public.vehicle_listings(watch_status) 
WHERE watch_status IS NOT NULL;

-- Add index for tracked_by queries
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_tracked_by 
ON public.vehicle_listings(tracked_by) 
WHERE tracked_by IS NOT NULL;

-- Create function to evaluate watch status based on fingerprint matches and thresholds
CREATE OR REPLACE FUNCTION public.evaluate_watch_status(
  p_listing_id uuid,
  p_force_recalc boolean DEFAULT false
)
RETURNS TABLE(
  new_status text,
  new_reason text,
  should_avoid boolean,
  avoid_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_listing RECORD;
  v_fingerprint RECORD;
  v_status text := NULL;
  v_reason text := NULL;
  v_avoid boolean := false;
  v_avoid_reason text := NULL;
BEGIN
  -- Get listing details
  SELECT * INTO v_listing FROM vehicle_listings WHERE id = p_listing_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Check for AVOID conditions first (highest priority)
  IF v_listing.sold_returned_suspected THEN
    v_avoid := true;
    v_avoid_reason := COALESCE(v_listing.sold_returned_reason, 'SOLD_RETURNED_MECHANICAL');
    RETURN QUERY SELECT 'avoid'::text, v_avoid_reason, v_avoid, v_avoid_reason;
    RETURN;
  END IF;
  
  -- Check for fingerprint match (WATCH eligibility)
  SELECT df.* INTO v_fingerprint
  FROM dealer_fingerprints df
  WHERE df.is_active = true
    AND UPPER(df.make) = UPPER(v_listing.make)
    AND UPPER(df.model) = UPPER(v_listing.model)
    AND v_listing.year BETWEEN df.year_min AND df.year_max
    AND (
      df.variant_family IS NULL 
      OR df.variant_family = '' 
      OR UPPER(COALESCE(v_listing.variant_family, '')) = UPPER(df.variant_family)
    )
    AND (
      df.is_spec_only = true
      OR (
        v_listing.km IS NULL
        OR (v_listing.km >= COALESCE(df.min_km, 0) AND v_listing.km <= COALESCE(df.max_km, 999999))
      )
    )
  LIMIT 1;
  
  IF FOUND THEN
    -- Has fingerprint match - evaluate for BUY_WINDOW or WATCH
    v_status := 'watching';
    v_reason := 'Matches fingerprint: ' || v_fingerprint.dealer_name || ' (' || v_fingerprint.fingerprint_id || ')';
    
    -- Check BUY_WINDOW triggers
    -- Trigger 1: Auction run >= 3
    IF v_listing.source_class = 'auction' AND v_listing.attempt_count >= 3 THEN
      v_status := 'buy_window';
      v_reason := 'Auction run #' || v_listing.attempt_count || ' - seller breaking point';
    
    -- Trigger 2: Retail days-on-market >= 60 (fatigue)
    ELSIF v_listing.source_class = 'classifieds' 
      AND v_listing.first_seen_at < NOW() - INTERVAL '60 days' THEN
      v_status := 'buy_window';
      v_reason := 'Retail fatigue: ' || 
        EXTRACT(DAY FROM NOW() - v_listing.first_seen_at)::int || ' days on market';
    
    -- Trigger 3: Price below fingerprint band (if we have benchmark)
    ELSIF v_listing.asking_price IS NOT NULL THEN
      DECLARE
        v_benchmark RECORD;
      BEGIN
        SELECT * INTO v_benchmark
        FROM fingerprint_outcomes_latest fo
        WHERE UPPER(fo.make) = UPPER(v_listing.make)
          AND UPPER(fo.model) = UPPER(v_listing.model)
          AND v_listing.year BETWEEN fo.year_min AND fo.year_max
          AND fo.avg_price IS NOT NULL
        LIMIT 1;
        
        IF FOUND AND v_listing.asking_price <= (v_benchmark.avg_price * 0.85) THEN
          v_status := 'buy_window';
          v_reason := 'Price $' || v_listing.asking_price || ' is 15%+ below benchmark $' || 
            ROUND(v_benchmark.avg_price);
        END IF;
      END;
    END IF;
  END IF;
  
  RETURN QUERY SELECT v_status, v_reason, v_avoid, v_avoid_reason;
END;
$$;

-- Create function to batch-evaluate all active listings
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
  -- Update all active listings
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
        OR vl.watch_reason IS DISTINCT FROM e.new_reason
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

-- Add comment for clarity
COMMENT ON COLUMN public.vehicle_listings.watch_status IS 'watching = matched fingerprint, buy_window = trigger fired, avoid = do not buy';
COMMENT ON COLUMN public.vehicle_listings.tracked_by IS 'Name of person tracking this vehicle for a dealer';
COMMENT ON COLUMN public.vehicle_listings.buy_window_at IS 'Timestamp when vehicle entered buy_window status';