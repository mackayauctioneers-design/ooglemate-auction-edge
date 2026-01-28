-- Create claim_slattery_queue_batch RPC for atomic queue claiming
-- Uses FOR UPDATE SKIP LOCKED to prevent race conditions
CREATE OR REPLACE FUNCTION public.claim_slattery_queue_batch(
  p_batch_size integer DEFAULT 50,
  p_max_retries integer DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  source_listing_id text,
  detail_url text,
  stub_anchor_id uuid,
  retry_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT pdq.id
    FROM pickles_detail_queue pdq
    WHERE pdq.source = 'slattery'
      AND pdq.crawl_status = 'pending'
      AND COALESCE(pdq.crawl_attempts, 0) < p_max_retries
    ORDER BY pdq.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE pickles_detail_queue pdq
  SET 
    crawl_status = 'processing',
    crawl_attempts = COALESCE(pdq.crawl_attempts, 0) + 1,
    updated_at = now()
  FROM claimed
  WHERE pdq.id = claimed.id
  RETURNING 
    pdq.id,
    pdq.source_listing_id,
    pdq.detail_url,
    pdq.stub_anchor_id,
    COALESCE(pdq.crawl_attempts, 1) as retry_count;
END;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION public.claim_slattery_queue_batch(integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.claim_slattery_queue_batch(integer, integer) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.claim_slattery_queue_batch IS 'Atomically claims a batch of pending Slattery queue items for processing using FOR UPDATE SKIP LOCKED';