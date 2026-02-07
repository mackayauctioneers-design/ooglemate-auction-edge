
-- Fix SECURITY DEFINER on the 3 new views
ALTER VIEW public.sales_clearance_velocity SET (security_invoker = on);
ALTER VIEW public.sales_volume_trends SET (security_invoker = on);
ALTER VIEW public.sales_variation_performance SET (security_invoker = on);
