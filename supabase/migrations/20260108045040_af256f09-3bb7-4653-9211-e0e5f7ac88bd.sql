-- Create stale_dealer_grade view for derive_clearance_events function
-- This view identifies dealer-grade listings that haven't been seen recently (stale)
CREATE OR REPLACE VIEW public.stale_dealer_grade AS
SELECT 
  vl.id,
  vl.listing_id,
  vl.make,
  vl.model,
  vl.year,
  vl.status,
  vl.first_seen_at,
  vl.last_seen_at,
  vl.source,
  vl.is_dealer_grade,
  EXTRACT(EPOCH FROM (now() - vl.last_seen_at)) / 3600 AS hours_since_seen
FROM vehicle_listings vl
WHERE vl.is_dealer_grade = true
  AND vl.status NOT IN ('cleared', 'passed_in', 'sold')
  AND vl.last_seen_at < now() - interval '48 hours';