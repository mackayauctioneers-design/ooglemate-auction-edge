-- =====================================================
-- DEALER SPECS TABLE (Enhanced v2)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.dealer_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL,
  dealer_name text NOT NULL,
  
  -- Identity
  name text NOT NULL,
  enabled boolean DEFAULT true,
  priority text DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
  
  -- Vehicle Definition
  make text NOT NULL,
  model text NOT NULL,
  variant_family text,
  year_min int,
  year_max int,
  km_min int,
  km_max int,
  fuel_allow text[],
  trans_allow text[],
  drive_allow text[],
  
  -- Region
  region_scope text NOT NULL DEFAULT 'NSW_CENTRAL_COAST',
  
  -- Pricing & Opportunity Rules
  under_benchmark_pct numeric DEFAULT 10 CHECK (under_benchmark_pct >= 5 AND under_benchmark_pct <= 30),
  min_benchmark_confidence text DEFAULT 'med' CHECK (min_benchmark_confidence IN ('low', 'med', 'high')),
  allow_no_benchmark boolean DEFAULT true,
  hard_max_price numeric,
  
  -- Output Controls
  push_watchlist boolean DEFAULT true,
  auto_buy_window boolean DEFAULT true,
  slack_alerts boolean DEFAULT true,
  va_tasks boolean DEFAULT false,
  
  -- Exploration Mode
  exploration_mode boolean DEFAULT false,
  
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_dealer_specs_dealer_enabled ON public.dealer_specs (dealer_id, enabled) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dealer_specs_make_model ON public.dealer_specs (make, model);
CREATE INDEX IF NOT EXISTS idx_dealer_specs_region ON public.dealer_specs (region_scope);
CREATE INDEX IF NOT EXISTS idx_dealer_specs_priority ON public.dealer_specs (priority);

-- RLS for dealer_specs
ALTER TABLE public.dealer_specs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all dealer specs"
  ON public.dealer_specs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Dealers can view own specs"
  ON public.dealer_specs FOR SELECT
  USING (dealer_id IN (
    SELECT dp.id FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid()
  ));

CREATE POLICY "Dealers can insert own specs"
  ON public.dealer_specs FOR INSERT
  WITH CHECK (dealer_id IN (
    SELECT dp.id FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid()
  ));

CREATE POLICY "Dealers can update own specs"
  ON public.dealer_specs FOR UPDATE
  USING (dealer_id IN (
    SELECT dp.id FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid()
  ));

-- =====================================================
-- DEALER SPEC MATCHES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.dealer_spec_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_spec_id uuid NOT NULL REFERENCES public.dealer_specs(id) ON DELETE CASCADE,
  listing_uuid uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  
  matched_at timestamptz DEFAULT now(),
  match_score numeric CHECK (match_score >= 0 AND match_score <= 100),
  match_reason jsonb,
  
  deal_label text CHECK (deal_label IN ('MISPRICED', 'STRONG_BUY', 'WATCH', 'NORMAL', 'NO_BENCHMARK')),
  watch_status text,
  
  -- Pricing snapshot
  asking_price numeric,
  benchmark_price numeric,
  delta_pct numeric,
  
  -- Vehicle snapshot
  make text,
  model text,
  variant_used text,
  year int,
  km int,
  region_id text,
  source_class text,
  listing_url text,
  
  sent_to_slack_at timestamptz,
  created_at timestamptz DEFAULT now(),
  
  CONSTRAINT uniq_spec_listing UNIQUE (dealer_spec_id, listing_uuid)
);

CREATE INDEX IF NOT EXISTS idx_spec_matches_spec_date ON public.dealer_spec_matches (dealer_spec_id, matched_at DESC);
CREATE INDEX IF NOT EXISTS idx_spec_matches_listing ON public.dealer_spec_matches (listing_uuid);
CREATE INDEX IF NOT EXISTS idx_spec_matches_deal_label ON public.dealer_spec_matches (deal_label);

-- RLS for dealer_spec_matches
ALTER TABLE public.dealer_spec_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all spec matches"
  ON public.dealer_spec_matches FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Dealers can view own spec matches"
  ON public.dealer_spec_matches FOR SELECT
  USING (dealer_spec_id IN (
    SELECT ds.id FROM public.dealer_specs ds
    WHERE ds.dealer_id IN (
      SELECT dp.id FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid()
    )
  ));

-- =====================================================
-- RPC: match_dealer_specs_for_listing
-- =====================================================
CREATE OR REPLACE FUNCTION public.match_dealer_specs_for_listing(p_listing_uuid uuid)
RETURNS TABLE(matches_created int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_listing record;
  v_benchmark_price numeric;
  v_created int := 0;
  v_current_year int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
BEGIN
  SELECT * INTO v_listing FROM public.vehicle_listings WHERE id = p_listing_uuid;
  IF NOT FOUND THEN RETURN QUERY SELECT 0; RETURN; END IF;
  
  -- Safety: skip avoid/sold-returned
  IF COALESCE(v_listing.sold_returned_suspected, false) OR v_listing.watch_status = 'avoid' THEN
    RETURN QUERY SELECT 0; RETURN;
  END IF;

  -- Get benchmark price
  SELECT fp.avg_price INTO v_benchmark_price
  FROM public.fingerprint_outcomes_latest fp
  WHERE upper(fp.make) = upper(v_listing.make)
    AND upper(fp.model) = upper(v_listing.model)
  LIMIT 1;

  -- Insert matches for all matching specs
  INSERT INTO public.dealer_spec_matches (
    dealer_spec_id, listing_uuid, match_score, match_reason, deal_label,
    asking_price, benchmark_price, delta_pct,
    make, model, variant_used, year, km, region_id, source_class, listing_url
  )
  SELECT
    s.id,
    v_listing.id,
    -- Match score calculation
    (100 
      - CASE WHEN s.variant_family IS NOT NULL AND upper(s.variant_family) != upper(COALESCE(v_listing.variant_used, v_listing.variant_family, '')) THEN 20 ELSE 0 END
      - CASE WHEN v_benchmark_price IS NULL THEN 10 ELSE 0 END
    )::numeric,
    jsonb_build_object(
      'make_match', true,
      'model_match', true,
      'variant_match', s.variant_family IS NULL OR upper(s.variant_family) = upper(COALESCE(v_listing.variant_used, v_listing.variant_family, '')),
      'year_in_range', v_listing.year BETWEEN COALESCE(s.year_min, v_current_year - 10) AND COALESCE(s.year_max, v_current_year),
      'km_in_range', s.km_max IS NULL OR v_listing.km IS NULL OR v_listing.km <= s.km_max,
      'under_benchmark', v_benchmark_price IS NOT NULL AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL 
        AND ((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / NULLIF(v_benchmark_price, 0) * 100) <= (-1 * s.under_benchmark_pct)
    ),
    CASE
      WHEN v_benchmark_price IS NULL THEN 'NO_BENCHMARK'
      WHEN v_benchmark_price > 0 AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL 
           AND ((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / v_benchmark_price * 100) <= -20 THEN 'MISPRICED'
      WHEN v_benchmark_price > 0 AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL 
           AND ((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / v_benchmark_price * 100) <= -10 THEN 'STRONG_BUY'
      WHEN v_listing.watch_status = 'buy_window' THEN 'STRONG_BUY'
      ELSE 'WATCH'
    END,
    COALESCE(v_listing.asking_price, v_listing.reserve),
    v_benchmark_price,
    CASE WHEN v_benchmark_price > 0 AND COALESCE(v_listing.asking_price, v_listing.reserve) IS NOT NULL
         THEN ROUND(((COALESCE(v_listing.asking_price, v_listing.reserve) - v_benchmark_price) / v_benchmark_price * 100)::numeric, 1)
         ELSE NULL END,
    v_listing.make, v_listing.model, COALESCE(v_listing.variant_used, v_listing.variant_family),
    v_listing.year, v_listing.km, v_listing.location, v_listing.source_class, v_listing.listing_url
  FROM public.dealer_specs s
  WHERE s.enabled = true
    AND s.deleted_at IS NULL
    AND upper(s.make) = upper(v_listing.make)
    AND upper(s.model) = upper(v_listing.model)
    AND (s.variant_family IS NULL OR s.exploration_mode = true 
         OR upper(s.variant_family) = upper(COALESCE(v_listing.variant_used, v_listing.variant_family, '')))
    AND v_listing.year BETWEEN COALESCE(s.year_min, v_current_year - 10) AND COALESCE(s.year_max, v_current_year)
    AND (s.km_min IS NULL OR v_listing.km IS NULL OR v_listing.km >= s.km_min)
    AND (s.km_max IS NULL OR v_listing.km IS NULL OR v_listing.km <= s.km_max)
    AND (s.fuel_allow IS NULL OR array_length(s.fuel_allow, 1) IS NULL OR upper(COALESCE(v_listing.fuel, '')) = ANY(SELECT upper(unnest(s.fuel_allow))))
    AND (s.trans_allow IS NULL OR array_length(s.trans_allow, 1) IS NULL OR upper(COALESCE(v_listing.transmission, '')) = ANY(SELECT upper(unnest(s.trans_allow))))
    AND (s.drive_allow IS NULL OR array_length(s.drive_allow, 1) IS NULL OR upper(COALESCE(v_listing.drivetrain, '')) = ANY(SELECT upper(unnest(s.drive_allow))))
    AND (s.region_scope = 'ALL' OR upper(s.region_scope) = upper(COALESCE(v_listing.location, '')))
    AND (s.hard_max_price IS NULL OR COALESCE(v_listing.asking_price, v_listing.reserve, 0) <= s.hard_max_price)
    AND (s.allow_no_benchmark = true OR v_benchmark_price IS NOT NULL)
  ON CONFLICT (dealer_spec_id, listing_uuid) DO UPDATE SET
    matched_at = now(),
    match_score = EXCLUDED.match_score,
    match_reason = EXCLUDED.match_reason,
    deal_label = EXCLUDED.deal_label,
    asking_price = EXCLUDED.asking_price,
    benchmark_price = EXCLUDED.benchmark_price,
    delta_pct = EXCLUDED.delta_pct;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN QUERY SELECT v_created;
END;
$$;

-- =====================================================
-- RPC: get_spec_hits_summary
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_spec_hits_summary(p_spec_id uuid)
RETURNS TABLE(
  total_30d bigint,
  total_7d bigint,
  mispriced_count bigint,
  strong_buy_count bigint,
  watch_count bigint,
  no_benchmark_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COUNT(*) FILTER (WHERE matched_at >= now() - interval '30 days') AS total_30d,
    COUNT(*) FILTER (WHERE matched_at >= now() - interval '7 days') AS total_7d,
    COUNT(*) FILTER (WHERE deal_label = 'MISPRICED' AND matched_at >= now() - interval '30 days') AS mispriced_count,
    COUNT(*) FILTER (WHERE deal_label = 'STRONG_BUY' AND matched_at >= now() - interval '30 days') AS strong_buy_count,
    COUNT(*) FILTER (WHERE deal_label = 'WATCH' AND matched_at >= now() - interval '30 days') AS watch_count,
    COUNT(*) FILTER (WHERE deal_label = 'NO_BENCHMARK' AND matched_at >= now() - interval '30 days') AS no_benchmark_count
  FROM public.dealer_spec_matches
  WHERE dealer_spec_id = p_spec_id;
$$;