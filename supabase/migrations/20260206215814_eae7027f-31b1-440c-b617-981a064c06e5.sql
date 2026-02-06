
-- ============================================================
-- Wire all sales paths into vehicle_sales_truth
-- ============================================================

-- 1. Add account_id to dealer_profiles for mapping
ALTER TABLE public.dealer_profiles 
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id);

-- Set Mackay Traders mapping
UPDATE public.dealer_profiles 
  SET account_id = 'd24da4ea-f500-47fd-9b66-d2c9aa2d3f51'
  WHERE id = 'ffdbbf25-1d9c-4402-ba49-fc4da4b77cb6';

-- 2. Fingerprint refresh tracking table
CREATE TABLE IF NOT EXISTS public.fingerprint_refresh_pending (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id),
  dirty_since timestamptz NOT NULL DEFAULT now(),
  refreshed_at timestamptz NULL
);

-- 3. Trigger: dealer_sales → vehicle_sales_truth
-- This fires when LogSalePage inserts a sale
CREATE OR REPLACE FUNCTION public.trg_dealer_sales_to_truth()
RETURNS TRIGGER AS $$
DECLARE
  v_account_id uuid;
BEGIN
  -- Resolve account_id from dealer_profiles
  SELECT dp.account_id INTO v_account_id
  FROM public.dealer_profiles dp
  WHERE dp.id::text = NEW.dealer_id;

  -- Skip if no account mapping
  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.vehicle_sales_truth (
    account_id, sold_at, make, model, variant, year, km, sale_price, source, confidence
  ) VALUES (
    v_account_id,
    NEW.sold_date,
    UPPER(NEW.make),
    UPPER(NEW.model),
    NEW.variant_raw,
    NEW.year,
    NEW.km,
    COALESCE(NEW.sell_price::int, NULL),
    'our_sale',
    'high'
  )
  ON CONFLICT DO NOTHING;

  -- Mark fingerprints as dirty
  INSERT INTO public.fingerprint_refresh_pending (account_id, dirty_since)
  VALUES (v_account_id, now())
  ON CONFLICT (account_id) DO UPDATE SET dirty_since = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_dealer_sales_to_truth ON public.dealer_sales;
CREATE TRIGGER trg_dealer_sales_to_truth
  AFTER INSERT ON public.dealer_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_dealer_sales_to_truth();

-- 4. Trigger: sales_log_stage → vehicle_sales_truth
-- This fires when SalesUploadPage promotes CSV rows
CREATE OR REPLACE FUNCTION public.trg_sales_stage_to_truth()
RETURNS TRIGGER AS $$
BEGIN
  -- sales_log_stage already has account_id
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.vehicle_sales_truth (
    account_id, sold_at, make, model, variant, year, km, sale_price, source, confidence
  ) VALUES (
    NEW.account_id,
    NEW.sale_date,
    UPPER(NEW.make),
    UPPER(NEW.model),
    NEW.variant,
    NEW.year,
    NEW.km,
    COALESCE(NEW.sale_price::int, NULL),
    'dealer_upload',
    'medium'
  )
  ON CONFLICT DO NOTHING;

  -- Mark fingerprints as dirty
  INSERT INTO public.fingerprint_refresh_pending (account_id, dirty_since)
  VALUES (NEW.account_id, now())
  ON CONFLICT (account_id) DO UPDATE SET dirty_since = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sales_stage_to_truth ON public.sales_log_stage;
CREATE TRIGGER trg_sales_stage_to_truth
  AFTER INSERT ON public.sales_log_stage
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sales_stage_to_truth();

-- 5. Backfill: Copy existing dealer_sales into vehicle_sales_truth
INSERT INTO public.vehicle_sales_truth (account_id, sold_at, make, model, variant, year, km, sale_price, source, confidence)
SELECT 
  dp.account_id,
  ds.sold_date,
  UPPER(ds.make),
  UPPER(ds.model),
  ds.variant_raw,
  ds.year,
  ds.km,
  ds.sell_price::int,
  'our_sale',
  'high'
FROM public.dealer_sales ds
JOIN public.dealer_profiles dp ON dp.id::text = ds.dealer_id
WHERE dp.account_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 6. Backfill: Copy existing sales_log_stage into vehicle_sales_truth
INSERT INTO public.vehicle_sales_truth (account_id, sold_at, make, model, variant, year, km, sale_price, source, confidence)
SELECT 
  sls.account_id,
  sls.sale_date,
  UPPER(sls.make),
  UPPER(sls.model),
  sls.variant,
  sls.year,
  sls.km,
  sls.sale_price::int,
  'dealer_upload',
  'medium'
FROM public.sales_log_stage sls
WHERE sls.account_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 7. Mark all existing accounts as dirty so first match run refreshes
INSERT INTO public.fingerprint_refresh_pending (account_id, dirty_since)
SELECT id, now() FROM public.accounts
ON CONFLICT (account_id) DO UPDATE SET dirty_since = now();
