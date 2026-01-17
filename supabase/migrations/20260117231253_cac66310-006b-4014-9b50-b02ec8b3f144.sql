-- A1) Add verification fields to hunt_external_candidates (outward_candidates equivalent)
ALTER TABLE public.hunt_external_candidates 
ADD COLUMN IF NOT EXISTS is_listing BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS listing_kind TEXT NULL,
ADD COLUMN IF NOT EXISTS page_type TEXT NULL,
ADD COLUMN IF NOT EXISTS price_verified BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS km_verified BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS year_verified BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS verified_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS reject_reason TEXT NULL;

-- Add check constraints for valid values
ALTER TABLE public.hunt_external_candidates 
ADD CONSTRAINT chk_listing_kind CHECK (listing_kind IN ('retail_listing', 'auction_lot', 'dealer_stock', 'unknown') OR listing_kind IS NULL),
ADD CONSTRAINT chk_page_type CHECK (page_type IN ('listing', 'article', 'search', 'category', 'login', 'other') OR page_type IS NULL);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_hunt_ext_cand_listing ON public.hunt_external_candidates (hunt_id, is_listing, decision);
CREATE INDEX IF NOT EXISTS idx_hunt_ext_cand_verified ON public.hunt_external_candidates (hunt_id, price_verified, km_verified, year_verified);

-- A2) Create scrape queue for candidate verification
CREATE TABLE IF NOT EXISTS public.outward_candidate_scrape_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id UUID NOT NULL REFERENCES public.sale_hunts(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.hunt_external_candidates(id) ON DELETE CASCADE,
  candidate_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INT NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ NULL,
  lock_token UUID NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_queue_status CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  CONSTRAINT uq_queue_hunt_url UNIQUE (hunt_id, candidate_url)
);

-- Indexes for queue processing
CREATE INDEX IF NOT EXISTS idx_scrape_queue_status ON public.outward_candidate_scrape_queue (status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_scrape_queue_hunt ON public.outward_candidate_scrape_queue (hunt_id);

-- Enable RLS
ALTER TABLE public.outward_candidate_scrape_queue ENABLE ROW LEVEL SECURITY;

-- RLS policies for scrape queue (service role access)
CREATE POLICY "Service role full access to scrape queue"
ON public.outward_candidate_scrape_queue
FOR ALL
USING (true)
WITH CHECK (true);