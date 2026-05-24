
ALTER TABLE public.active_mandates
  ADD COLUMN IF NOT EXISTS lane text DEFAULT 'core' CHECK (lane IN ('core','shortage')),
  ADD COLUMN IF NOT EXISTS shortage_year_min int,
  ADD COLUMN IF NOT EXISTS shortage_year_max int,
  ADD COLUMN IF NOT EXISTS shortage_km_max int;

ALTER TABLE public.mandate_feed_items
  ADD COLUMN IF NOT EXISTS final_score numeric,
  ADD COLUMN IF NOT EXISTS lane text,
  ADD COLUMN IF NOT EXISTS alert_tier text CHECK (alert_tier IN ('A+','A','Watch','Reject')),
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS dealer_shortage_weight numeric,
  ADD COLUMN IF NOT EXISTS model_fit_score numeric,
  ADD COLUMN IF NOT EXISTS price_opportunity_score numeric,
  ADD COLUMN IF NOT EXISTS age_km_fit_score numeric,
  ADD COLUMN IF NOT EXISTS sales_confidence_score numeric;

CREATE INDEX IF NOT EXISTS idx_mfi_dealer_created
  ON public.mandate_feed_items (dealer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mfi_dealer_score
  ON public.mandate_feed_items (dealer_id, final_score DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_am_dealer_active
  ON public.active_mandates (dealer_id, is_active);
