-- Fix remaining null canonical_ids with deterministic fallback
-- Use source + md5(url) since fn_canonical_listing_id might return NULL for some sources
UPDATE hunt_unified_candidates
SET canonical_id = source || ':' || md5(url)
WHERE canonical_id IS NULL;

-- Now set NOT NULL constraint
ALTER TABLE hunt_unified_candidates
ALTER COLUMN canonical_id SET NOT NULL;