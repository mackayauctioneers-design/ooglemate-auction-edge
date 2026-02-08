
-- 1. Add buy_price and profit_pct to vehicle_sales_truth
ALTER TABLE public.vehicle_sales_truth
  ADD COLUMN IF NOT EXISTS buy_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS profit_pct numeric(8,4);

-- 2. Add profit/loss metrics to sales_target_candidates
ALTER TABLE public.sales_target_candidates
  ADD COLUMN IF NOT EXISTS median_profit_pct numeric(8,4),
  ADD COLUMN IF NOT EXISTS loss_rate numeric(5,2),
  ADD COLUMN IF NOT EXISTS worst_case_profit_pct numeric(8,4),
  ADD COLUMN IF NOT EXISTS median_profit_per_day numeric(10,2);

-- 3. Backfill profit_pct where both prices exist
UPDATE public.vehicle_sales_truth
SET profit_pct = ROUND((sale_price - buy_price) / NULLIF(buy_price, 0), 4)
WHERE buy_price IS NOT NULL
  AND buy_price > 0
  AND sale_price IS NOT NULL
  AND profit_pct IS NULL;

-- 4. Create trigger to auto-compute profit_pct on insert/update
CREATE OR REPLACE FUNCTION public.compute_profit_pct()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.buy_price IS NOT NULL AND NEW.buy_price > 0 AND NEW.sale_price IS NOT NULL THEN
    NEW.profit_pct := ROUND((NEW.sale_price - NEW.buy_price) / NEW.buy_price, 4);
  ELSE
    NEW.profit_pct := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_compute_profit_pct ON public.vehicle_sales_truth;
CREATE TRIGGER trg_compute_profit_pct
  BEFORE INSERT OR UPDATE OF sale_price, buy_price
  ON public.vehicle_sales_truth
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_profit_pct();
