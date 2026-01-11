-- Drop existing function with old signature first
DROP FUNCTION IF EXISTS public.detect_sold_returned_suspects();

-- Create function to detect sold-returned suspects
CREATE FUNCTION public.detect_sold_returned_suspects()
RETURNS TABLE (
  listing_uuid uuid,
  listing_id text,
  reason text,
  flagged_count int
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH suspects AS (
    SELECT 
      vl.id,
      vl.listing_id as lid,
      'Cleared then reappeared within 21 days'::text as rsn
    FROM vehicle_listings vl
    WHERE vl.source_class = 'auction'
      AND vl.last_seen_at > NOW() - INTERVAL '7 days'
      AND vl.sold_returned_suspected = false
      AND vl.status = 'catalogue'
      AND vl.relist_count >= 1
      AND EXISTS (
        SELECT 1 FROM listing_snapshots ls 
        WHERE ls.listing_id = vl.id 
        AND ls.status = 'cleared'
        AND ls.seen_at > NOW() - INTERVAL '21 days'
      )
  )
  SELECT 
    s.id,
    s.lid,
    s.rsn,
    (SELECT COUNT(*)::int FROM suspects)
  FROM suspects s;
$$;

-- Create function to update auction attempt tracking
CREATE OR REPLACE FUNCTION public.update_auction_attempts()
RETURNS TABLE (
  updated_count int,
  stage_counts jsonb
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_updated int := 0;
  v_stages jsonb;
BEGIN
  -- Update attempt counts and stages for active auction listings
  WITH updated AS (
    UPDATE vehicle_listings vl
    SET 
      attempt_count = CASE 
        WHEN vl.last_attempt_at IS NULL THEN 1
        WHEN vl.last_seen_at > COALESCE(vl.last_attempt_at, vl.first_seen_at) + INTERVAL '5 days'
        THEN vl.attempt_count + 1
        ELSE vl.attempt_count
      END,
      attempt_stage = CASE 
        WHEN vl.attempt_count = 0 THEN 'first_run'
        WHEN vl.attempt_count = 1 THEN 'first_run'
        WHEN vl.attempt_count = 2 THEN 'second_run'
        WHEN vl.attempt_count >= 3 THEN 'third_run'
        ELSE 'stale'
      END,
      last_attempt_at = vl.last_seen_at
    WHERE vl.source_class = 'auction'
      AND vl.status IN ('catalogue', 'passed_in')
      AND vl.last_seen_at > NOW() - INTERVAL '7 days'
    RETURNING vl.attempt_stage
  )
  SELECT COUNT(*) INTO v_updated FROM updated;
  
  -- Get stage distribution
  SELECT jsonb_object_agg(stage, cnt) INTO v_stages
  FROM (
    SELECT attempt_stage as stage, COUNT(*)::int as cnt 
    FROM vehicle_listings 
    WHERE source_class = 'auction' AND status IN ('catalogue', 'passed_in')
    GROUP BY attempt_stage
  ) s;
  
  RETURN QUERY SELECT v_updated, COALESCE(v_stages, '{}'::jsonb);
END;
$$;