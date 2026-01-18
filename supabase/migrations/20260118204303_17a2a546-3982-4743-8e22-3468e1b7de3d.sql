-- Create unique constraint for hunt_unified_candidates ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS ux_huc_hunt_version_canonical 
  ON public.hunt_unified_candidates(hunt_id, criteria_version, canonical_id)
  WHERE canonical_id IS NOT NULL;