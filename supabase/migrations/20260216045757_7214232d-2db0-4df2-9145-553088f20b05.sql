
INSERT INTO public.dealer_traps (trap_slug, dealer_name, inventory_url, region_id, enabled, trap_mode, parser_mode, validation_status, consecutive_failures)
VALUES 
  ('pickles-buy-now', 'Pickles Buy Now', 'https://www.pickles.com.au/buy-now-used-cars', 'national', true, 'auto', 'auto', 'pending', 0),
  ('toyota-australia-used', 'Toyota Australia Used Vehicles', 'https://www.toyota.com.au/used-vehicles', 'national', true, 'auto', 'auto', 'pending', 0),
  ('easyauto123-national', 'EasyAuto123 National', 'https://www.easyauto123.com.au/used-cars', 'national', true, 'auto', 'auto', 'pending', 0)
ON CONFLICT (trap_slug) DO UPDATE SET enabled = true, trap_mode = 'auto', consecutive_failures = 0;
