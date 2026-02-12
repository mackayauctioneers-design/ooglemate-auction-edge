
-- Fix the new view to use security invoker
ALTER VIEW public.v_sales_truth_normalized SET (security_invoker = on);
