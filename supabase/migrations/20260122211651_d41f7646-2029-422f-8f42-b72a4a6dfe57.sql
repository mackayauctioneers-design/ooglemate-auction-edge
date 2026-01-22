-- Create dealer URL submissions table (batch submissions)
CREATE TABLE public.dealer_url_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_by TEXT NOT NULL DEFAULT 'dave',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_text TEXT,
  notes TEXT,
  urls_accepted INTEGER DEFAULT 0,
  urls_duplicate INTEGER DEFAULT 0,
  urls_queued_scrape INTEGER DEFAULT 0,
  urls_queued_firecrawl INTEGER DEFAULT 0,
  urls_manual_review INTEGER DEFAULT 0
);

-- Create dealer URL queue table
CREATE TABLE public.dealer_url_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID REFERENCES public.dealer_url_submissions(id) ON DELETE SET NULL,
  url_raw TEXT NOT NULL,
  url_canonical TEXT NOT NULL,
  domain TEXT NOT NULL,
  dealer_slug TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'unknown' CHECK (intent IN ('dealer_home', 'inventory_search', 'inventory_detail', 'unknown')),
  method TEXT NOT NULL DEFAULT 'firecrawl' CHECK (method IN ('scrape', 'firecrawl', 'manual_review')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed', 'ignored')),
  fail_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  result_summary JSONB,
  discovered_urls TEXT[],
  CONSTRAINT dealer_url_queue_url_canonical_unique UNIQUE (url_canonical)
);

-- Create indexes for efficient querying
CREATE INDEX idx_dealer_url_queue_status ON public.dealer_url_queue(status);
CREATE INDEX idx_dealer_url_queue_method ON public.dealer_url_queue(method);
CREATE INDEX idx_dealer_url_queue_domain ON public.dealer_url_queue(domain);
CREATE INDEX idx_dealer_url_queue_submission ON public.dealer_url_queue(submission_id);

-- Enable RLS
ALTER TABLE public.dealer_url_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_url_queue ENABLE ROW LEVEL SECURITY;

-- RLS policies for submissions (admin/operator access)
CREATE POLICY "Allow authenticated users to read submissions"
  ON public.dealer_url_submissions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert submissions"
  ON public.dealer_url_submissions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow service role full access to submissions"
  ON public.dealer_url_submissions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS policies for queue
CREATE POLICY "Allow authenticated users to read queue"
  ON public.dealer_url_queue FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert queue"
  ON public.dealer_url_queue FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update queue"
  ON public.dealer_url_queue FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow service role full access to queue"
  ON public.dealer_url_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);