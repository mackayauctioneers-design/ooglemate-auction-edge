-- Create dealer_crawl_jobs table for async job processing
CREATE TABLE public.dealer_crawl_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dealer_slug text NOT NULL,
  run_type text NOT NULL CHECK (run_type IN ('validation', 'cron')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  result jsonb
);

-- Index for efficient job polling
CREATE INDEX idx_dealer_crawl_jobs_pending ON public.dealer_crawl_jobs (status, created_at) 
WHERE status = 'pending';

-- Index for deduplication
CREATE UNIQUE INDEX idx_dealer_crawl_jobs_dedup ON public.dealer_crawl_jobs (dealer_slug, run_type) 
WHERE status IN ('pending', 'processing');

-- Enable RLS (admin only)
ALTER TABLE public.dealer_crawl_jobs ENABLE ROW LEVEL SECURITY;

-- Admin-only policy
CREATE POLICY "Admins can manage crawl jobs"
ON public.dealer_crawl_jobs
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.dealer_crawl_jobs IS 'Async job queue for dealer site crawling to avoid HTTP timeouts';