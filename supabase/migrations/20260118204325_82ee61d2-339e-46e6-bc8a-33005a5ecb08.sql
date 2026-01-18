-- Fix: Make the constraint non-partial for ON CONFLICT to work
DROP INDEX IF EXISTS ux_huc_hunt_version_canonical;
CREATE UNIQUE INDEX ux_huc_hunt_version_canonical 
  ON public.hunt_unified_candidates(hunt_id, criteria_version, COALESCE(canonical_id, id::text));