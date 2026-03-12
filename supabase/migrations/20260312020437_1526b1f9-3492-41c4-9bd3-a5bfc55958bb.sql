ALTER TABLE public.dealer_profiles
  ADD COLUMN IF NOT EXISTS dealer_website text,
  ADD COLUMN IF NOT EXISTS dealer_email text,
  ADD COLUMN IF NOT EXISTS dealer_phone text;