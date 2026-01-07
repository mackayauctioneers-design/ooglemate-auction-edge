-- Remove FK constraint on dealer_profiles.user_id to allow seeding without auth users
-- The user_id will still be validated at application level when linking
ALTER TABLE public.dealer_profiles DROP CONSTRAINT IF EXISTS dealer_profiles_user_id_fkey;

-- Add comment explaining the design decision
COMMENT ON COLUMN public.dealer_profiles.user_id IS 'UUID of the user - not FK constrained to allow pre-seeding dealer profiles before user signup';