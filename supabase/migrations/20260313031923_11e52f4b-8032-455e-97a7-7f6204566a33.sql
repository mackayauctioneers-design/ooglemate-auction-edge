
ALTER TABLE public.dealer_fingerprints
  ADD COLUMN IF NOT EXISTS fingerprint_priority text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS fingerprint_type text NOT NULL DEFAULT 'dealer_trade',
  ADD COLUMN IF NOT EXISTS profit_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recency_weight numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS alert_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS avg_profit numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_days_to_sell integer DEFAULT 0;
