-- ============================================================================
-- PROFIT-WEIGHTED AUCTION SCORING (v1)
-- ============================================================================

-- 1. DEALER OUTCOMES TABLE
CREATE TABLE IF NOT EXISTS public.dealer_outcomes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dealer_id TEXT NOT NULL,
  dealer_name TEXT,
  fingerprint TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_family TEXT,
  year INTEGER NOT NULL,
  km_band TEXT,
  fuel TEXT,
  transmission TEXT,
  drivetrain TEXT,
  region_id TEXT,
  purchase_price NUMERIC,
  sale_price NUMERIC,
  gross_profit NUMERIC,
  days_to_exit INTEGER,
  sold_date DATE,
  source_channel TEXT DEFAULT 'unknown',
  confidence NUMERIC DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  variant_confidence NUMERIC DEFAULT 0.5 CHECK (variant_confidence >= 0 AND variant_confidence <= 1),
  source_row_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.dealer_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all dealer outcomes"
  ON public.dealer_outcomes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'internal')));

CREATE POLICY "Dealers can view their own outcomes"
  ON public.dealer_outcomes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid() AND dp.dealer_name = dealer_outcomes.dealer_name));

CREATE POLICY "Service role can manage dealer outcomes"
  ON public.dealer_outcomes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_dealer_outcomes_fingerprint ON public.dealer_outcomes(fingerprint);
CREATE INDEX IF NOT EXISTS idx_dealer_outcomes_dealer ON public.dealer_outcomes(dealer_id);
CREATE INDEX IF NOT EXISTS idx_dealer_outcomes_make_model ON public.dealer_outcomes(make, model);
CREATE INDEX IF NOT EXISTS idx_dealer_outcomes_sold_date ON public.dealer_outcomes(sold_date DESC);

-- 2. FINGERPRINT PROFIT STATS TABLE
CREATE TABLE IF NOT EXISTS public.fingerprint_profit_stats (
  fingerprint TEXT NOT NULL,
  region_id TEXT DEFAULT 'ALL',
  sample_size INTEGER NOT NULL DEFAULT 0,
  last_sale_date DATE,
  median_gross_profit NUMERIC,
  p25_gross_profit NUMERIC,
  p75_gross_profit NUMERIC,
  avg_gross_profit NUMERIC,
  median_days_to_exit INTEGER,
  avg_days_to_exit NUMERIC,
  win_rate NUMERIC CHECK (win_rate >= 0 AND win_rate <= 1),
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (fingerprint, region_id)
);

ALTER TABLE public.fingerprint_profit_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view fingerprint stats"
  ON public.fingerprint_profit_stats FOR SELECT TO authenticated;

CREATE POLICY "Service role can manage fingerprint stats"
  ON public.fingerprint_profit_stats FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_fps_fingerprint ON public.fingerprint_profit_stats(fingerprint);
CREATE INDEX IF NOT EXISTS idx_fps_region ON public.fingerprint_profit_stats(region_id);

-- 3. Helper functions
CREATE OR REPLACE FUNCTION public.build_profit_fingerprint(
  p_make TEXT, p_model TEXT, p_variant_family TEXT, p_year INTEGER,
  p_km_band TEXT, p_fuel TEXT, p_transmission TEXT
) RETURNS TEXT AS $$
BEGIN
  RETURN LOWER(CONCAT_WS('|', COALESCE(p_make, 'ANY'), COALESCE(p_model, 'ANY'), COALESCE(p_variant_family, 'ANY'),
    COALESCE(p_year::TEXT, 'ANY'), COALESCE(p_km_band, 'ANY'), COALESCE(p_fuel, 'ANY'), COALESCE(p_transmission, 'ANY')));
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.km_to_profit_band(p_km INTEGER) RETURNS TEXT AS $$
BEGIN
  IF p_km IS NULL THEN RETURN 'UNKNOWN'; END IF;
  IF p_km < 60000 THEN RETURN '0-60k'; END IF;
  IF p_km < 120000 THEN RETURN '60-120k'; END IF;
  IF p_km < 200000 THEN RETURN '120-200k'; END IF;
  RETURN '200k+';
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

-- 4. Backfill function (fixed alias)
CREATE OR REPLACE FUNCTION public.backfill_dealer_outcomes_from_sales() RETURNS TABLE(inserted INTEGER, skipped INTEGER) AS $$
DECLARE
  v_inserted INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN 
    SELECT sn.id::TEXT as source_row_id, sn.dealer_name, sn.make, sn.model, sn.variant_family,
      sn.year, sn.km, sn.fuel, sn.transmission, sn.drivetrain, sn.region_id,
      sn.sale_price, sn.gross_profit, sn.days_in_stock, sn.sale_date
    FROM public.sales_normalised sn
    WHERE sn.sale_date IS NOT NULL AND sn.make IS NOT NULL AND sn.model IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.dealer_outcomes dout WHERE dout.source_row_id = sn.id::TEXT)
  LOOP
    INSERT INTO public.dealer_outcomes (
      dealer_id, dealer_name, fingerprint, make, model, variant_family, year, km_band,
      fuel, transmission, drivetrain, region_id, sale_price, gross_profit,
      days_to_exit, sold_date, source_channel, confidence, variant_confidence, source_row_id
    ) VALUES (
      COALESCE(r.dealer_name, 'unknown'), r.dealer_name,
      public.build_profit_fingerprint(r.make, r.model, r.variant_family, r.year, public.km_to_profit_band(r.km), r.fuel, r.transmission),
      r.make, r.model, r.variant_family, r.year, public.km_to_profit_band(r.km),
      r.fuel, r.transmission, r.drivetrain, r.region_id, r.sale_price, r.gross_profit,
      r.days_in_stock, r.sale_date, 'dealer_sale',
      CASE WHEN r.gross_profit IS NOT NULL THEN 0.8 ELSE 0.5 END,
      CASE WHEN r.variant_family IS NOT NULL THEN 0.8 ELSE 0.4 END, r.source_row_id
    );
    v_inserted := v_inserted + 1;
  END LOOP;
  inserted := v_inserted;
  skipped := 0;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Materialize stats function
CREATE OR REPLACE FUNCTION public.materialize_fingerprint_profit_stats() RETURNS TABLE(fingerprints_updated INTEGER) AS $$
DECLARE
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT dout.fingerprint, COALESCE(dout.region_id, 'ALL') as region_id,
      COUNT(*)::INTEGER as sample_size, MAX(dout.sold_date) as last_sale_date,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dout.gross_profit) as median_gross_profit,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY dout.gross_profit) as p25_gross_profit,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY dout.gross_profit) as p75_gross_profit,
      AVG(dout.gross_profit) as avg_gross_profit,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dout.days_to_exit)::INTEGER as median_days_to_exit,
      AVG(dout.days_to_exit) as avg_days_to_exit,
      SUM(CASE WHEN dout.gross_profit > 0 THEN 1 ELSE 0 END)::NUMERIC / NULLIF(COUNT(*), 0) as win_rate
    FROM public.dealer_outcomes dout
    WHERE dout.sold_date >= CURRENT_DATE - INTERVAL '12 months' AND dout.gross_profit IS NOT NULL
    GROUP BY dout.fingerprint, COALESCE(dout.region_id, 'ALL')
  LOOP
    INSERT INTO public.fingerprint_profit_stats (
      fingerprint, region_id, sample_size, last_sale_date, median_gross_profit, p25_gross_profit,
      p75_gross_profit, avg_gross_profit, median_days_to_exit, avg_days_to_exit, win_rate, last_updated
    ) VALUES (r.fingerprint, r.region_id, r.sample_size, r.last_sale_date, r.median_gross_profit,
      r.p25_gross_profit, r.p75_gross_profit, r.avg_gross_profit, r.median_days_to_exit, r.avg_days_to_exit, r.win_rate, now())
    ON CONFLICT (fingerprint, region_id) DO UPDATE SET
      sample_size = EXCLUDED.sample_size, last_sale_date = EXCLUDED.last_sale_date,
      median_gross_profit = EXCLUDED.median_gross_profit, p25_gross_profit = EXCLUDED.p25_gross_profit,
      p75_gross_profit = EXCLUDED.p75_gross_profit, avg_gross_profit = EXCLUDED.avg_gross_profit,
      median_days_to_exit = EXCLUDED.median_days_to_exit, avg_days_to_exit = EXCLUDED.avg_days_to_exit,
      win_rate = EXCLUDED.win_rate, last_updated = now();
    v_count := v_count + 1;
  END LOOP;
  fingerprints_updated := v_count;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. Lot profit score function
CREATE OR REPLACE FUNCTION public.calculate_lot_profit_score(
  p_make TEXT, p_model TEXT, p_variant_family TEXT, p_year INTEGER,
  p_km INTEGER, p_fuel TEXT, p_transmission TEXT, p_region_id TEXT,
  p_location TEXT DEFAULT NULL, p_gp_target NUMERIC DEFAULT 4000, p_exit_target_days INTEGER DEFAULT 21
) RETURNS TABLE(lot_score NUMERIC, median_gp NUMERIC, win_rate NUMERIC, sample_size INTEGER, geo_multiplier NUMERIC, confidence_label TEXT) AS $$
DECLARE
  v_fingerprint TEXT;
  v_stats RECORD;
  v_p NUMERIC := 0; v_w NUMERIC := 0; v_d NUMERIC := 0; v_s NUMERIC := 0; v_c NUMERIC := 0.5; v_g NUMERIC := 1.0;
  v_score NUMERIC;
BEGIN
  v_fingerprint := public.build_profit_fingerprint(p_make, p_model, p_variant_family, p_year, public.km_to_profit_band(p_km), p_fuel, p_transmission);
  
  SELECT * INTO v_stats FROM public.fingerprint_profit_stats fps
  WHERE fps.fingerprint = v_fingerprint AND (fps.region_id = p_region_id OR fps.region_id = 'ALL')
  ORDER BY CASE WHEN fps.region_id = p_region_id THEN 0 ELSE 1 END LIMIT 1;
  
  IF v_stats IS NULL THEN
    lot_score := 0; median_gp := NULL; win_rate := NULL; sample_size := 0; geo_multiplier := 0.80; confidence_label := 'No data';
    RETURN NEXT; RETURN;
  END IF;
  
  IF v_stats.region_id = p_region_id THEN v_g := 1.10; ELSE v_g := 1.05; END IF;
  IF v_stats.median_gross_profit IS NOT NULL AND p_gp_target > 0 THEN v_p := LEAST(GREATEST(v_stats.median_gross_profit / p_gp_target, 0), 1); END IF;
  v_w := COALESCE(v_stats.win_rate, 0);
  IF v_stats.median_days_to_exit IS NOT NULL AND p_exit_target_days > 0 THEN v_d := LEAST(GREATEST(1 - (v_stats.median_days_to_exit::NUMERIC / p_exit_target_days), 0), 1); END IF;
  IF v_stats.sample_size > 0 THEN v_s := LEAST(LOG(v_stats.sample_size + 1) / LOG(21), 1); END IF;
  v_c := 0.5 + 0.5 * (CASE WHEN p_variant_family IS NOT NULL THEN 0.8 ELSE 0.4 END);
  IF p_location IS NULL OR p_location = 'Unknown' THEN v_g := 0.80; END IF;
  
  v_score := 10 * (0.45 * v_p + 0.25 * v_w + 0.15 * v_d + 0.10 * v_s + 0.05 * v_c) * v_g;
  IF v_stats.sample_size < 3 THEN v_score := LEAST(v_score, 6.0); END IF;
  
  lot_score := ROUND(v_score, 1); median_gp := v_stats.median_gross_profit; win_rate := v_stats.win_rate;
  sample_size := v_stats.sample_size; geo_multiplier := v_g;
  confidence_label := CASE WHEN v_stats.sample_size >= 10 THEN 'High confidence' WHEN v_stats.sample_size >= 3 THEN 'Medium confidence' ELSE 'Low sample confidence' END;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 7. Auction profit score function
CREATE OR REPLACE FUNCTION public.calculate_auction_profit_score(
  p_auction_house TEXT, p_auction_date DATE, p_location TEXT, p_top_n INTEGER DEFAULT 10
) RETURNS TABLE(auction_score NUMERIC, eligible_count INTEGER, profit_dense_count INTEGER, avg_median_gp NUMERIC, total_sample_size INTEGER, top_fingerprints JSONB) AS $$
DECLARE
  v_lot_scores NUMERIC[] := '{}'; v_profit_dense INTEGER := 0; v_eligible INTEGER := 0;
  v_total_sample INTEGER := 0; v_total_gp NUMERIC := 0; v_gp_count INTEGER := 0; r RECORD;
BEGIN
  FOR r IN
    SELECT vl.id, vl.make, vl.model, vl.variant_family, vl.year, vl.km, vl.fuel, vl.transmission, vl.location, ls.*
    FROM public.vehicle_listings vl
    CROSS JOIN LATERAL public.calculate_lot_profit_score(
      vl.make, vl.model, vl.variant_family, vl.year, vl.km, vl.fuel, vl.transmission, 
      COALESCE(CASE WHEN vl.location ILIKE '%nsw%' OR vl.location ILIKE '%sydney%' THEN 'NSW'
        WHEN vl.location ILIKE '%qld%' OR vl.location ILIKE '%brisbane%' THEN 'QLD'
        WHEN vl.location ILIKE '%vic%' OR vl.location ILIKE '%melbourne%' THEN 'VIC'
        WHEN vl.location ILIKE '%wa%' OR vl.location ILIKE '%perth%' THEN 'WA'
        WHEN vl.location ILIKE '%sa%' OR vl.location ILIKE '%adelaide%' THEN 'SA' ELSE 'ALL' END, 'ALL'), vl.location
    ) ls
    WHERE vl.source_class = 'auction' AND vl.auction_house = p_auction_house
      AND DATE(vl.auction_datetime AT TIME ZONE 'Australia/Sydney') = p_auction_date
      AND (p_location IS NULL OR vl.location = p_location OR (p_location = 'Unknown' AND vl.location IS NULL))
      AND vl.is_dealer_grade = TRUE AND vl.excluded_reason IS NULL
      AND COALESCE(vl.lifecycle_state, '') NOT IN ('AVOID', 'SOLD', 'CLEARED')
    ORDER BY ls.lot_score DESC NULLS LAST
  LOOP
    v_eligible := v_eligible + 1;
    v_lot_scores := array_append(v_lot_scores, r.lot_score);
    IF r.lot_score >= 6.0 THEN v_profit_dense := v_profit_dense + 1; END IF;
    v_total_sample := v_total_sample + COALESCE(r.sample_size, 0);
    IF r.median_gp IS NOT NULL THEN v_total_gp := v_total_gp + r.median_gp; v_gp_count := v_gp_count + 1; END IF;
  END LOOP;
  
  IF array_length(v_lot_scores, 1) > 0 THEN
    auction_score := ROUND((SELECT AVG(s) FROM (SELECT unnest(v_lot_scores[1:LEAST(p_top_n, array_length(v_lot_scores, 1))]) s) t), 1);
  ELSE auction_score := 0; END IF;
  
  eligible_count := v_eligible; profit_dense_count := v_profit_dense;
  avg_median_gp := CASE WHEN v_gp_count > 0 THEN ROUND(v_total_gp / v_gp_count, 0) ELSE NULL END;
  total_sample_size := v_total_sample; top_fingerprints := '[]'::JSONB;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 8. Updated_at trigger
CREATE TRIGGER update_dealer_outcomes_updated_at BEFORE UPDATE ON public.dealer_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Grant permissions
GRANT EXECUTE ON FUNCTION public.build_profit_fingerprint TO authenticated;
GRANT EXECUTE ON FUNCTION public.km_to_profit_band TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_lot_profit_score TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_auction_profit_score TO authenticated;