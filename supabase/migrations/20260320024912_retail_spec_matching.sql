-- ============================================================================
-- RETAIL LISTINGS → DEALER SPEC MATCHING
-- Extends the spec matching engine to also scan retail_listings (130k records)
-- so the website shows matches from Carsales, Autotrader, Drive etc.
-- ============================================================================

-- 1) New RPC: match_dealer_specs_for_retail_listing
-- Mirrors match_dealer_specs_for_listing but reads from retail_listings
-- with proper field mapping (fuel_type→fuel, variant_family→variant_used, etc.)
DROP FUNCTION IF EXISTS public.match_dealer_specs_for_retail_listing(uuid);

CREATE OR REPLACE FUNCTION public.match_dealer_specs_for_retail_listing(p_listing_id uuid)
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
BEGIN
  -- Load retail listing
  SELECT * INTO v_listing
  FROM public.retail_listings
  WHERE id = p_listing_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Skip delisted
  IF v_listing.lifecycle_status IS NOT NULL AND v_listing.lifecycle_status != 'active' THEN
    RETURN;
  END IF;

  -- Get benchmark price from fingerprint_outcomes_latest
  SELECT fo.avg_price INTO v_benchmark_price
  FROM public.fingerprint_outcomes_latest fo
  WHERE upper(fo.make) = upper(v_listing.make)
    AND upper(fo.model) = upper(v_listing.model)
    AND (fo.variant_family = COALESCE(v_listing.variant_family, 'ALL')
         OR fo.variant_family = 'ALL')
    AND fo.region_id = COALESCE(v_listing.region_id, 'AU-NATIONAL')
    AND v_listing.year BETWEEN fo.year_min AND fo.year_max
  ORDER BY
    CASE WHEN fo.variant_family != 'ALL' THEN 0 ELSE 1 END,
    fo.cleared_total DESC
  LIMIT 1;

  -- Insert matches for all matching dealer specs
  RETURN QUERY
  WITH matching_specs AS (
    SELECT
      s.*,
      -- Calculate match score (same logic as vehicle_listings version)
      (
        40  -- base make/model match
        + CASE WHEN s.variant_family IS NOT NULL
               AND upper(COALESCE(s.variant_family,'')) = upper(COALESCE(v_listing.variant_family, ''))
          THEN 15 ELSE 0 END
        + CASE WHEN s.region_scope = v_listing.region_id THEN 10
               WHEN s.region_scope = 'ALL' THEN 5
               ELSE 0 END
        + CASE WHEN v_benchmark_price IS NOT NULL
               AND v_listing.asking_price IS NOT NULL
               AND v_benchmark_price > 0
               AND ((v_listing.asking_price - v_benchmark_price) / v_benchmark_price * 100) <= (-1 * COALESCE(s.under_benchmark_pct, 10))
          THEN 20 ELSE 0 END
        + CASE WHEN v_benchmark_price IS NOT NULL THEN 5 ELSE 0 END
      )::numeric AS calc_score,
      -- Build reason string
      concat_ws('; ',
        'Make/Model match (retail)',
        CASE WHEN s.variant_family IS NOT NULL
             AND upper(COALESCE(s.variant_family,'')) = upper(COALESCE(v_listing.variant_family, ''))
        THEN 'Variant match' END,
        CASE WHEN s.region_scope = v_listing.region_id THEN 'Exact region match'
             WHEN s.region_scope = 'ALL' THEN 'National scope' END,
        CASE WHEN v_benchmark_price IS NOT NULL
             AND v_listing.asking_price IS NOT NULL
             AND v_benchmark_price > 0
        THEN 'Under benchmark by ' ||
             ROUND(ABS((v_listing.asking_price - v_benchmark_price) / v_benchmark_price * 100), 1) || '%'
        END,
        'Source: ' || COALESCE(v_listing.source, 'retail')
      ) AS reason_text
    FROM public.dealer_specs s
    WHERE s.enabled = true
      AND s.deleted_at IS NULL
      -- Make/Model match
      AND upper(s.make) = upper(v_listing.make)
      AND upper(s.model) = upper(v_listing.model)
      -- Variant filter (if specified)
      AND (s.variant_family IS NULL
           OR upper(s.variant_family) = upper(COALESCE(v_listing.variant_family, ''))
           OR s.exploration_mode = true)
      -- Year range (rolling 10y default)
      AND (v_listing.year >= COALESCE(s.year_min, v_current_year - 10))
      AND (v_listing.year <= COALESCE(s.year_max, v_current_year))
      -- KM range
      AND (s.km_min IS NULL OR v_listing.km IS NULL OR v_listing.km >= s.km_min)
      AND (s.km_max IS NULL OR v_listing.km IS NULL OR v_listing.km <= s.km_max)
      -- Fuel filter (retail uses fuel_type not fuel)
      AND (s.fuel_allow IS NULL OR array_length(s.fuel_allow, 1) IS NULL
           OR upper(COALESCE(v_listing.fuel_type, '')) = ANY(SELECT upper(unnest(s.fuel_allow))))
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
           OR COALESCE(v_listing.asking_price, 0) <= s.hard_max_price)
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
             AND v_listing.asking_price IS NOT NULL
             AND v_benchmark_price > 0
             AND ((v_listing.asking_price - v_benchmark_price) / v_benchmark_price * 100) <= -20
             AND ms.calc_score >= 70
        THEN 'MISPRICED'
        WHEN v_benchmark_price IS NOT NULL
             AND v_listing.asking_price IS NOT NULL
             AND v_benchmark_price > 0
             AND ((v_listing.asking_price - v_benchmark_price) / v_benchmark_price * 100) <= (-1 * COALESCE(ms.under_benchmark_pct, 10))
             AND ms.calc_score >= 70
        THEN 'STRONG_BUY'
        WHEN v_benchmark_price IS NOT NULL
             AND v_listing.asking_price IS NOT NULL
             AND v_benchmark_price > 0
             AND ((v_listing.asking_price - v_benchmark_price) / v_benchmark_price * 100) <= (-1 * COALESCE(ms.under_benchmark_pct, 10))
             AND ms.calc_score BETWEEN 55 AND 69
        THEN 'MISPRICED'
        WHEN v_benchmark_price IS NULL THEN 'NO_BENCHMARK'
        WHEN ms.calc_score BETWEEN 40 AND 54 THEN 'WATCH'
        ELSE 'NORMAL'
      END,
      v_listing.asking_price,
      v_benchmark_price,
      CASE WHEN v_benchmark_price IS NOT NULL AND v_benchmark_price > 0
                AND v_listing.asking_price IS NOT NULL
           THEN ROUND(((v_listing.asking_price - v_benchmark_price) / v_benchmark_price * 100)::numeric, 1)
      END,
      v_listing.make,
      v_listing.model,
      v_listing.variant_family,
      v_listing.year,
      v_listing.km,
      v_listing.region_id,
      CASE
        WHEN lower(COALESCE(v_listing.source,'')) ~ '(carsales|autotrader|drive|gumtree)' THEN 'marketplace'
        ELSE 'retail'
      END,
      v_listing.listing_url,
      NULL,  -- no watch_status concept on retail
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


-- 2) Upgrade run_spec_matching_batch to also scan retail_listings
-- Replaces the existing function with a version that processes both tables
DROP FUNCTION IF EXISTS public.run_spec_matching_batch(int);

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
  -- ═══════════════════════════════════════════════
  -- PART A: Process vehicle_listings (auction/OEM) — existing behaviour
  -- ═══════════════════════════════════════════════
  FOR v_listing IN
    SELECT l.id, l.watch_status, l.sold_returned_suspected, 'vehicle' AS listing_source
    FROM public.vehicle_listings l
    WHERE l.updated_at >= now() - make_interval(hours => p_since_hours)
      AND l.is_dealer_grade = true
      AND COALESCE(l.watch_status, '') != 'avoid'
      AND COALESCE(l.sold_returned_suspected, false) = false
    ORDER BY l.updated_at DESC
  LOOP
    v_listings_checked := v_listings_checked + 1;

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

          UPDATE public.dealer_spec_matches
          SET watch_status = 'buy_window'
          WHERE dealer_spec_id = v_match.dealer_spec_id
            AND listing_uuid = v_listing.id;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ═══════════════════════════════════════════════
  -- PART B: Process retail_listings (Carsales, Autotrader, Drive, etc.)
  -- ═══════════════════════════════════════════════
  FOR v_listing IN
    SELECT rl.id, NULL::text AS watch_status, false AS sold_returned_suspected, 'retail' AS listing_source
    FROM public.retail_listings rl
    WHERE rl.updated_at >= now() - make_interval(hours => p_since_hours)
      AND rl.lifecycle_status = 'active'
    ORDER BY rl.updated_at DESC
  LOOP
    v_listings_checked := v_listings_checked + 1;

    FOR v_match IN
      SELECT * FROM public.match_dealer_specs_for_retail_listing(v_listing.id)
    LOOP
      v_matches_created := v_matches_created + 1;

      IF v_match.deal_label = 'STRONG_BUY' THEN
        v_strong_buys := v_strong_buys + 1;
      ELSIF v_match.deal_label = 'MISPRICED' THEN
        v_mispriced := v_mispriced + 1;
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


-- 3) Index for retail_listings spec matching performance
CREATE INDEX IF NOT EXISTS idx_retail_listings_spec_match
  ON public.retail_listings (make, model, year, lifecycle_status)
  WHERE lifecycle_status = 'active';

CREATE INDEX IF NOT EXISTS idx_retail_listings_updated_active
  ON public.retail_listings (updated_at DESC)
  WHERE lifecycle_status = 'active';
