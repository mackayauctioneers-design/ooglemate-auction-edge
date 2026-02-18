
-- ═══════════════════════════════════════════════════════════════
-- PLATFORM HARDENING: Add platform_class to vehicle_listings
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Add the column (nullable initially for backfill)
ALTER TABLE public.vehicle_listings
ADD COLUMN IF NOT EXISTS platform_class TEXT;

-- Step 2: Create index for platform-based queries
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_platform_class 
ON public.vehicle_listings (platform_class);

-- Step 3: Create the canonical derive_platform function in SQL
-- This is the single source of truth — no more deriving in TypeScript alone
CREATE OR REPLACE FUNCTION public.derive_platform_class(p_make TEXT, p_model TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  m TEXT := UPPER(TRIM(p_make));
  md TEXT := UPPER(TRIM(p_model));
BEGIN
  -- Toyota platform segmentation
  IF m = 'TOYOTA' THEN
    IF md LIKE '%PRADO%' OR md = 'LANDCRUISER PRADO' THEN RETURN 'PRADO'; END IF;
    IF md LIKE '%LANDCRUISER%' OR md LIKE '%LAND CRUISER%' THEN
      RETURN 'LANDCRUISER';
    END IF;
    RETURN m || ':' || md;
  END IF;
  
  -- Default: MAKE:MODEL
  RETURN m || ':' || md;
END;
$$;

-- Step 4: Backfill all existing listings
UPDATE public.vehicle_listings
SET platform_class = public.derive_platform_class(make, model)
WHERE platform_class IS NULL;

-- Step 5: Add NOT NULL constraint on vehicle_sales_truth
ALTER TABLE public.vehicle_sales_truth
ALTER COLUMN platform_class SET NOT NULL;

-- Step 6: Add a trigger to auto-derive platform_class on insert/update
CREATE OR REPLACE FUNCTION public.auto_derive_platform_class()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.platform_class IS NULL OR NEW.platform_class = '' THEN
    NEW.platform_class := public.derive_platform_class(NEW.make, NEW.model);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vehicle_listings_platform_class
BEFORE INSERT OR UPDATE ON public.vehicle_listings
FOR EACH ROW
EXECUTE FUNCTION public.auto_derive_platform_class();
