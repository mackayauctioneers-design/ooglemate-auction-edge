
-- =============================================
-- Sales Fingerprints v1.5: Identity-enriched fingerprints
-- =============================================

-- 1. Add identity columns to vehicle_sales_truth
ALTER TABLE public.vehicle_sales_truth
  ADD COLUMN IF NOT EXISTS body_type text NULL,
  ADD COLUMN IF NOT EXISTS fuel_type text NULL,
  ADD COLUMN IF NOT EXISTS transmission text NULL,
  ADD COLUMN IF NOT EXISTS drive_type text NULL;

-- 2. Add identity columns to matched_opportunities_v1
ALTER TABLE public.matched_opportunities_v1
  ADD COLUMN IF NOT EXISTS transmission text NULL,
  ADD COLUMN IF NOT EXISTS body_type text NULL,
  ADD COLUMN IF NOT EXISTS fuel_type text NULL,
  ADD COLUMN IF NOT EXISTS drive_type text NULL,
  ADD COLUMN IF NOT EXISTS source_searched text NULL,
  ADD COLUMN IF NOT EXISTS source_match_count int NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_search_at timestamptz NULL;

-- 3. Drop and recreate the materialized view with identity field aggregation
DROP MATERIALIZED VIEW IF EXISTS public.sales_fingerprints_v1;

CREATE MATERIALIZED VIEW public.sales_fingerprints_v1 AS
SELECT
  account_id,
  upper(make) AS make,
  upper(model) AS model,
  count(*) AS sales_count,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY km) AS km_median,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY km) AS km_p25,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY km) AS km_p75,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price) AS price_median,
  max(sold_at) AS last_sold_at,
  -- Identity field aggregation (mode = most common value)
  mode() WITHIN GROUP (ORDER BY lower(transmission)) AS dominant_transmission,
  mode() WITHIN GROUP (ORDER BY lower(body_type)) AS dominant_body_type,
  mode() WITHIN GROUP (ORDER BY lower(fuel_type)) AS dominant_fuel_type,
  mode() WITHIN GROUP (ORDER BY lower(drive_type)) AS dominant_drive_type,
  -- Distribution counts for transparency
  count(transmission) FILTER (WHERE transmission IS NOT NULL) AS transmission_count,
  count(body_type) FILTER (WHERE body_type IS NOT NULL) AS body_type_count,
  count(fuel_type) FILTER (WHERE fuel_type IS NOT NULL) AS fuel_type_count,
  count(drive_type) FILTER (WHERE drive_type IS NOT NULL) AS drive_type_count
FROM public.vehicle_sales_truth
WHERE confidence IN ('high', 'medium')
GROUP BY account_id, upper(make), upper(model);

CREATE UNIQUE INDEX IF NOT EXISTS sales_fingerprints_v1_pk
  ON public.sales_fingerprints_v1(account_id, make, model);

-- 4. Recreate the refresh function (needed after view recreation)
CREATE OR REPLACE FUNCTION public.refresh_sales_fingerprints()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.sales_fingerprints_v1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Create variant_aliases table
CREATE TABLE IF NOT EXISTS public.variant_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_variant text NOT NULL,
  alias text NOT NULL,
  make text NULL,
  model text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(canonical_variant, alias)
);

CREATE INDEX IF NOT EXISTS variant_aliases_alias_idx ON public.variant_aliases(upper(alias));
CREATE INDEX IF NOT EXISTS variant_aliases_canonical_idx ON public.variant_aliases(upper(canonical_variant));

-- RLS for variant_aliases (read-only for authenticated, admin-managed)
ALTER TABLE public.variant_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Variant aliases are readable by authenticated users"
  ON public.variant_aliases FOR SELECT
  TO authenticated
  USING (true);

-- Seed some common aliases
INSERT INTO public.variant_aliases (canonical_variant, alias, make, model) VALUES
  ('N LINE', 'N-Line', 'HYUNDAI', NULL),
  ('N LINE', 'NLine', 'HYUNDAI', NULL),
  ('N LINE', 'N Line', 'HYUNDAI', NULL),
  ('SR5', 'SR-5', 'TOYOTA', 'HILUX'),
  ('SR5', 'SR 5', 'TOYOTA', 'HILUX'),
  ('GX', 'GX', 'TOYOTA', 'LANDCRUISER'),
  ('VX', 'VX', 'TOYOTA', 'LANDCRUISER'),
  ('SAHARA', 'Sahara', 'TOYOTA', 'LANDCRUISER'),
  ('GXL', 'GXL', 'TOYOTA', 'PRADO'),
  ('KAKADU', 'Kakadu', 'TOYOTA', 'PRADO'),
  ('XLS', 'XLS', 'FORD', 'RANGER'),
  ('WILDTRAK', 'Wildtrak', 'FORD', 'RANGER'),
  ('WILDTRAK', 'Wild Trak', 'FORD', 'RANGER'),
  ('SPORT', 'Sports Pack', NULL, NULL),
  ('RS', 'RS', NULL, NULL)
ON CONFLICT (canonical_variant, alias) DO NOTHING;

-- 6. Update the dealer_sales trigger to include identity fields
CREATE OR REPLACE FUNCTION public.trg_dealer_sales_to_truth()
RETURNS TRIGGER AS $$
DECLARE
  v_account_id uuid;
BEGIN
  -- Resolve account_id from dealer_profiles
  SELECT dp.account_id INTO v_account_id
  FROM public.dealer_profiles dp
  WHERE dp.id = NEW.dealer_id
     OR dp.dealer_name = NEW.dealer_name
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE WARNING '[trg_dealer_sales_to_truth] No account_id found for dealer_id=%, skipping truth insert', NEW.dealer_id;
    RETURN NEW;
  END IF;

  INSERT INTO public.vehicle_sales_truth (
    account_id, sold_at, make, model, variant, year, km, sale_price,
    source, confidence, notes, body_type, fuel_type, transmission, drive_type
  ) VALUES (
    v_account_id,
    NEW.sold_date::date,
    upper(NEW.make),
    upper(NEW.model),
    NEW.variant_raw,
    NEW.year,
    NEW.km,
    COALESCE(NEW.sell_price, NEW.buy_price),
    COALESCE(NEW.source_channel, 'dealer_sale'),
    CASE
      WHEN NEW.fingerprint_confidence >= 0.8 THEN 'high'
      WHEN NEW.fingerprint_confidence >= 0.5 THEN 'medium'
      ELSE 'high'
    END,
    NULL,
    NULL, -- body_type not in dealer_sales yet
    NULL, -- fuel_type not in dealer_sales yet
    NULL, -- transmission not in dealer_sales yet
    NULL  -- drive_type not in dealer_sales yet
  )
  ON CONFLICT DO NOTHING;

  -- Mark dirty for fingerprint refresh
  INSERT INTO public.fingerprint_refresh_pending (account_id, dirty_since)
  VALUES (v_account_id, now())
  ON CONFLICT (account_id) DO UPDATE SET dirty_since = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
