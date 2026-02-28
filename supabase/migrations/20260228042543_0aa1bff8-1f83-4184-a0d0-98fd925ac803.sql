
-- Atomic batch claim RPC for auction detail enrichment
-- Filters by source array (pickles, grays, manheim) and uses FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_auction_detail_batch(
  p_batch_size INTEGER DEFAULT 5,
  p_claim_by TEXT DEFAULT 'auction-enricher',
  p_max_retries INTEGER DEFAULT 3,
  p_sources TEXT[] DEFAULT ARRAY['pickles', 'grays', 'manheim']
)
RETURNS TABLE(
  id UUID,
  source TEXT,
  source_listing_id TEXT,
  detail_url TEXT,
  crawl_status TEXT,
  retry_count INTEGER,
  stub_anchor_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_claim_time TIMESTAMPTZ := NOW();
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM pickles_detail_queue q
    WHERE q.source = ANY(p_sources)
      AND q.crawl_status IN ('pending', 'error')
      AND (q.claimed_at IS NULL OR q.claimed_at < NOW() - INTERVAL '15 minutes')
      AND q.retry_count < p_max_retries
    ORDER BY
      CASE WHEN q.crawl_status = 'pending' THEN 0 ELSE 1 END,
      q.first_seen_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE pickles_detail_queue q
  SET
    claimed_at = v_claim_time,
    claimed_by = p_claim_by,
    crawl_status = 'processing'
  FROM claimed
  WHERE q.id = claimed.id
  RETURNING
    q.id,
    q.source,
    q.source_listing_id,
    q.detail_url,
    q.crawl_status,
    q.retry_count,
    q.stub_anchor_id;
END;
$$;

COMMENT ON FUNCTION claim_auction_detail_batch IS 'Atomically claims a batch of auction detail queue items for Manus enrichment (FOR UPDATE SKIP LOCKED, source-filtered)';
