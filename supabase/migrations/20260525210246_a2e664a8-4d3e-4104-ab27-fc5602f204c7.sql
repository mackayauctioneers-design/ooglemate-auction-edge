
ALTER TABLE public.trap_crawl_runs
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worker_name text,
  ADD COLUMN IF NOT EXISTS new_listings int,
  ADD COLUMN IF NOT EXISTS disappeared_listings int;

UPDATE public.trap_crawl_runs r
   SET account_id = a.id
  FROM public.accounts a
 WHERE r.account_id IS NULL
   AND lower(r.trap_slug) = lower(a.slug);

CREATE INDEX IF NOT EXISTS idx_tcr_account_started
  ON public.trap_crawl_runs (account_id, run_started_at DESC);

CREATE OR REPLACE VIEW public.dealer_crawl_runs AS
SELECT id, run_date, trap_slug, dealer_name, parser_mode,
       vehicles_found, vehicles_ingested, vehicles_dropped, drop_reasons,
       error, run_started_at, run_completed_at, created_at,
       account_id, worker_name, new_listings, disappeared_listings
  FROM public.trap_crawl_runs;
