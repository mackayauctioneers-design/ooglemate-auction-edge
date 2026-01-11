-- 1) Create the 21-day regional demand view
CREATE OR REPLACE VIEW public.regional_demand_21d AS
WITH base AS (
  SELECT
    location_to_region(vl.location) AS region_id,
    UPPER(vl.make) AS make,
    UPPER(vl.model) AS model,
    vl.source,
    vl.source_class,
    ce.cleared_at,
    ce.days_to_clear
  FROM vehicle_listings vl
  JOIN clearance_events ce
    ON ce.listing_id = vl.id
  WHERE vl.is_dealer_grade = true
    AND ce.cleared_at >= NOW() - INTERVAL '21 days'
    AND vl.make IS NOT NULL
    AND vl.model IS NOT NULL
    AND location_to_region(vl.location) <> 'UNKNOWN'
),
agg AS (
  SELECT
    region_id,
    make,
    model,
    COUNT(*) AS cleared_count,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_to_clear) AS median_days_to_clear,
    COUNT(DISTINCT source) AS distinct_sellers
  FROM base
  GROUP BY 1,2,3
),
scored AS (
  SELECT
    region_id,
    make,
    model,
    cleared_count,
    median_days_to_clear,
    distinct_sellers,
    -- simple score 0–10
    (
      (CASE WHEN cleared_count >= 5 THEN 3 ELSE 0 END) +
      (CASE WHEN median_days_to_clear <= 10 THEN 2
            WHEN median_days_to_clear <= 14 THEN 1
            ELSE 0 END) +
      (CASE WHEN distinct_sellers >= 3 THEN 2
            WHEN distinct_sellers >= 2 THEN 1
            ELSE 0 END)
    )::int AS demand_score
  FROM agg
)
SELECT * FROM scored;

-- 2) Create the dealer opportunity view with fingerprint overlay
CREATE OR REPLACE VIEW public.dealer_opportunity_21d AS
WITH d AS (
  SELECT * FROM regional_demand_21d
),
fp AS (
  SELECT
    region_id,
    UPPER(make) AS make,
    UPPER(model) AS model,
    SUM(cleared_total) AS dealer_cleared_total
  FROM fingerprint_outcomes_latest
  GROUP BY 1,2,3
)
SELECT
  d.region_id,
  d.make,
  d.model,
  d.cleared_count,
  d.median_days_to_clear,
  d.distinct_sellers,
  d.demand_score,
  COALESCE(fp.dealer_cleared_total, 0) AS dealer_cleared_total,
  -- combined score (cap at 10)
  LEAST(
    10,
    d.demand_score
    + (CASE WHEN COALESCE(fp.dealer_cleared_total,0) >= 5 THEN 2
            WHEN COALESCE(fp.dealer_cleared_total,0) >= 2 THEN 1
            ELSE 0 END)
  ) AS combined_score,
  CASE
    WHEN LEAST(10, d.demand_score + (CASE WHEN COALESCE(fp.dealer_cleared_total,0) >= 5 THEN 2
                                          WHEN COALESCE(fp.dealer_cleared_total,0) >= 2 THEN 1
                                          ELSE 0 END)) >= 8
      THEN 'PRIORITY_BUY_SEEK'
    WHEN LEAST(10, d.demand_score + (CASE WHEN COALESCE(fp.dealer_cleared_total,0) >= 5 THEN 2
                                          WHEN COALESCE(fp.dealer_cleared_total,0) >= 2 THEN 1
                                          ELSE 0 END)) >= 6
      THEN 'BUY_SEEK'
    ELSE 'NONE'
  END AS opportunity_label
FROM d
LEFT JOIN fp
  ON fp.region_id = d.region_id
 AND fp.make = d.make
 AND fp.model = d.model;

-- 3) Update evaluate_watch_status to use regional demand
CREATE OR REPLACE FUNCTION public.evaluate_watch_status(p_listing_id uuid, p_force_recalc boolean DEFAULT false)
 RETURNS TABLE(new_status text, new_reason text, should_avoid boolean, avoid_reason text, watch_confidence text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_make text; v_model text; v_year int; v_source_class text;
  v_first_seen_at timestamptz; v_asking_price numeric; v_location text;
  v_sold_returned_suspected boolean; v_sold_returned_reason text;
  v_attempt_count smallint;
  v_fingerprint RECORD; v_outcome RECORD; v_regional_demand RECORD;
  v_status text := NULL; v_reason text := NULL;
  v_avoid boolean := false; v_avoid_reason text := NULL;
  v_days_on_market int; v_confidence text := 'low';
  v_region_id text;
BEGIN
  -- Fetch listing details
  SELECT vl.make, vl.model, vl.year, vl.source_class, vl.first_seen_at, vl.asking_price,
         vl.sold_returned_suspected, vl.sold_returned_reason, vl.location, vl.attempt_count,
         EXTRACT(DAY FROM NOW() - vl.first_seen_at)::int
  INTO v_make, v_model, v_year, v_source_class, v_first_seen_at, v_asking_price,
       v_sold_returned_suspected, v_sold_returned_reason, v_location, v_attempt_count, v_days_on_market
  FROM vehicle_listings vl WHERE vl.id = p_listing_id;
  
  IF NOT FOUND THEN RETURN; END IF;
  
  -- Get region
  v_region_id := location_to_region(v_location);
  
  -- AVOID: sold-returned suspects
  IF v_sold_returned_suspected THEN
    RETURN QUERY SELECT 'avoid'::text, COALESCE(v_sold_returned_reason, 'SOLD_RETURNED'), true, COALESCE(v_sold_returned_reason, 'SOLD_RETURNED'), 'low'::text;
    RETURN;
  END IF;
  
  -- Check fingerprint match first
  SELECT df.* INTO v_fingerprint FROM dealer_fingerprints df
  WHERE df.is_active = true AND UPPER(df.make) = UPPER(v_make) AND UPPER(df.model) = UPPER(v_model)
    AND v_year BETWEEN df.year_min AND df.year_max LIMIT 1;
  
  IF FOUND THEN
    v_status := 'watching';
    v_reason := 'Matches fingerprint: ' || v_fingerprint.dealer_name;
    
    -- Get fingerprint depth for confidence
    SELECT fo.cleared_total INTO v_outcome FROM fingerprint_outcomes_latest fo
    WHERE UPPER(fo.make) = UPPER(v_make) AND UPPER(fo.model) = UPPER(v_model)
      AND v_year BETWEEN fo.year_min AND fo.year_max LIMIT 1;
    
    IF FOUND THEN
      IF v_outcome.cleared_total >= 10 THEN v_confidence := 'high';
      ELSIF v_outcome.cleared_total >= 3 THEN v_confidence := 'med';
      END IF;
    END IF;
    
    -- BUY_WINDOW triggers for med/high confidence
    IF v_confidence IN ('med', 'high') THEN
      -- Retail fatigue: 60+ days
      IF v_source_class = 'classifieds' AND v_days_on_market >= 60 THEN
        v_status := 'buy_window';
        v_reason := 'Retail fatigue: ' || v_days_on_market || ' days on market';
      -- Auction: 3rd run or more
      ELSIF v_source_class = 'auction' AND COALESCE(v_attempt_count, 0) >= 3 THEN
        v_status := 'buy_window';
        v_reason := 'Auction fatigue: attempt #' || v_attempt_count;
      END IF;
    END IF;
    
    RETURN QUERY SELECT v_status, v_reason, v_avoid, v_avoid_reason, v_confidence;
    RETURN;
  END IF;
  
  -- NEW: Check regional demand (21-day) even without fingerprint
  SELECT do21.* INTO v_regional_demand FROM dealer_opportunity_21d do21
  WHERE do21.region_id = v_region_id
    AND do21.make = UPPER(v_make)
    AND do21.model = UPPER(v_model)
    AND do21.opportunity_label IN ('BUY_SEEK', 'PRIORITY_BUY_SEEK')
  LIMIT 1;
  
  IF FOUND THEN
    v_status := 'watching';
    v_reason := 'Regional demand confirmed: ' || v_regional_demand.cleared_count || ' clears in 21d';
    
    -- Set confidence based on demand score
    IF v_regional_demand.combined_score >= 8 THEN 
      v_confidence := 'high';
    ELSIF v_regional_demand.combined_score >= 6 THEN 
      v_confidence := 'med';
    END IF;
    
    -- Upgrade to buy_window if also has pressure signals
    IF v_confidence IN ('med', 'high') THEN
      IF v_source_class = 'classifieds' AND v_days_on_market >= 60 THEN
        v_status := 'buy_window';
        v_reason := 'Regional demand + retail fatigue: ' || v_days_on_market || 'd';
      ELSIF v_source_class = 'auction' AND COALESCE(v_attempt_count, 0) >= 3 THEN
        v_status := 'buy_window';
        v_reason := 'Regional demand + auction #' || v_attempt_count;
      END IF;
    END IF;
  END IF;
  
  RETURN QUERY SELECT v_status, v_reason, v_avoid, v_avoid_reason, v_confidence;
END;
$function$;