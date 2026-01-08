-- Add started_at IS NOT NULL safety check to stale reaper
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
  stale_threshold interval := interval '15 minutes';
BEGIN
  -- STEP 1: Reap stale jobs stuck in 'processing' for > 15 minutes
  -- Safety: only reap if started_at is actually set
  UPDATE dealer_crawl_jobs
  SET 
    status = CASE 
      WHEN attempts >= max_attempts THEN 'failed'
      ELSE 'pending'
    END,
    started_at = CASE 
      WHEN attempts >= max_attempts THEN started_at  -- Keep for failed
      ELSE NULL  -- Reset for retry
    END,
    finished_at = CASE 
      WHEN attempts >= max_attempts THEN now()
      ELSE NULL
    END,
    error = COALESCE(error, '') || ' [stale-reaped after 15min]'
  WHERE status = 'processing'
    AND started_at IS NOT NULL
    AND started_at < now() - stale_threshold;

  -- STEP 2: Atomically claim the next pending job
  SELECT j.id, j.dealer_slug, j.run_type, j.attempts, j.max_attempts
  INTO claimed_job
  FROM dealer_crawl_jobs j
  WHERE j.status = 'pending'
  ORDER BY j.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  IF claimed_job.id IS NULL THEN
    RETURN;
  END IF;
  
  -- Mark as processing and increment attempts atomically
  UPDATE dealer_crawl_jobs
  SET 
    status = 'processing',
    started_at = now(),
    finished_at = NULL,
    attempts = dealer_crawl_jobs.attempts + 1
  WHERE id = claimed_job.id;
  
  RETURN QUERY SELECT 
    claimed_job.id,
    claimed_job.dealer_slug,
    claimed_job.run_type,
    claimed_job.attempts + 1,
    claimed_job.max_attempts;
END;
$$;