-- Make dealer_profiles.user_id nullable (legacy field, not used for auth)
ALTER TABLE public.dealer_profiles ALTER COLUMN user_id DROP NOT NULL;