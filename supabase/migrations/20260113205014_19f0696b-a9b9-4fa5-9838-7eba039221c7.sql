-- ============================================================================
-- DEALER SPEC MATCHING ENGINE — BATCH + TRIGGERS + SAFETY RAILS
-- ============================================================================

-- Drop existing function to replace with enhanced version
DROP FUNCTION IF EXISTS public.match_dealer_specs_for_listing(uuid);

-- 1) Enhanced RPC: match_dealer_specs_for_listing
-- Evaluates a single listing against all active dealer specs with proper scoring
CREATE OR REPLACE FUNCTION public.match_dealer_specs_for_listing(p_listing_id uuid)
RETURNS TABLE(
  dealer_spec_id uuid,
  listing_uuid uuid,
  match_score numeric,
  deal_label text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_listing record;
  v_benchmark_price numeric;
  v_current_year int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_matches_created int := 0;
BEGIN
  -- Load listing
  SELECT * INTO v_listing
  FROM public.vehicle_listings
  WHERE id = p_listing_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- SAFETY: Exit early if avoid or sold_returned
  IF v_listing.watch_status = 'avoid' THEN
    RETURN;
  END IF;
  
  IF COALESCE(v_listing.sold_returned_suspected, false) = true THEN
    RETURN;
  END IF;

  -- Get benchmark price from fingerprint_outcomes_latest
  SELECT fo.avg_price INTO v_benchmark_price
  FROM public.fingerprint_outcomes_latest fo
  WHERE upper(fo.make) = upper(v_listing.make)
    AND upper(fo.model) = upper(v_listing.model)
    AND (fo.variant_family = COALESCE(v_listing.variant_used, v_listing.variant_family, 'ALL') 
         OR fo.variant_family = 'ALL')
    AND fo.region_id = COALESCE(v_listing.region_id, 'NSW_CENTRAL_COAST')
    AND v_listing.year BETWEEN fo.year_min AND fo.year_max
  ORDER BY 
    CASE WHEN fo.variant_family != 'ALL' THEN 0 ELSE 1 END,
    fo.cleared_total DESC
  LIMIT 1;

  -- Insert matches for all matching specs
  RETURN QUERY
  WITH matching_specs AS (
    SELECT 
      s.*,
      -- Calculate match score
      (
        40  -- base make/model match
        + CASE WHEN s.variant_family IS NOT NULL 
               AND upper(COALESCE(s.variant_family,'')) = upper(COALESCE(v_listing.variant_used, v_listing.variant_family, ''))
          THEN 15 ELSE 0 END
        + CASE WHEN s.region_scope = v_listing.region_id THEN 10
               WHEN s.region_scope = 'ALL' THEN 5
               ELSE 0 END
        + CASE WHEN v_benchmark_price IS NOT NULL 
               AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL
               AND v_benchmark_price > 0
               AND ((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / v_benchmark_price * 100) <= (-1 * COALESCE(s.under_benchmark_pct, 10))
          THEN 20 ELSE 0 END
        + CASE WHEN COALESCE(v_listing.attempt_count, 0) >= 3 
               OR COALESCE(v_listing.days_on_market, 0) >= 60
          THEN 10 ELSE 0 END
        + CASE WHEN v_benchmark_price IS NOT NULL THEN 5 ELSE 0 END
      )::numeric AS calc_score,
      -- Build reason string
      concat_ws('; ',
        'Make/Model match',
        CASE WHEN s.variant_family IS NOT NULL 
             AND upper(COALESCE(s.variant_family,'')) = upper(COALESCE(v_listing.variant_used, v_listing.variant_family, ''))
        THEN 'Variant match' END,
        CASE WHEN s.region_scope = v_listing.region_id THEN 'Exact region match'
             WHEN s.region_scope = 'ALL' THEN 'National scope' END,
        CASE WHEN v_benchmark_price IS NOT NULL 
             AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL
             AND v_benchmark_price > 0
        THEN 'Under benchmark by ' || 
             ROUND(ABS((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / v_benchmark_price * 100), 1) || '%'
        END,
        CASE WHEN COALESCE(v_listing.attempt_count, 0) >= 3 THEN 'Attempt count >= 3'
             WHEN COALESCE(v_listing.days_on_market, 0) >= 60 THEN 'DOM >= 60 days'
        END
      ) AS reason_text
    FROM public.dealer_specs s
    WHERE s.enabled = true
      AND s.deleted_at IS NULL
      -- Make/Model match
      AND upper(s.make) = upper(v_listing.make)
      AND upper(s.model) = upper(v_listing.model)
      -- Variant filter (if specified)
      AND (s.variant_family IS NULL 
           OR upper(s.variant_family) = upper(COALESCE(v_listing.variant_used, v_listing.variant_family, ''))
           OR s.exploration_mode = true)
      -- Year range (rolling 10y default)
      AND (v_listing.year >= COALESCE(s.year_min, v_current_year - 10))
      AND (v_listing.year <= COALESCE(s.year_max, v_current_year))
      -- KM range
      AND (s.km_min IS NULL OR v_listing.km IS NULL OR v_listing.km >= s.km_min)
      AND (s.km_max IS NULL OR v_listing.km IS NULL OR v_listing.km <= s.km_max)
      -- Fuel filter
      AND (s.fuel_allow IS NULL OR array_length(s.fuel_allow, 1) IS NULL 
           OR upper(COALESCE(v_listing.fuel, '')) = ANY(SELECT upper(unnest(s.fuel_allow))))
      -- Transmission filter
      AND (s.trans_allow IS NULL OR array_length(s.trans_allow, 1) IS NULL 
           OR upper(COALESCE(v_listing.transmission, '')) = ANY(SELECT upper(unnest(s.trans_allow))))
      -- Drivetrain filter
      AND (s.drive_allow IS NULL OR array_length(s.drive_allow, 1) IS NULL 
           OR upper(COALESCE(v_listing.drivetrain, '')) = ANY(SELECT upper(unnest(s.drive_allow))))
      -- Region scope
      AND (s.region_scope = 'ALL' OR s.region_scope = v_listing.region_id)
      -- Hard max price
      AND (s.hard_max_price IS NULL 
           OR COALESCE(v_listing.asking_price, v_listing.reserve, 0) <= s.hard_max_price)
      -- Benchmark requirement
      AND (s.allow_no_benchmark = true OR v_benchmark_price IS NOT NULL)
  ),
  inserted AS (
    INSERT INTO public.dealer_spec_matches (
      dealer_spec_id, listing_uuid, match_score, match_reason, deal_label,
      asking_price, benchmark_price, delta_pct,
      make, model, variant_used, year, km, region_id, source_class, listing_url,
      watch_status, matched_at
    )
    SELECT
      ms.id,
      v_listing.id,
      ms.calc_score,
      jsonb_build_object('reason', ms.reason_text),
      CASE
        WHEN v_benchmark_price IS NOT NULL 
             AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL
             AND v_benchmark_price > 0
             AND ((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / v_benchmark_price * 100) <= -20
             AND ms.calc_score >= 70
        THEN 'MISPRICED'
        WHEN v_benchmark_price IS NOT NULL 
             AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL
             AND v_benchmark_price > 0
             AND ((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / v_benchmark_price * 100) <= (-1 * COALESCE(ms.under_benchmark_pct, 10))
             AND ms.calc_score >= 70
        THEN 'STRONG_BUY'
        WHEN v_benchmark_price IS NOT NULL 
             AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL
             AND v_benchmark_price > 0
             AND ((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / v_benchmark_price * 100) <= (-1 * COALESCE(ms.under_benchmark_pct, 10))
             AND ms.calc_score BETWEEN 55 AND 69
        THEN 'MISPRICED'
        WHEN v_benchmark_price IS NULL THEN 'NO_BENCHMARK'
        WHEN ms.calc_score BETWEEN 40 AND 54 THEN 'WATCH'
        ELSE 'NORMAL'
      END,
      COALESCE(v_listing.asking_price, v_listing.reserve),
      v_benchmark_price,
      CASE WHEN v_benchmark_price IS NOT NULL AND v_benchmark_price > 0 
                AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL
           THEN ROUND(((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / v_benchmark_price * 100)::numeric, 1)
      END,
      v_listing.make,
      v_listing.model,
      COALESCE(v_listing.variant_used, v_listing.variant_family),
      v_listing.year,
      v_listing.km,
      v_listing.region_id,
      v_listing.source_class,
      v_listing.listing_url,
      v_listing.watch_status,
      now()
    FROM matching_specs ms
    ON CONFLICT (dealer_spec_id, listing_uuid) DO UPDATE SET
      match_score = EXCLUDED.match_score,
      match_reason = EXCLUDED.match_reason,
      deal_label = EXCLUDED.deal_label,
      asking_price = EXCLUDED.asking_price,
      benchmark_price = EXCLUDED.benchmark_price,
      delta_pct = EXCLUDED.delta_pct,
      watch_status = EXCLUDED.watch_status,
      matched_at = now()
    RETURNING dealer_spec_id, listing_uuid, match_score, deal_label
  )
  SELECT 
    i.dealer_spec_id,
    i.listing_uuid,
    i.match_score,
    i.deal_label,
    ms.reason_text
  FROM inserted i
  JOIN matching_specs ms ON ms.id = i.dealer_spec_id;

END;
$$;


-- 2) RPC: run_spec_matching_batch
-- Runs matching for all listings updated in last X hours
CREATE OR REPLACE FUNCTION public.run_spec_matching_batch(p_since_hours int DEFAULT 24)
RETURNS TABLE(
  listings_checked int,
  specs_evaluated int,
  matches_created int,
  strong_buys int,
  mispriced int,
  buy_windows_set int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_listing record;
  v_listings_checked int := 0;
  v_specs_evaluated int := 0;
  v_matches_created int := 0;
  v_strong_buys int := 0;
  v_mispriced int := 0;
  v_buy_windows_set int := 0;
  v_match record;
  v_spec record;
BEGIN
  -- Process each eligible listing
  FOR v_listing IN
    SELECT l.id, l.watch_status, l.sold_returned_suspected
    FROM public.vehicle_listings l
    WHERE l.updated_at >= now() - make_interval(hours => p_since_hours)
      AND l.is_dealer_grade = true
      AND COALESCE(l.watch_status, '') != 'avoid'
      AND COALESCE(l.sold_returned_suspected, false) = false
    ORDER BY l.updated_at DESC
  LOOP
    v_listings_checked := v_listings_checked + 1;
    
    -- Run matching for this listing
    FOR v_match IN
      SELECT * FROM public.match_dealer_specs_for_listing(v_listing.id)
    LOOP
      v_matches_created := v_matches_created + 1;
      
      IF v_match.deal_label = 'STRONG_BUY' THEN
        v_strong_buys := v_strong_buys + 1;
      ELSIF v_match.deal_label = 'MISPRICED' THEN
        v_mispriced := v_mispriced + 1;
      END IF;
      
      -- Get spec settings for trigger actions
      SELECT * INTO v_spec
      FROM public.dealer_specs
      WHERE id = v_match.dealer_spec_id;
      
      -- TRIGGER: BUY_WINDOW
      IF v_spec.auto_buy_window = true 
         AND v_match.deal_label IN ('MISPRICED', 'STRONG_BUY')
         AND v_listing.watch_status IS DISTINCT FROM 'buy_window'
         AND v_listing.watch_status IS DISTINCT FROM 'avoid'
      THEN
        UPDATE public.vehicle_listings
        SET 
          watch_status = 'buy_window',
          buy_window_at = now(),
          watch_reason = 'Spec match: ' || v_spec.name,
          updated_at = now()
        WHERE id = v_listing.id
          AND COALESCE(watch_status, '') NOT IN ('avoid', 'buy_window')
          AND COALESCE(sold_returned_suspected, false) = false
          AND assigned_to IS NULL;
        
        IF FOUND THEN
          v_buy_windows_set := v_buy_windows_set + 1;
          
          -- Update the match record with new watch_status
          UPDATE public.dealer_spec_matches
          SET watch_status = 'buy_window'
          WHERE dealer_spec_id = v_match.dealer_spec_id
            AND listing_uuid = v_listing.id;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- Count total specs evaluated
  SELECT COUNT(*) INTO v_specs_evaluated
  FROM public.dealer_specs
  WHERE enabled = true AND deleted_at IS NULL;

  RETURN QUERY SELECT 
    v_listings_checked,
    v_specs_evaluated,
    v_matches_created,
    v_strong_buys,
    v_mispriced,
    v_buy_windows_set;
END;
$$;


-- 3) RPC: trigger_spec_match_slack_alerts
-- Sends Slack alerts for new BUY_WINDOW matches
CREATE OR REPLACE FUNCTION public.get_pending_spec_match_slack_alerts()
RETURNS TABLE(
  match_id uuid,
  spec_name text,
  dealer_name text,
  make text,
  model text,
  variant_used text,
  year int,
  km int,
  region_id text,
  asking_price numeric,
  benchmark_price numeric,
  delta_pct numeric,
  deal_label text,
  listing_url text,
  source_class text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    m.id,
    s.name,
    s.dealer_name,
    m.make,
    m.model,
    m.variant_used,
    m.year,
    m.km,
    m.region_id,
    m.asking_price,
    m.benchmark_price,
    m.delta_pct,
    m.deal_label,
    m.listing_url,
    m.source_class
  FROM public.dealer_spec_matches m
  JOIN public.dealer_specs s ON s.id = m.dealer_spec_id
  WHERE m.watch_status = 'buy_window'
    AND m.sent_to_slack_at IS NULL
    AND s.slack_alerts = true
    AND m.deal_label IN ('MISPRICED', 'STRONG_BUY')
  ORDER BY m.matched_at DESC
  LIMIT 50;
$$;


-- 4) Update sent_to_slack_at after sending
CREATE OR REPLACE FUNCTION public.mark_spec_matches_slack_sent(p_match_ids uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.dealer_spec_matches
  SET sent_to_slack_at = now()
  WHERE id = ANY(p_match_ids);
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


-- 5) Add index for Slack alert queries
CREATE INDEX IF NOT EXISTS idx_spec_matches_slack_pending
  ON public.dealer_spec_matches (watch_status, sent_to_slack_at)
  WHERE watch_status = 'buy_window' AND sent_to_slack_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_spec_matches_deal_label
  ON public.dealer_spec_matches (deal_label);

CREATE INDEX IF NOT EXISTS idx_spec_matches_matched_at
  ON public.dealer_spec_matches (matched_at DESC);