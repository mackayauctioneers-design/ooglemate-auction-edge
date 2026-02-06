
-- ============================================================
-- PHASE 1: Sales Truth + Fingerprints v1
-- ============================================================

-- Step 1: vehicle_sales_truth — dealer-specific, outcome-based
CREATE TABLE IF NOT EXISTS public.vehicle_sales_truth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  sold_at date NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  variant text NULL,
  year int NULL,
  km int NULL,
  sale_price int NULL,
  source text NOT NULL DEFAULT 'our_sale',
  confidence text NOT NULL DEFAULT 'high',
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Validation trigger instead of CHECK constraint for confidence
CREATE OR REPLACE FUNCTION public.validate_vehicle_sales_truth_confidence()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.confidence NOT IN ('high', 'medium', 'low') THEN
    RAISE EXCEPTION 'confidence must be one of: high, medium, low';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_vehicle_sales_truth_confidence
  BEFORE INSERT OR UPDATE ON public.vehicle_sales_truth
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_vehicle_sales_truth_confidence();

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS vehicle_sales_truth_account_mm_idx
  ON public.vehicle_sales_truth(account_id, make, model);

CREATE INDEX IF NOT EXISTS vehicle_sales_truth_account_date_idx
  ON public.vehicle_sales_truth(account_id, sold_at DESC);

-- RLS
ALTER TABLE public.vehicle_sales_truth ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on vehicle_sales_truth"
  ON public.vehicle_sales_truth
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Step 2: sales_fingerprints_v1 — materialized view
-- Fingerprint key = account_id + make + model (variant in v2)
CREATE MATERIALIZED VIEW IF NOT EXISTS public.sales_fingerprints_v1 AS
SELECT
  account_id,
  upper(make) AS make,
  upper(model) AS model,
  count(*) AS sales_count,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY km) AS km_median,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY km) AS km_p25,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY km) AS km_p75,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price) AS price_median,
  max(sold_at) AS last_sold_at
FROM public.vehicle_sales_truth
WHERE confidence IN ('high', 'medium')
GROUP BY account_id, upper(make), upper(model);

-- Unique index required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS sales_fingerprints_v1_pk
  ON public.sales_fingerprints_v1(account_id, make, model);

-- ============================================================
-- PHASE 2: Trigger Engine v1
-- ============================================================

-- Step 3: matched_opportunities_v1
CREATE TABLE IF NOT EXISTS public.matched_opportunities_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,

  listing_norm_id uuid NOT NULL,
  raw_id uuid NULL,
  url_canonical text NOT NULL,

  make text NULL,
  model text NULL,
  year int NULL,
  km int NULL,
  asking_price int NULL,

  fingerprint_make text NOT NULL,
  fingerprint_model text NOT NULL,
  sales_count int NOT NULL,
  km_band text NOT NULL,
  price_band text NOT NULL,
  match_score int NOT NULL,
  reasons jsonb NOT NULL DEFAULT '{}'::jsonb,

  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (account_id, listing_norm_id)
);

-- Validation trigger for status
CREATE OR REPLACE FUNCTION public.validate_matched_opportunities_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status NOT IN ('open', 'dismissed', 'actioned') THEN
    RAISE EXCEPTION 'status must be one of: open, dismissed, actioned';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_matched_opportunities_status
  BEFORE INSERT OR UPDATE ON public.matched_opportunities_v1
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_matched_opportunities_status();

-- Validation trigger for km_band
CREATE OR REPLACE FUNCTION public.validate_matched_opportunities_km_band()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.km_band NOT IN ('inside', 'near', 'outside', 'unknown') THEN
    RAISE EXCEPTION 'km_band must be one of: inside, near, outside, unknown';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_matched_opportunities_km_band
  BEFORE INSERT OR UPDATE ON public.matched_opportunities_v1
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_matched_opportunities_km_band();

-- Validation trigger for price_band
CREATE OR REPLACE FUNCTION public.validate_matched_opportunities_price_band()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.price_band NOT IN ('below', 'near', 'above', 'unknown') THEN
    RAISE EXCEPTION 'price_band must be one of: below, near, above, unknown';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_matched_opportunities_price_band
  BEFORE INSERT OR UPDATE ON public.matched_opportunities_v1
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_matched_opportunities_price_band();

-- Index for fast inbox queries
CREATE INDEX IF NOT EXISTS matched_opps_account_score_idx
  ON public.matched_opportunities_v1(account_id, match_score DESC, created_at DESC);

-- RLS
ALTER TABLE public.matched_opportunities_v1 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on matched_opportunities_v1"
  ON public.matched_opportunities_v1
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Helper: Function to refresh fingerprints (called by edge fn)
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_sales_fingerprints()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.sales_fingerprints_v1;
END;
$$ LANGUAGE plpgsql SET search_path = public;
