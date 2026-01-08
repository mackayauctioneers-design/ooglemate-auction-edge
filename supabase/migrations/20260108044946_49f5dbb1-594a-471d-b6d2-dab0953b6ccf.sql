-- Fix SECURITY DEFINER views by recreating with SECURITY INVOKER
DROP VIEW IF EXISTS public.dealer_rooftops;
DROP VIEW IF EXISTS public.dealer_crawl_runs;
DROP VIEW IF EXISTS public.dealer_crawl_jobs;

CREATE VIEW public.dealer_rooftops 
WITH (security_invoker = true) AS
SELECT * FROM public.dealer_traps;

CREATE VIEW public.dealer_crawl_runs 
WITH (security_invoker = true) AS
SELECT * FROM public.trap_crawl_runs;

CREATE VIEW public.dealer_crawl_jobs 
WITH (security_invoker = true) AS
SELECT * FROM public.trap_crawl_jobs;

COMMENT ON VIEW public.dealer_rooftops IS 'DEPRECATED: Use dealer_traps. Will be removed after 2026-02-08.';
COMMENT ON VIEW public.dealer_crawl_runs IS 'DEPRECATED: Use trap_crawl_runs. Will be removed after 2026-02-08.';
COMMENT ON VIEW public.dealer_crawl_jobs IS 'DEPRECATED: Use trap_crawl_jobs. Will be removed after 2026-02-08.';