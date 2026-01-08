-- Atomic job claim function using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_next_job()
RETURNS TABLE (
  job_id uuid,
  dealer_slug text,
  run_type text,
  attempts integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_job RECORD;
BEGIN
  -- Atomically select and update exactly one pending job
  -- FOR UPDATE SKIP LOCKED ensures concurrent workers don't conflict
  SELECT j.id, j.dealer_slug, j.run_type, j.attempts, j.max_attempts
  INTO claimed_job
  FROM dealer_crawl_jobs j
  WHERE j.status = 'pending'
  ORDER BY j.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  -- If no job found, return empty
  IF claimed_job.id IS NULL THEN
    RETURN;
  END IF;
  
  -- Mark as processing and increment attempts atomically
  UPDATE dealer_crawl_jobs
  SET 
    status = 'processing',
    started_at = now(),
    attempts = dealer_crawl_jobs.attempts + 1
  WHERE id = claimed_job.id;
  
  -- Return the claimed job with incremented attempts
  RETURN QUERY SELECT 
    claimed_job.id,
    claimed_job.dealer_slug,
    claimed_job.run_type,
    claimed_job.attempts + 1,  -- Return the new attempts value
    claimed_job.max_attempts;
END;
$$;

COMMENT ON FUNCTION public.claim_next_job IS 'Atomically claims the next pending crawl job using FOR UPDATE SKIP LOCKED to prevent concurrent processing';