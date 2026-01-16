
-- Create the trigger function to auto-create hunts from sales
CREATE OR REPLACE FUNCTION public.auto_create_hunt_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create hunt for sales with sufficient data
  IF NEW.year IS NOT NULL AND NEW.make IS NOT NULL AND NEW.model IS NOT NULL AND NEW.sell_price IS NOT NULL THEN
    INSERT INTO public.sale_hunts (
      dealer_id,
      year,
      make,
      model,
      variant_family,
      km,
      proven_exit_value,
      sale_date,
      state,
      status
    ) VALUES (
      NEW.dealer_id,
      NEW.year,
      NEW.make,
      NEW.model,
      COALESCE(NEW.variant_raw, NULL),
      NEW.km,
      COALESCE(NEW.sell_price, NEW.buy_price),
      NEW.sold_date,
      NEW.state,
      'active'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger on dealer_sales
DROP TRIGGER IF EXISTS trg_auto_create_hunt_on_sale ON public.dealer_sales;
CREATE TRIGGER trg_auto_create_hunt_on_sale
  AFTER INSERT ON public.dealer_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_hunt_on_sale();
