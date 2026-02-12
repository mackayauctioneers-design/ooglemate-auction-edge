
-- 1. Normalized sales truth view
CREATE OR REPLACE VIEW public.v_sales_truth_normalized AS
SELECT
  ds.dealer_id AS dealer_key,
  COALESCE(ds.dealer_name, 'Unknown') AS dealer_name,
  ds.year,
  INITCAP(LOWER(TRIM(ds.make))) AS make,
  INITCAP(LOWER(TRIM(ds.model))) AS model,
  INITCAP(LOWER(TRIM(COALESCE(ds.variant_raw, '')))) AS badge,
  ds.km AS kms,
  ds.buy_price,
  ds.sell_price AS sold_price,
  COALESCE(ds.gross_profit, CASE WHEN ds.buy_price IS NOT NULL AND ds.sell_price IS NOT NULL THEN ds.sell_price - ds.buy_price ELSE NULL END) AS profit,
  ds.sold_date::date AS sale_date
FROM dealer_sales ds;

-- 2. Dealer liquidity profiles table
CREATE TABLE public.dealer_liquidity_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dealer_key UUID NOT NULL,
  dealer_name TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  badge TEXT,
  year_center INTEGER NOT NULL,
  year_min INTEGER NOT NULL,
  year_max INTEGER NOT NULL,
  km_min INTEGER NOT NULL DEFAULT 0,
  km_max INTEGER NOT NULL DEFAULT 999999,
  km_band TEXT NOT NULL DEFAULT '0-999999',
  flip_count INTEGER NOT NULL DEFAULT 0,
  median_sell_price NUMERIC,
  median_profit NUMERIC,
  p75_profit NUMERIC,
  last_sale_date DATE,
  recency_days INTEGER,
  confidence_tier TEXT NOT NULL DEFAULT 'LOW',
  min_viable_profit_floor NUMERIC NOT NULL DEFAULT 3000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dealer_liquidity_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON public.dealer_liquidity_profiles
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow service role all" ON public.dealer_liquidity_profiles
  FOR ALL USING (auth.role() = 'service_role');

-- 3. Add new columns to pickles_buy_now_listings
ALTER TABLE public.pickles_buy_now_listings
  ADD COLUMN IF NOT EXISTS matched_profile_id UUID REFERENCES public.dealer_liquidity_profiles(id),
  ADD COLUMN IF NOT EXISTS match_tier TEXT,
  ADD COLUMN IF NOT EXISTS match_expected_resale NUMERIC,
  ADD COLUMN IF NOT EXISTS match_expected_profit NUMERIC,
  ADD COLUMN IF NOT EXISTS match_dealer_key TEXT;
