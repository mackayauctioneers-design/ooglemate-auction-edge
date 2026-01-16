-- =============================================
-- Auto-create hunt from sale trigger
-- =============================================
CREATE OR REPLACE FUNCTION public.auto_create_hunt_from_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only create hunt if dealer_id exists
  IF NEW.dealer_id IS NOT NULL THEN
    INSERT INTO sale_hunts (
      dealer_id,
      source_sale_id,
      year,
      make,
      model,
      variant_family,
      km,
      km_band,
      expires_at
    ) VALUES (
      NEW.dealer_id,
      NEW.id,
      NEW.year,
      NEW.make,
      NEW.model,
      NEW.fingerprint,
      NEW.km,
      km_to_band(NEW.km),
      now() + interval '30 days'
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Attach trigger to dealer_sales (drop first if exists)
DROP TRIGGER IF EXISTS trg_auto_create_hunt_on_sale ON public.dealer_sales;

CREATE TRIGGER trg_auto_create_hunt_on_sale
  AFTER INSERT ON public.dealer_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_hunt_from_sale();