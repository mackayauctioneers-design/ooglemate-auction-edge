-- Add failure tracking to dealer_rooftops
ALTER TABLE public.dealer_rooftops
ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS auto_disabled_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS auto_disabled_reason text;

-- Create Sydney Metro dealer group
INSERT INTO public.dealer_groups (group_name, platform_type, region_id, discovery_url, notes)
VALUES 
  ('Trivett Automotive', 'digitaldealer', 'NSW_SYDNEY_METRO', 'https://www.trivett.com.au/dealers', 'Major Sydney dealer group - multiple brands'),
  ('Peter Warren Automotive', 'digitaldealer', 'NSW_SYDNEY_METRO', 'https://www.peterwarren.com.au/dealerships', 'Large multi-franchise group - Warwick Farm area')
ON CONFLICT (group_name) DO NOTHING;

-- Get the Trivett group ID
DO $$
DECLARE
  trivett_id uuid;
  peterwarren_id uuid;
BEGIN
  SELECT id INTO trivett_id FROM public.dealer_groups WHERE group_name = 'Trivett Automotive';
  SELECT id INTO peterwarren_id FROM public.dealer_groups WHERE group_name = 'Peter Warren Automotive';

  -- Batch 1: 5 DigitalDealer Sydney Metro rooftops (multi-rooftop groups)
  INSERT INTO public.dealer_rooftops (
    dealer_slug, dealer_name, inventory_url, suburb, state, postcode, 
    region_id, parser_mode, enabled, validation_status, validation_runs,
    priority, anchor_dealer, group_id
  ) VALUES
    -- Trivett Group (3 rooftops)
    ('trivett-toyota-parramatta', 'Trivett Toyota Parramatta', 'https://www.trivetttoyota.com.au/used-cars/', 
     'Parramatta', 'NSW', '2150', 'NSW_SYDNEY_METRO', 'digitaldealer', false, 'pending', 0, 'normal', false, trivett_id),
    ('trivett-subaru-parramatta', 'Trivett Subaru Parramatta', 'https://www.trivettsubaru.com.au/used-cars/', 
     'Parramatta', 'NSW', '2150', 'NSW_SYDNEY_METRO', 'digitaldealer', false, 'pending', 0, 'normal', false, trivett_id),
    ('trivett-mazda-parramatta', 'Trivett Mazda Parramatta', 'https://www.trivettmazda.com.au/used-cars/', 
     'Parramatta', 'NSW', '2150', 'NSW_SYDNEY_METRO', 'digitaldealer', false, 'pending', 0, 'normal', false, trivett_id),
    
    -- Peter Warren Group (2 rooftops)
    ('peter-warren-toyota', 'Peter Warren Toyota', 'https://www.peterwarrentoyota.com.au/used-cars/', 
     'Warwick Farm', 'NSW', '2170', 'NSW_SYDNEY_METRO', 'digitaldealer', false, 'pending', 0, 'normal', false, peterwarren_id),
    ('peter-warren-ford', 'Peter Warren Ford', 'https://www.peterwarrenford.com.au/stock/', 
     'Warwick Farm', 'NSW', '2170', 'NSW_SYDNEY_METRO', 'digitaldealer', false, 'pending', 0, 'normal', false, peterwarren_id)
  ON CONFLICT (dealer_slug) DO NOTHING;
END $$;