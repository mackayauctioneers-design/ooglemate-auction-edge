-- Atomic progress update RPC for apify_runs_queue
CREATE OR REPLACE FUNCTION public.increment_apify_run_progress(
  p_id uuid,
  p_items_fetched int,
  p_items_upserted_delta int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE apify_runs_queue
  SET 
    items_fetched = p_items_fetched,
    items_upserted = COALESCE(items_upserted, 0) + p_items_upserted_delta,
    updated_at = now()
  WHERE id = p_id;
END;
$$;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION public.increment_apify_run_progress(uuid, int, int) TO service_role;

COMMENT ON FUNCTION public.increment_apify_run_progress IS 'Atomically update fetch progress - avoids stale counter races';