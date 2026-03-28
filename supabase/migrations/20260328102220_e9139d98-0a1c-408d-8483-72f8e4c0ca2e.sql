-- Add the scoring columns from canonical schema evolution
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS expected_gross_margin numeric,
  ADD COLUMN IF NOT EXISTS days_to_sell_est      numeric,
  ADD COLUMN IF NOT EXISTS risk_multiplier       numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dealer_exposure       jsonb;

-- profit_per_day as a generated column
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS profit_per_day numeric
    GENERATED ALWAYS AS (
      CASE WHEN days_to_sell_est > 0 AND risk_multiplier > 0
           THEN expected_gross_margin / (days_to_sell_est * risk_multiplier)
           ELSE NULL END
    ) STORED;