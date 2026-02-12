
-- Credit logging table for Firecrawl usage monitoring
CREATE TABLE public.firecrawl_credit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  function_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  format_used TEXT NOT NULL,
  estimated_credits INTEGER NOT NULL DEFAULT 1,
  url_scraped TEXT,
  note TEXT
);

ALTER TABLE public.firecrawl_credit_log ENABLE ROW LEVEL SECURITY;

-- Admin-only read access
CREATE POLICY "Admin read firecrawl_credit_log"
  ON public.firecrawl_credit_log
  FOR SELECT
  USING (true);

-- Add scrape_hash column for change detection on pickles_buy_now_listings
-- We'll store the hash of the last scraped markdown block
ALTER TABLE public.pickles_buy_now_listings
  ADD COLUMN IF NOT EXISTS scrape_content_hash TEXT;
