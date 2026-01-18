-- Drop the old unique constraints that use URL (canonical_id is now the dedup key)
ALTER TABLE hunt_unified_candidates 
DROP CONSTRAINT IF EXISTS hunt_unified_candidates_hunt_version_url_unique;

ALTER TABLE hunt_unified_candidates 
DROP CONSTRAINT IF EXISTS hunt_unified_candidates_url_unique;

-- Drop the COALESCE-based unique index and recreate as strict
DROP INDEX IF EXISTS ux_huc_hunt_version_canonical;

-- Create clean unique index on canonical_id (no COALESCE since it's NOT NULL)
CREATE UNIQUE INDEX ux_huc_hunt_version_canonical 
ON hunt_unified_candidates(hunt_id, criteria_version, canonical_id);