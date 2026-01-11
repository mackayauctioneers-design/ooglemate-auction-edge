-- Add sold-returned-suspected risk tracking to vehicle_listings
ALTER TABLE public.vehicle_listings
ADD COLUMN IF NOT EXISTS sold_returned_suspected boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS sold_returned_reason text,
ADD COLUMN IF NOT EXISTS sold_returned_flagged_at timestamptz;

-- Index for filtering out risky listings
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_sold_returned 
ON public.vehicle_listings (sold_returned_suspected) 
WHERE sold_returned_suspected = true;

-- Function to detect sold-then-returned pattern
-- Runs after ingestion to identify suspect vehicles
CREATE OR REPLACE FUNCTION public.detect_sold_returned_suspects()
RETURNS TABLE (
  listing_id text,
  listing_uuid uuid,
  reason text,
  flagged_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flagged_count int := 0;
  v_lookback_weeks int := 6; -- Look at last 6 weeks of history
BEGIN
  -- Find vehicles matching the sold-then-returned pattern:
  -- 1. Was seen in 3+ consecutive weekly runs (using snapshots)
  -- 2. Had a gap (missing for 5-14 days - assumed sold)
  -- 3. Reappeared within 1-2 weeks
  
  WITH snapshot_weeks AS (
    -- Group snapshots by week for each listing
    SELECT 
      vl.id as listing_uuid,
      vl.listing_id,
      vl.make,
      vl.model,
      date_trunc('week', ls.seen_at) as week_start,
      COUNT(*) as snapshots_in_week
    FROM vehicle_listings vl
    JOIN listing_snapshots ls ON ls.listing_id = vl.id
    WHERE vl.source_class = 'auction'
      AND ls.seen_at > now() - interval '6 weeks'
      AND vl.sold_returned_suspected = false -- Skip already flagged
    GROUP BY vl.id, vl.listing_id, vl.make, vl.model, date_trunc('week', ls.seen_at)
  ),
  consecutive_runs AS (
    -- Find listings with 3+ consecutive weeks of presence
    SELECT 
      listing_uuid,
      listing_id,
      make,
      model,
      array_agg(week_start ORDER BY week_start) as weeks_present,
      COUNT(*) as total_weeks
    FROM snapshot_weeks
    GROUP BY listing_uuid, listing_id, make, model
    HAVING COUNT(*) >= 3
  ),
  gap_analysis AS (
    -- Check for gaps followed by reappearance
    SELECT 
      cr.listing_uuid,
      cr.listing_id,
      cr.make,
      cr.model,
      cr.total_weeks,
      -- Find the most recent gap
      (
        SELECT MAX(gap_days)
        FROM (
          SELECT 
            EXTRACT(DAY FROM (lead(seen_at) OVER (ORDER BY seen_at) - seen_at)) as gap_days
          FROM listing_snapshots ls
          WHERE ls.listing_id = cr.listing_uuid
            AND ls.seen_at > now() - interval '6 weeks'
        ) gaps
        WHERE gap_days BETWEEN 5 AND 14
      ) as max_gap_days,
      -- Check if reappeared after gap
      (
        SELECT COUNT(*) > 0
        FROM listing_snapshots ls
        WHERE ls.listing_id = cr.listing_uuid
          AND ls.seen_at > now() - interval '2 weeks'
      ) as reappeared_recently
    FROM consecutive_runs cr
  ),
  suspects AS (
    SELECT 
      listing_uuid,
      listing_id,
      make,
      model,
      total_weeks,
      max_gap_days
    FROM gap_analysis
    WHERE max_gap_days IS NOT NULL
      AND reappeared_recently = true
  )
  -- Update the flagged vehicles
  UPDATE vehicle_listings vl
  SET 
    sold_returned_suspected = true,
    sold_returned_reason = format(
      'Seen %s weeks, disappeared for %s days, then reappeared. Pattern suggests sold-then-returned.',
      s.total_weeks,
      s.max_gap_days
    ),
    sold_returned_flagged_at = now()
  FROM suspects s
  WHERE vl.id = s.listing_uuid;
  
  GET DIAGNOSTICS v_flagged_count = ROW_COUNT;
  
  -- Return the flagged vehicles
  RETURN QUERY
  SELECT 
    s.listing_id,
    s.listing_uuid,
    format('Seen %s weeks, gap of %s days, then reappeared', s.total_weeks, s.max_gap_days) as reason,
    v_flagged_count as flagged_count
  FROM suspects s;
END;
$$;

-- Grant execute to authenticated users (for RPC calls)
GRANT EXECUTE ON FUNCTION public.detect_sold_returned_suspects() TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_sold_returned_suspects() TO service_role;