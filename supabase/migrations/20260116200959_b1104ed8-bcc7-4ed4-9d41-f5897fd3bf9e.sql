-- ============================================================
-- Kiting Mode Outward Hunt - Web/Auction Lane Discovery
-- ============================================================

-- 1.1 hunt_web_sources - configurable list of domains to search
CREATE TABLE IF NOT EXISTS public.hunt_web_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  source_type text NOT NULL DEFAULT 'auction', -- 'auction', 'classifieds', 'dealer_network'
  base_url text NOT NULL,
  search_url_template text, -- e.g., '{base}/search?make={make}&model={model}&year={year}'
  parser_type text NOT NULL DEFAULT 'firecrawl', -- 'firecrawl', 'apify', 'api', 'manual'
  enabled boolean DEFAULT true,
  priority int DEFAULT 50, -- Higher = searched first
  rate_limit_per_hour int DEFAULT 20,
  last_searched_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS (operator-only write, read for all)
ALTER TABLE public.hunt_web_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view hunt_web_sources"
  ON public.hunt_web_sources FOR SELECT USING (true);

-- Seed initial sources
INSERT INTO public.hunt_web_sources (name, display_name, source_type, base_url, search_url_template, parser_type, priority) VALUES
  ('lloyds', 'Lloyds Auctions', 'auction', 'https://www.lloydsauctions.com.au', '/search?q={make}+{model}', 'firecrawl', 80),
  ('grays', 'Grays Online', 'auction', 'https://www.grays.com', '/search?keyword={make}+{model}+{year}', 'firecrawl', 75),
  ('manheim', 'Manheim', 'auction', 'https://www.manheim.com.au', '/search/{make}-{model}', 'firecrawl', 70),
  ('tradingpost', 'Trading Post', 'classifieds', 'https://www.tradingpost.com.au', '/cars?q={make}+{model}', 'firecrawl', 60),
  ('carsguide', 'CarsGuide', 'classifieds', 'https://www.carsguide.com.au', '/buy-a-car?q={make}+{model}&year_from={year}', 'firecrawl', 55)
ON CONFLICT (name) DO NOTHING;

-- 1.2 hunt_external_candidates - discovered listings from outward search
CREATE TABLE IF NOT EXISTS public.hunt_external_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id uuid NOT NULL REFERENCES public.sale_hunts(id) ON DELETE CASCADE,
  source_name text NOT NULL, -- FK logical to hunt_web_sources.name
  source_url text NOT NULL,
  dedup_key text NOT NULL, -- hash of source_name + normalized URL
  
  -- Extracted fields (best-effort, nullable)
  title text,
  year int,
  make text,
  model text,
  variant_raw text,
  km int,
  asking_price int,
  location text,
  
  -- Scoring
  match_score numeric(4,2),
  decision text, -- 'buy', 'watch', 'ignore', 'pending'
  alert_emitted boolean DEFAULT false,
  
  -- Metadata
  raw_snippet text, -- First 500 chars of scraped content
  confidence text DEFAULT 'low', -- 'high', 'medium', 'low'
  extraction_error text,
  
  -- Lifecycle
  discovered_at timestamptz DEFAULT now(),
  scored_at timestamptz,
  expired_at timestamptz, -- Mark stale after 7 days
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hunt_external_candidates_hunt_id 
  ON public.hunt_external_candidates(hunt_id);
CREATE INDEX IF NOT EXISTS idx_hunt_external_candidates_decision 
  ON public.hunt_external_candidates(decision) WHERE alert_emitted = false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hunt_external_candidates_dedup 
  ON public.hunt_external_candidates(dedup_key);

-- Enable RLS
ALTER TABLE public.hunt_external_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dealers can view their hunt candidates"
  ON public.hunt_external_candidates FOR SELECT
  USING (
    hunt_id IN (SELECT id FROM public.sale_hunts WHERE dealer_id = auth.uid())
  );

-- 1.3 hunt_search_tasks - queue for outward searches
CREATE TABLE IF NOT EXISTS public.hunt_search_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id uuid NOT NULL REFERENCES public.sale_hunts(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  status text DEFAULT 'pending', -- 'pending', 'running', 'complete', 'error'
  search_query text, -- The constructed search URL
  candidates_found int DEFAULT 0,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hunt_search_tasks_pending 
  ON public.hunt_search_tasks(created_at) WHERE status = 'pending';

ALTER TABLE public.hunt_search_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dealers can view their search tasks"
  ON public.hunt_search_tasks FOR SELECT
  USING (
    hunt_id IN (SELECT id FROM public.sale_hunts WHERE dealer_id = auth.uid())
  );

-- Add outward_enabled flag to sale_hunts
ALTER TABLE public.sale_hunts 
  ADD COLUMN IF NOT EXISTS outward_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS outward_sources text[] DEFAULT ARRAY['lloyds', 'grays'];

COMMENT ON TABLE public.hunt_web_sources IS 'Configurable list of external domains for outward hunt discovery';
COMMENT ON TABLE public.hunt_external_candidates IS 'Listings discovered from outward web searches, not yet in retail_listings';
COMMENT ON TABLE public.hunt_search_tasks IS 'Queue of pending/running outward search jobs per hunt';