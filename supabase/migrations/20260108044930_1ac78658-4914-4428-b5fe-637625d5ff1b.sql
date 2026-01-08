-- 1) Create backwards-compatible VIEW aliases (for 30 days)
-- Note: Views pointing to new table names for legacy code compatibility

CREATE OR REPLACE VIEW public.dealer_rooftops AS
SELECT * FROM public.dealer_traps;

CREATE OR REPLACE VIEW public.dealer_crawl_runs AS
SELECT * FROM public.trap_crawl_runs;

CREATE OR REPLACE VIEW public.dealer_crawl_jobs AS
SELECT * FROM public.trap_crawl_jobs;

-- Add comments noting deprecation
COMMENT ON VIEW public.dealer_rooftops IS 'DEPRECATED: Use dealer_traps. Will be removed after 2026-02-08.';
COMMENT ON VIEW public.dealer_crawl_runs IS 'DEPRECATED: Use trap_crawl_runs. Will be removed after 2026-02-08.';
COMMENT ON VIEW public.dealer_crawl_jobs IS 'DEPRECATED: Use trap_crawl_jobs. Will be removed after 2026-02-08.';

-- 2) Standardize slug column naming in dealer_traps
-- Rename dealer_slug -> trap_slug for consistency
ALTER TABLE public.dealer_traps RENAME COLUMN dealer_slug TO trap_slug;

-- Update the unique constraint if it exists with old name
ALTER INDEX IF EXISTS dealer_rooftops_dealer_slug_key RENAME TO dealer_traps_trap_slug_key;