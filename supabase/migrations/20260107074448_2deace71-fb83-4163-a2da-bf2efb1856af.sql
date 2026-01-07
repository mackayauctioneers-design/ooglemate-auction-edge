-- Create dealer_crawl_runs table for health metrics tracking
CREATE TABLE IF NOT EXISTS public.dealer_crawl_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  dealer_slug TEXT NOT NULL,
  dealer_name TEXT NOT NULL,
  parser_mode TEXT NOT NULL,
  vehicles_found INTEGER NOT NULL DEFAULT 0,
  vehicles_ingested INTEGER NOT NULL DEFAULT 0,
  vehicles_dropped INTEGER NOT NULL DEFAULT 0,
  drop_reasons JSONB DEFAULT '{}',
  error TEXT,
  run_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  run_completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(run_date, dealer_slug)
);

-- Enable RLS
ALTER TABLE public.dealer_crawl_runs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role)
CREATE POLICY "Service role full access to dealer_crawl_runs"
ON public.dealer_crawl_runs
FOR ALL
USING (true)
WITH CHECK (true);

-- Index for health metrics queries
CREATE INDEX idx_dealer_crawl_runs_date_slug ON public.dealer_crawl_runs(run_date, dealer_slug);
CREATE INDEX idx_dealer_crawl_runs_slug_date ON public.dealer_crawl_runs(dealer_slug, run_date DESC);