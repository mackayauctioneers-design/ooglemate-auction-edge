-- Reinstate FK on user_roles to enforce no orphan records
-- First clean any orphans
DELETE FROM public.user_roles 
WHERE user_id NOT IN (SELECT id FROM auth.users);

-- Add the FK constraint
ALTER TABLE public.user_roles 
ADD CONSTRAINT user_roles_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;