-- =====================================================
-- PICKLES QUEUE HARDENING: Constraints, Indexes, Claim RPC
-- =====================================================

-- 1) Add observability columns for claim tracking and scrape metadata
ALTER TABLE pickles_detail_queue 
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_run_id TEXT,
  ADD COLUMN IF NOT EXISTS last_crawl_http_status INTEGER,
  ADD COLUMN IF NOT EXISTS content_len INTEGER;

-- 2) Ensure unique constraint exists (migration is idempotent)
-- The table already has UNIQUE(source, source_listing_id) from creation
-- Add composite index for claim query
DROP INDEX IF EXISTS idx_pickles_queue_claim;
CREATE INDEX idx_pickles_queue_claim 
  ON pickles_detail_queue(crawl_status, crawl_attempts, first_seen_at)
  WHERE crawl_status IN ('pending', 'failed');

-- Index for stale refresh queries
DROP INDEX IF EXISTS idx_pickles_queue_stale;
CREATE INDEX idx_pickles_queue_stale 
  ON pickles_detail_queue(source, last_seen_at);

-- Index for run inspection
CREATE INDEX IF NOT EXISTS idx_pickles_queue_run 
  ON pickles_detail_queue(run_id);

-- 3) Atomic claim RPC with FOR UPDATE SKIP LOCKED semantics
-- Returns claimed rows so crawler can process them safely
CREATE OR REPLACE FUNCTION claim_pickles_detail_batch(
  p_batch_size INTEGER DEFAULT 20,
  p_max_retries INTEGER DEFAULT 3,
  p_run_id TEXT DEFAULT NULL
)
RETURNS SETOF pickles_detail_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id TEXT;
BEGIN
  v_run_id := COALESCE(p_run_id, gen_random_uuid()::text);
  
  -- Atomically claim rows: pending OR (failed with retries left and not recently attempted)
  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM pickles_detail_queue
    WHERE (
      crawl_status = 'pending'
      OR (
        crawl_status = 'failed' 
        AND crawl_attempts < p_max_retries
        AND (last_crawl_at IS NULL OR last_crawl_at < NOW() - INTERVAL '1 hour')
      )
    )
    ORDER BY 
      CASE WHEN crawl_status = 'pending' THEN 0 ELSE 1 END,
      first_seen_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE pickles_detail_queue q
  SET 
    crawl_status = 'processing',
    claimed_at = NOW(),
    claimed_run_id = v_run_id
  FROM claimable c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;

-- 4) Batch upsert RPC for harvester (eliminates per-item selects)
CREATE OR REPLACE FUNCTION upsert_pickles_harvest_batch(
  p_items JSONB,
  p_run_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER := 0;
  v_updated INTEGER := 0;
  v_item JSONB;
  v_result RECORD;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO pickles_detail_queue (
      source,
      detail_url,
      source_listing_id,
      search_url,
      page_no,
      run_id,
      crawl_status,
      first_seen_at,
      last_seen_at
    ) VALUES (
      'pickles',
      v_item->>'detail_url',
      v_item->>'source_listing_id',
      v_item->>'search_url',
      (v_item->>'page_no')::INTEGER,
      p_run_id,
      'pending',
      NOW(),
      NOW()
    )
    ON CONFLICT (source, source_listing_id) DO UPDATE SET
      last_seen_at = NOW(),
      detail_url = EXCLUDED.detail_url,
      -- Reactivate if failed long ago
      crawl_status = CASE 
        WHEN pickles_detail_queue.crawl_status = 'failed' 
          AND pickles_detail_queue.last_crawl_at < NOW() - INTERVAL '24 hours'
        THEN 'pending'
        ELSE pickles_detail_queue.crawl_status
      END
    RETURNING (xmax = 0) AS is_insert INTO v_result;
    
    IF v_result.is_insert THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_updated := v_updated + 1;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'total', v_inserted + v_updated
  );
END;
$$;

-- 5) Helper to mark stale listings (not seen in X days)
CREATE OR REPLACE FUNCTION mark_pickles_stale(
  p_days_threshold INTEGER DEFAULT 7
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE pickles_detail_queue
  SET crawl_status = 'stale'
  WHERE crawl_status NOT IN ('stale', 'processing')
    AND last_seen_at < NOW() - (p_days_threshold || ' days')::INTERVAL;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION claim_pickles_detail_batch IS 'Atomically claims batch of queue items for processing (parallel-safe with FOR UPDATE SKIP LOCKED)';
COMMENT ON FUNCTION upsert_pickles_harvest_batch IS 'Batch upsert for harvester - eliminates per-item selects';