CREATE OR REPLACE FUNCTION public.validate_dealer_sales_truth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::int;
BEGIN
  -- Mandatory fields
  IF NEW.dealer_id IS NULL THEN
    RAISE EXCEPTION 'dealer_id is required';
  END IF;
  IF NEW.make IS NULL OR length(trim(NEW.make)) = 0 THEN
    RAISE EXCEPTION 'make is required';
  END IF;
  IF NEW.model IS NULL OR length(trim(NEW.model)) = 0 THEN
    RAISE EXCEPTION 'model is required';
  END IF;

  -- Year sanity
  IF NEW.year IS NOT NULL AND (NEW.year < 1980 OR NEW.year > current_year + 1) THEN
    RAISE EXCEPTION 'year must be between 1980 and %', current_year + 1;
  END IF;

  -- KM sanity
  IF NEW.km IS NOT NULL AND NEW.km < 0 THEN
    RAISE EXCEPTION 'km cannot be negative';
  END IF;
  IF NEW.km IS NOT NULL AND NEW.km > 2000000 THEN
    RAISE EXCEPTION 'km exceeds reasonable maximum (2,000,000)';
  END IF;

  -- Price sanity
  IF NEW.listed_price IS NOT NULL AND NEW.listed_price < 0 THEN
    RAISE EXCEPTION 'listed_price cannot be negative';
  END IF;
  IF NEW.listed_price IS NOT NULL AND NEW.listed_price > 5000000 THEN
    RAISE EXCEPTION 'listed_price exceeds reasonable maximum ($5,000,000)';
  END IF;

  -- Days online sanity
  IF NEW.days_online IS NOT NULL AND NEW.days_online < 0 THEN
    RAISE EXCEPTION 'days_online cannot be negative';
  END IF;
  IF NEW.days_online IS NOT NULL AND NEW.days_online > 3650 THEN
    RAISE EXCEPTION 'days_online exceeds reasonable maximum (3650)';
  END IF;

  -- Normalise text fields
  NEW.make := upper(trim(NEW.make));
  NEW.model := upper(trim(NEW.model));
  IF NEW.variant IS NOT NULL THEN
    NEW.variant := trim(NEW.variant);
  END IF;
  IF NEW.colour IS NOT NULL THEN
    NEW.colour := initcap(trim(NEW.colour));
  END IF;
  IF NEW.vin IS NOT NULL THEN
    NEW.vin := upper(trim(NEW.vin));
  END IF;
  IF NEW.stock_number IS NOT NULL THEN
    NEW.stock_number := upper(trim(NEW.stock_number));
  END IF;

  RETURN NEW;
END;
$$;

-- Attach guard-rail trigger
DROP TRIGGER IF EXISTS trg_dealer_sales_truth_guard ON public.dealer_sales_truth;
CREATE TRIGGER trg_dealer_sales_truth_guard
  BEFORE INSERT OR UPDATE ON public.dealer_sales_truth
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_dealer_sales_truth();

-- Ensure service_role can operate on the table
GRANT ALL ON public.dealer_sales_truth TO service_role;