-- =============================================================================
-- TASK 1: Rename dealer_rooftops → dealer_traps (mechanical rename)
-- TASK 2: Add NSW region bucket enum
-- TASK 3: Final trap registry schema
-- =============================================================================

-- Create NSW region bucket enum
CREATE TYPE public.nsw_region_bucket AS ENUM (
  'NSW_SYDNEY_METRO',
  'NSW_CENTRAL_COAST',
  'NSW_HUNTER_NEWCASTLE',
  'NSW_REGIONAL'
);

-- Rename table dealer_rooftops → dealer_traps
ALTER TABLE public.dealer_rooftops RENAME TO dealer_traps;

-- Rename columns in dealer_traps to match final schema
ALTER TABLE public.dealer_traps RENAME COLUMN anchor_dealer TO anchor_trap;

-- Add dealer_group column (renamed from group_id for clarity)
-- The existing group_id FK stays, we'll add dealer_group as text for display
ALTER TABLE public.dealer_traps ADD COLUMN IF NOT EXISTS dealer_group text;

-- Rename last_vehicles_found to last_vehicle_count for consistency
ALTER TABLE public.dealer_traps RENAME COLUMN last_vehicles_found TO last_vehicle_count;

-- Rename dealer_crawl_runs table to trap_crawl_runs  
ALTER TABLE public.dealer_crawl_runs RENAME TO trap_crawl_runs;

-- Rename dealer_slug to trap_slug in trap_crawl_runs
ALTER TABLE public.trap_crawl_runs RENAME COLUMN dealer_slug TO trap_slug;

-- Rename dealer_name to trap_name in trap_crawl_runs (keep for backwards compat)
-- Actually keep dealer_name as that's the display name

-- Rename dealer_crawl_jobs table to trap_crawl_jobs
ALTER TABLE public.dealer_crawl_jobs RENAME TO trap_crawl_jobs;

-- Rename dealer_slug to trap_slug in trap_crawl_jobs
ALTER TABLE public.trap_crawl_jobs RENAME COLUMN dealer_slug TO trap_slug;

-- Update get_nsw_rooftop_stats → get_nsw_trap_stats
DROP FUNCTION IF EXISTS public.get_nsw_rooftop_stats();

CREATE OR REPLACE FUNCTION public.get_nsw_trap_stats()
RETURNS TABLE(region_id text, enabled_count bigint, total_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT region_id, COUNT(*) FILTER (WHERE enabled) as enabled_count, COUNT(*) as total_count
  FROM dealer_traps WHERE region_id LIKE 'NSW%' GROUP BY region_id ORDER BY region_id;
$$;

-- Update get_nsw_crawl_today to use dealer_traps
DROP FUNCTION IF EXISTS public.get_nsw_crawl_today();

CREATE OR REPLACE FUNCTION public.get_nsw_crawl_today()
RETURNS TABLE(vehicles_found bigint, vehicles_ingested bigint, vehicles_dropped bigint, crawl_runs bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT SUM(vehicles_found), SUM(vehicles_ingested), SUM(vehicles_dropped), COUNT(*)
  FROM trap_crawl_runs
  WHERE run_date = CURRENT_DATE
    AND trap_slug IN (SELECT dealer_slug FROM dealer_traps WHERE region_id LIKE 'NSW%');
$$;

-- Update get_top_drop_reasons to use dealer_traps
DROP FUNCTION IF EXISTS public.get_top_drop_reasons();

CREATE OR REPLACE FUNCTION public.get_top_drop_reasons()
RETURNS TABLE(drop_reason text, count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT key as drop_reason, SUM((value)::int)::bigint as count
  FROM trap_crawl_runs, jsonb_each_text(drop_reasons)
  WHERE run_date = CURRENT_DATE
    AND trap_slug IN (SELECT dealer_slug FROM dealer_traps WHERE region_id LIKE 'NSW%')
  GROUP BY key ORDER BY count DESC LIMIT 5;
$$;

-- Update claim_next_job to use trap_crawl_jobs
DROP FUNCTION IF EXISTS public.claim_next_job();

CREATE OR REPLACE FUNCTION public.claim_next_job()
RETURNS TABLE(job_id uuid, trap_slug text, run_type text, attempts integer, max_attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  claimed_job RECORD;
  stale_threshold interval := interval '15 minutes';
BEGIN
  -- STEP 1: Reap stale jobs stuck in 'processing' for > 15 minutes
  UPDATE trap_crawl_jobs j
  SET 
    status = CASE 
      WHEN j.attempts >= j.max_attempts THEN 'failed'
      ELSE 'pending'
    END,
    started_at = CASE 
      WHEN j.attempts >= j.max_attempts THEN j.started_at
      ELSE NULL
    END,
    finished_at = CASE 
      WHEN j.attempts >= j.max_attempts THEN now()
      ELSE NULL
    END,
    error = COALESCE(j.error, '') || ' [stale-reaped after 15min]'
  WHERE j.status = 'processing'
    AND j.started_at IS NOT NULL
    AND j.started_at < now() - stale_threshold;

  -- STEP 2: Atomically claim the next pending job
  SELECT j.id, j.trap_slug, j.run_type, j.attempts, j.max_attempts
  INTO claimed_job
  FROM trap_crawl_jobs j
  WHERE j.status = 'pending'
  ORDER BY j.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  IF claimed_job.id IS NULL THEN
    RETURN;
  END IF;
  
  -- Mark as processing and increment attempts atomically
  UPDATE trap_crawl_jobs j
  SET 
    status = 'processing',
    started_at = now(),
    finished_at = NULL,
    attempts = j.attempts + 1
  WHERE j.id = claimed_job.id;
  
  RETURN QUERY SELECT 
    claimed_job.id,
    claimed_job.trap_slug,
    claimed_job.run_type,
    claimed_job.attempts + 1,
    claimed_job.max_attempts;
END;
$$;

-- Update get_job_queue_stats to use trap_crawl_jobs
DROP FUNCTION IF EXISTS public.get_job_queue_stats();

CREATE OR REPLACE FUNCTION public.get_job_queue_stats()
RETURNS TABLE(pending bigint, processing bigint, completed bigint, failed bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'processing'),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'failed')
  FROM trap_crawl_jobs;
$$;

-- Add index for the unique dedup constraint (if not exists)
-- The existing constraint should carry over with the rename