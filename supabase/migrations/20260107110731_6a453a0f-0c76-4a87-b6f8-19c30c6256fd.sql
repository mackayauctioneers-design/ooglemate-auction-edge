-- Remove FK constraint on user_roles.user_id to allow seeding test profiles
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;

-- Add comment explaining the design decision
COMMENT ON COLUMN public.user_roles.user_id IS 'UUID of the user - not FK constrained to allow pre-seeding roles before user signup';