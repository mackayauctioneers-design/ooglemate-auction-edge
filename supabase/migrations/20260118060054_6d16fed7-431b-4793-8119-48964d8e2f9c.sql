-- Add unique constraint for ON CONFLICT clause
ALTER TABLE public.hunt_unified_candidates 
DROP CONSTRAINT IF EXISTS hunt_unified_candidates_hunt_version_url_unique;

ALTER TABLE public.hunt_unified_candidates 
ADD CONSTRAINT hunt_unified_candidates_hunt_version_url_unique 
UNIQUE (hunt_id, criteria_version, url);