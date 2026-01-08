-- Fix SECURITY DEFINER on stale_dealer_grade view
DROP VIEW IF EXISTS public.stale_dealer_grade;

CREATE VIEW public.stale_dealer_grade 
WITH (security_invoker = true) AS
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