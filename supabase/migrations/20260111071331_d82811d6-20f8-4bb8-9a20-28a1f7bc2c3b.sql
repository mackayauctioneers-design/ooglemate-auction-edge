-- Simplified evaluate_watch_status without attempt_count dependency
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
  v_fingerprint RECORD;
  v_status text := NULL;
  v_reason text := NULL;
  v_avoid boolean := false;
  v_avoid_reason text := NULL;
  v_days_on_market int;
BEGIN
  SELECT 
    vl.make, vl.model, vl.year, vl.km, vl.variant_family,
    vl.source_class, vl.first_seen_at, vl.asking_price,
    vl.sold_returned_suspected, vl.sold_returned_reason,
    EXTRACT(DAY FROM NOW() - vl.first_seen_at)::int
  INTO 
    v_make, v_model, v_year, v_km, v_variant_family,
    v_source_class, v_first_seen_at, v_asking_price,
    v_sold_returned_suspected, v_sold_returned_reason,
    v_days_on_market
  FROM vehicle_listings vl 
  WHERE vl.id = p_listing_id;
  
  IF NOT FOUND THEN RETURN; END IF;
  
  IF v_sold_returned_suspected THEN
    RETURN QUERY SELECT 'avoid'::text, COALESCE(v_sold_returned_reason, 'SOLD_RETURNED_MECHANICAL'), true, COALESCE(v_sold_returned_reason, 'SOLD_RETURNED_MECHANICAL');
    RETURN;
  END IF;
  
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
    
    IF v_source_class = 'classifieds' AND v_days_on_market >= 60 THEN
      v_status := 'buy_window';
      v_reason := 'Retail fatigue: ' || v_days_on_market || ' days on market';
    END IF;
  END IF;
  
  RETURN QUERY SELECT v_status, v_reason, v_avoid, v_avoid_reason;
END;
$$;