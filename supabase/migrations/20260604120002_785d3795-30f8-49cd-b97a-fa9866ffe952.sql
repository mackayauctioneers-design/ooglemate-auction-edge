
ALTER TABLE public.dealer_live_opportunities ALTER COLUMN dealer_id DROP NOT NULL;

-- Backfill account_id on existing dealer_profiles
UPDATE public.dealer_profiles SET account_id = 'ce743f49-a57b-451f-a758-59827168ce34'
  WHERE id = '88ece694-c937-474f-9478-3754b55775c2' AND account_id IS NULL;

UPDATE public.dealer_profiles SET account_id = '887f05d7-ddb5-46c4-a168-719c22a27360'
  WHERE id = '0426e8e3-2580-40e8-ac70-88b3a7a476bb' AND account_id IS NULL;

-- Create dealer_profile for Car Boutique
INSERT INTO public.dealer_profiles (dealer_name, account_id, region_id)
SELECT 'Car Boutique', 'af58cc21-9657-49c2-97ed-74f82d5ace65', 'UNKNOWN'
WHERE NOT EXISTS (
  SELECT 1 FROM public.dealer_profiles WHERE account_id = 'af58cc21-9657-49c2-97ed-74f82d5ace65'
);
