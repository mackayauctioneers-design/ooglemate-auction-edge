
-- ══════════════════════════════════════════════════════════════
-- Outward Jobs (Lindy Computer dispatch state machine)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE public.outward_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_run_id uuid NOT NULL,
  account_id text,
  source_key text NOT NULL,
  search_url text NOT NULL,
  intent jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  dispatched_at timestamptz,
  completed_at timestamptz,
  result_count int DEFAULT 0,
  error text,
  created_at timestamptz DEFAULT now()
);

-- Queue drain index
CREATE INDEX outward_jobs_status_idx ON public.outward_jobs(status, created_at);
CREATE INDEX outward_jobs_run_idx ON public.outward_jobs(search_run_id);
-- Concurrency check: active jobs per source
CREATE INDEX outward_jobs_source_active_idx ON public.outward_jobs(source_key, status) WHERE status IN ('pending', 'dispatched');

-- RLS
ALTER TABLE public.outward_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on outward_jobs" ON public.outward_jobs FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- Outward Search Results (staging table for webhook returns)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE public.outward_search_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.outward_jobs(id) ON DELETE CASCADE,
  search_run_id uuid NOT NULL,
  source_key text NOT NULL,
  title text,
  price_aud numeric,
  odometer_km numeric,
  year int,
  state text,
  listing_url text NOT NULL,
  -- Identity normalization output
  make_norm text,
  model_norm text,
  variant_family text,
  fingerprint text,
  norm_confidence int,
  norm_explain text[],
  -- Metadata
  ingested_at timestamptz DEFAULT now(),
  UNIQUE(listing_url, job_id)
);

CREATE INDEX outward_results_run_idx ON public.outward_search_results(search_run_id);
CREATE INDEX outward_results_job_idx ON public.outward_search_results(job_id);

-- RLS
ALTER TABLE public.outward_search_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on outward_search_results" ON public.outward_search_results FOR ALL USING (true) WITH CHECK (true);
-- Authenticated users can read results for frontend polling
CREATE POLICY "Authenticated read outward_search_results" ON public.outward_search_results FOR SELECT TO authenticated USING (true);
