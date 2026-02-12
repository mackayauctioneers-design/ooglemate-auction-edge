
-- Fix the new view to use security invoker
ALTER VIEW public.fingerprint_opportunities SET (security_invoker = on);
