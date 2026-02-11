-- Add sold_at timestamp for market velocity tracking
ALTER TABLE hunt_external_candidates
  ADD COLUMN IF NOT EXISTS sold_at timestamptz;