-- Phase 1: Pickles Detail Queue - stores only detail URLs from search harvesting
-- Phase 2: Detail micro-crawler will enrich these with real data

CREATE TABLE IF NOT EXISTS pickles_detail_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'pickles',
  detail_url TEXT NOT NULL,
  source_listing_id TEXT NOT NULL,  -- The numeric stock ID from URL
  search_url TEXT,                   -- Which search URL found this
  page_no INTEGER,                   -- Page number in search results
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Micro-crawl tracking
  crawl_status TEXT NOT NULL DEFAULT 'pending',  -- pending, crawled, failed, skipped
  crawl_attempts INTEGER NOT NULL DEFAULT 0,
  last_crawl_at TIMESTAMPTZ,
  last_crawl_error TEXT,
  
  -- Extracted fields (populated by detail micro-crawler)
  year INTEGER,
  make TEXT,
  model TEXT,
  variant_raw TEXT,
  km INTEGER,
  asking_price INTEGER,
  guide_price INTEGER,
  sold_price INTEGER,
  reserve_price INTEGER,
  buy_method TEXT,
  location TEXT,
  state TEXT,
  sale_close_at TIMESTAMPTZ,
  sale_status TEXT,  -- upcoming, live, sold, passed_in, withdrawn
  
  -- Observability
  run_id TEXT,  -- Which harvest run found this
  
  UNIQUE(source, source_listing_id)
);

-- Index for worker to claim pending items
CREATE INDEX IF NOT EXISTS idx_pickles_queue_status ON pickles_detail_queue(crawl_status, last_crawl_at);
CREATE INDEX IF NOT EXISTS idx_pickles_queue_listing_id ON pickles_detail_queue(source_listing_id);

-- Harvester run tracking
CREATE TABLE IF NOT EXISTS pickles_harvest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_url TEXT NOT NULL,
  pages_crawled INTEGER NOT NULL DEFAULT 0,
  urls_harvested INTEGER NOT NULL DEFAULT 0,
  urls_new INTEGER NOT NULL DEFAULT 0,
  urls_existing INTEGER NOT NULL DEFAULT 0,
  errors TEXT[],
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running'  -- running, completed, failed
);

-- Detail crawl run tracking (for observability)
CREATE TABLE IF NOT EXISTS pickles_detail_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail_fetched INTEGER NOT NULL DEFAULT 0,
  parsed_ok INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  reject_reasons JSONB DEFAULT '{}',
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running'
);

COMMENT ON TABLE pickles_detail_queue IS 'Two-phase Pickles pipeline: URLs harvested from search → enriched by detail micro-crawler';
COMMENT ON COLUMN pickles_detail_queue.crawl_status IS 'pending=needs crawl, crawled=data extracted, failed=crawl error, skipped=invalid URL';