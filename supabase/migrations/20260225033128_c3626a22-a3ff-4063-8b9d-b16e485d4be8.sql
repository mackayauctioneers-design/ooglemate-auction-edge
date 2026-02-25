
-- Add retail median columns to operator_opportunities
ALTER TABLE public.operator_opportunities
  ADD COLUMN IF NOT EXISTS retail_median INT,
  ADD COLUMN IF NOT EXISTS retail_median_confidence TEXT,
  ADD COLUMN IF NOT EXISTS retail_median_sample INT,
  ADD COLUMN IF NOT EXISTS retail_median_p25 INT,
  ADD COLUMN IF NOT EXISTS retail_median_p75 INT,
  ADD COLUMN IF NOT EXISTS retail_vs_ask_pct NUMERIC;
