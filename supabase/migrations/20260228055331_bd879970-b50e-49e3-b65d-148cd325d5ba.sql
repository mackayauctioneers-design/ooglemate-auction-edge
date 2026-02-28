
-- Reset auction queue items stuck in 'processing' for longer than threshold
CREATE OR REPLACE FUNCTION public.reset_stuck_auction_queue_items(p_stuck_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE pickles_detail_queue
  SET
    crawl_status = 'pending',
    claimed_at = NULL,
    claimed_by = NULL,
    last_crawl_error = 'Reset: stuck in processing for >' || p_stuck_minutes || ' minutes',
    last_crawl_at = now()
  WHERE crawl_status = 'processing'
    AND claimed_at < now() - (p_stuck_minutes || ' minutes')::interval;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
