-- Add heat score columns to hunt_matches table
ALTER TABLE hunt_matches 
ADD COLUMN IF NOT EXISTS exit_heat_score numeric,
ADD COLUMN IF NOT EXISTS exit_heat_source text;

-- Add index for heat-based queries
CREATE INDEX IF NOT EXISTS idx_hunt_matches_heat 
ON hunt_matches (exit_heat_score DESC NULLS LAST);

-- Comment for documentation
COMMENT ON COLUMN hunt_matches.exit_heat_score IS 'SA2 exit heat score (0-1) at time of match. Hot=easier to sell, cold=harder.';
COMMENT ON COLUMN hunt_matches.exit_heat_source IS 'Source of heat score: sa2_exact, state_avg, or default';