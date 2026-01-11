-- Fix evaluate_watch_status to handle new columns properly
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
  v_status text := NULL;
  v_reason text := NULL;
  v_avoid boolean := false;
  v_avoid_reason text := NULL;
BEGIN
  -- Get listing details using explicit column selection
  SELECT 
    vl.make, vl.model, vl.year, vl.km, vl.variant_family,
    vl.source_class, vl.first_seen_at, vl.asking_price,
    vl.sold_returned_suspected, vl.sold_returned_reason,
    COALESCE(vl.attempt_count, 0)
  INTO 
    v_make, v_model, v_year, v_km, v_variant_family,
    v_source_class, v_first_seen_at, v_asking_price,
    v_sold_returned_suspected, v_sold_returned_reason,
    v_attempt_count
  FROM vehicle_listings vl 
  WHERE vl.id = p_listing_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Check for AVOID conditions first (highest priority)
  IF v_sold_returned_suspected THEN
    v_avoid := true;
    v_avoid_reason := COALESCE(v_sold_returned_reason, 'SOLD_RETURNED_MECHANICAL');
    RETURN QUERY SELECT 'avoid'::text, v_avoid_reason, v_avoid, v_avoid_reason;
    RETURN;
  END IF;
  
  -- Check for fingerprint match (WATCH eligibility)
  SELECT df.* INTO v_fingerprint
  FROM dealer_fingerprints df
  WHERE df.is_active = true
    AND UPPER(df.make) = UPPER(v_make)
    AND UPPER(df.model) = UPPER(v_model)
    AND v_year BETWEEN df.year_min AND df.year_max
    AND (
      df.variant_family IS NULL 
      OR df.variant_family = '' 
      OR UPPER(COALESCE(v_variant_family, '')) = UPPER(df.variant_family)
    )
    AND (
      df.is_spec_only = true
      OR (
        v_km IS NULL
        OR (v_km >= COALESCE(df.min_km, 0) AND v_km <= COALESCE(df.max_km, 999999))
      )
    )
  LIMIT 1;
  
  IF FOUND THEN
    -- Has fingerprint match - evaluate for BUY_WINDOW or WATCH
    v_status := 'watching';
    v_reason := 'Matches fingerprint: ' || v_fingerprint.dealer_name || ' (' || v_fingerprint.fingerprint_id || ')';
    
    -- Check BUY_WINDOW triggers
    -- Trigger 1: Auction run >= 3
    IF v_source_class = 'auction' AND v_attempt_count >= 3 THEN
      v_status := 'buy_window';
      v_reason := 'Auction run #' || v_attempt_count || ' - seller breaking point';
    
    -- Trigger 2: Retail days-on-market >= 60 (fatigue)
    ELSIF v_source_class = 'classifieds' 
      AND v_first_seen_at < NOW() - INTERVAL '60 days' THEN
      v_status := 'buy_window';
      v_reason := 'Retail fatigue: ' || 
        EXTRACT(DAY FROM NOW() - v_first_seen_at)::int || ' days on market';
    
    -- Trigger 3: Price below fingerprint band (if we have benchmark)
    ELSIF v_asking_price IS NOT NULL THEN
      DECLARE
        v_benchmark RECORD;
      BEGIN
        SELECT * INTO v_benchmark
        FROM fingerprint_outcomes_latest fo
        WHERE UPPER(fo.make) = UPPER(v_make)
          AND UPPER(fo.model) = UPPER(v_model)
          AND v_year BETWEEN fo.year_min AND fo.year_max
          AND fo.avg_price IS NOT NULL
        LIMIT 1;
        
        IF FOUND AND v_asking_price <= (v_benchmark.avg_price * 0.85) THEN
          v_status := 'buy_window';
          v_reason := 'Price $' || v_asking_price || ' is 15%+ below benchmark $' || 
            ROUND(v_benchmark.avg_price);
        END IF;
      END;
    END IF;
  END IF;
  
  RETURN QUERY SELECT v_status, v_reason, v_avoid, v_avoid_reason;
END;
$$;