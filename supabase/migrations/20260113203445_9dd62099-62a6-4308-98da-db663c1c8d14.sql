-- =====================================================
-- DEALER MATCH SPECS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.dealer_match_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL,
  dealer_name text NOT NULL,
  enabled boolean DEFAULT true,

  -- core identity
  make text NOT NULL,
  model text NOT NULL,
  variant_family text,
  fuel text,
  transmission text,
  drivetrain text,

  -- bands
  year_min int,
  year_max int,
  km_max int,

  -- region scope
  region_scope text DEFAULT 'REGION',
  region_id text,

  -- pricing logic
  min_under_pct numeric DEFAULT 10,
  require_benchmark boolean DEFAULT false,

  -- notes
  note text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_specs_dealer_enabled
  ON public.dealer_match_specs (dealer_id, enabled);

CREATE INDEX IF NOT EXISTS idx_specs_make_model
  ON public.dealer_match_specs (make, model);

-- RLS for dealer_match_specs
ALTER TABLE public.dealer_match_specs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage dealer specs"
  ON public.dealer_match_specs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Dealers can view own specs"
  ON public.dealer_match_specs FOR SELECT
  USING (dealer_id IN (
    SELECT dp.id FROM public.dealer_profiles dp
    WHERE dp.user_id = auth.uid()
  ));

-- =====================================================
-- DEALER MATCH ALERTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.dealer_match_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  dealer_id uuid NOT NULL,
  spec_id uuid NOT NULL REFERENCES public.dealer_match_specs(id) ON DELETE CASCADE,

  listing_uuid uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  alert_date date NOT NULL DEFAULT CURRENT_DATE,

  match_type text NOT NULL,
  match_score numeric,

  -- pricing context
  benchmark_price numeric,
  asking_price numeric,
  delta_pct numeric,
  delta_dollars numeric,

  -- lightweight snapshot
  make text,
  model text,
  variant_used text,
  year int,
  km int,
  region_id text,
  source text,
  source_class text,
  listing_url text,

  -- status tracking
  status text DEFAULT 'new',
  claimed_by text,
  claimed_at timestamptz,

  created_at timestamptz DEFAULT now()
);

-- Dedup: only one alert per (dealer, spec, listing) per day
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dealer_spec_listing_day
  ON public.dealer_match_alerts (dealer_id, spec_id, listing_uuid, alert_date);

CREATE INDEX IF NOT EXISTS idx_alerts_dealer_date
  ON public.dealer_match_alerts (dealer_id, alert_date DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_status
  ON public.dealer_match_alerts (status, created_at DESC);

-- RLS for dealer_match_alerts
ALTER TABLE public.dealer_match_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage dealer alerts"
  ON public.dealer_match_alerts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Dealers can view own alerts"
  ON public.dealer_match_alerts FOR SELECT
  USING (dealer_id IN (
    SELECT dp.id FROM public.dealer_profiles dp
    WHERE dp.user_id = auth.uid()
  ));

CREATE POLICY "Dealers can update own alerts"
  ON public.dealer_match_alerts FOR UPDATE
  USING (dealer_id IN (
    SELECT dp.id FROM public.dealer_profiles dp
    WHERE dp.user_id = auth.uid()
  ));

-- =====================================================
-- RPC: evaluate_dealer_spec_matches_for_listing
-- =====================================================
CREATE OR REPLACE FUNCTION public.evaluate_dealer_spec_matches_for_listing(p_listing_uuid uuid)
RETURNS TABLE(alerts_created int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_listing record;
  v_benchmark_price numeric;
  v_created int := 0;
BEGIN
  SELECT * INTO v_listing
  FROM public.vehicle_listings
  WHERE id = p_listing_uuid;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0;
    RETURN;
  END IF;

  -- Safety: never alert on avoid/sold-returned
  IF COALESCE(v_listing.sold_returned_suspected, false) = true
     OR v_listing.watch_status = 'avoid' THEN
    RETURN QUERY SELECT 0;
    RETURN;
  END IF;

  -- Determine benchmark price from fingerprint_outcomes_latest
  SELECT COALESCE(fp_exact.avg_price, fp_all.avg_price) INTO v_benchmark_price
  FROM (SELECT 1) dummy
  LEFT JOIN public.fingerprint_outcomes_latest fp_exact
    ON fp_exact.region_id = COALESCE(v_listing.location, 'NSW_CENTRAL_COAST')
   AND upper(fp_exact.make) = upper(v_listing.make)
   AND upper(fp_exact.model) = upper(v_listing.model)
   AND fp_exact.variant_family = COALESCE(v_listing.variant_used, v_listing.variant_family, 'ALL')
  LEFT JOIN public.fingerprint_outcomes_latest fp_all
    ON fp_all.region_id = COALESCE(v_listing.location, 'NSW_CENTRAL_COAST')
   AND upper(fp_all.make) = upper(v_listing.make)
   AND upper(fp_all.model) = upper(v_listing.model)
   AND fp_all.variant_family = 'ALL'
  LIMIT 1;

  -- Insert matching alerts
  INSERT INTO public.dealer_match_alerts (
    dealer_id, spec_id, listing_uuid, alert_date,
    match_type, match_score,
    benchmark_price, asking_price, delta_pct, delta_dollars,
    make, model, variant_used, year, km, region_id, source, source_class, listing_url
  )
  SELECT
    s.dealer_id,
    s.id,
    v_listing.id,
    CURRENT_DATE,
    CASE
      WHEN v_listing.watch_status = 'buy_window' THEN 'BUY_WINDOW_MATCH'
      WHEN v_benchmark_price IS NOT NULL 
           AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL 
           AND ((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / NULLIF(v_benchmark_price, 0)) <= -0.20 
      THEN 'UNDER_BENCHMARK'
      ELSE 'SPEC_MATCH'
    END,
    (100
      - CASE WHEN s.variant_family IS NOT NULL THEN 10 ELSE 0 END
      - CASE WHEN s.fuel IS NOT NULL THEN 5 ELSE 0 END
      - CASE WHEN s.transmission IS NOT NULL THEN 5 ELSE 0 END
      - CASE WHEN s.drivetrain IS NOT NULL THEN 5 ELSE 0 END
    )::numeric,
    v_benchmark_price,
    COALESCE(v_listing.asking_price, v_listing.reserve),
    CASE 
      WHEN v_benchmark_price IS NULL OR v_benchmark_price = 0 OR COALESCE(v_listing.asking_price, v_listing.reserve) IS NULL 
      THEN NULL
      ELSE ROUND(((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / v_benchmark_price * 100)::numeric, 1)
    END,
    CASE 
      WHEN v_benchmark_price IS NULL OR COALESCE(v_listing.asking_price, v_listing.reserve) IS NULL 
      THEN NULL
      ELSE (COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price)
    END,
    v_listing.make,
    v_listing.model,
    COALESCE(v_listing.variant_used, v_listing.variant_family),
    v_listing.year,
    v_listing.km,
    v_listing.location,
    v_listing.source,
    v_listing.source_class,
    v_listing.listing_url
  FROM public.dealer_match_specs s
  WHERE s.enabled = true
    AND upper(s.make) = upper(v_listing.make)
    AND upper(s.model) = upper(v_listing.model)
    AND (
      s.variant_family IS NULL
      OR upper(s.variant_family) = upper(COALESCE(v_listing.variant_used, v_listing.variant_family, ''))
    )
    AND (s.year_min IS NULL OR v_listing.year >= s.year_min)
    AND (s.year_max IS NULL OR v_listing.year <= s.year_max)
    AND (s.km_max IS NULL OR v_listing.km IS NULL OR v_listing.km <= s.km_max)
    AND (s.fuel IS NULL OR upper(coalesce(v_listing.fuel, '')) = upper(s.fuel))
    AND (s.transmission IS NULL OR upper(coalesce(v_listing.transmission, '')) = upper(s.transmission))
    AND (s.drivetrain IS NULL OR upper(coalesce(v_listing.drivetrain, '')) = upper(s.drivetrain))
    AND (
      s.region_scope = 'NATIONAL'
      OR (s.region_scope = 'REGION' AND s.region_id IS NOT NULL AND upper(s.region_id) = upper(coalesce(v_listing.location, '')))
    )
    AND (
      s.require_benchmark = false
      OR v_benchmark_price IS NOT NULL
    )
    AND (
      v_benchmark_price IS NULL
      OR COALESCE(v_listing.asking_price, v_listing.reserve) IS NULL
      OR ((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / NULLIF(v_benchmark_price, 0) * 100) <= (-1 * COALESCE(s.min_under_pct, 0))
      OR v_listing.watch_status = 'buy_window'
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN QUERY SELECT v_created;
END;
$$;