-- Add missing score_adjusted column to hunt_matches
ALTER TABLE hunt_matches ADD COLUMN IF NOT EXISTS score_adjusted numeric;