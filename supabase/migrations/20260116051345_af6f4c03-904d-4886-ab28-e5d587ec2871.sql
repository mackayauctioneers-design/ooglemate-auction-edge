
-- Fix the trigger function to match actual sale_hunts columns
CREATE OR REPLACE FUNCTION public.auto_create_hunt_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create hunt for sales with sufficient data
  IF NEW.year IS NOT NULL AND NEW.make IS NOT NULL AND NEW.model IS NOT NULL AND NEW.sell_price IS NOT NULL THEN
    INSERT INTO public.sale_hunts (
      dealer_id,
      source_sale_id,
      year,
      make,
      model,
      variant_family,
      km,
      proven_exit_value,
      proven_exit_method,
      states,
      status
    ) VALUES (
      NEW.dealer_id,
      NEW.id,
      NEW.year,
      NEW.make,
      NEW.model,
      NEW.variant_raw,
      NEW.km,
      COALESCE(NEW.sell_price, NEW.buy_price),
      'sale',
      CASE WHEN NEW.state IS NOT NULL THEN ARRAY[NEW.state] ELSE NULL END,
      'active'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
