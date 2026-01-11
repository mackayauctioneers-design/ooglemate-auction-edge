-- Add preflight and parser profile columns to auction_sources
ALTER TABLE public.auction_sources 
  ADD COLUMN IF NOT EXISTS preflight_status TEXT DEFAULT 'pending' CHECK (preflight_status IN ('pending', 'pass', 'fail', 'blocked', 'timeout')),
  ADD COLUMN IF NOT EXISTS preflight_checked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS preflight_reason TEXT,
  ADD COLUMN IF NOT EXISTS preflight_markers JSONB,
  ADD COLUMN IF NOT EXISTS parser_profile TEXT DEFAULT 'bidsonline_default' CHECK (parser_profile IN ('bidsonline_default', 'bidsonline_grid', 'bidsonline_table', 'custom_f3', 'custom_valley')),
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_disabled_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS auto_disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'candidate' CHECK (validation_status IN ('candidate', 'validating', 'validated', 'disabled_invalid_url', 'disabled_blocked', 'disabled_unsupported')),
  ADD COLUMN IF NOT EXISTS validation_runs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS successful_validation_runs INTEGER DEFAULT 0;

-- Add index for enabled sources ready for crawl
CREATE INDEX IF NOT EXISTS idx_auction_sources_enabled_preflight 
  ON auction_sources(enabled, preflight_status) 
  WHERE enabled = true;

-- Update existing sources to require preflight before enabling
UPDATE auction_sources 
SET enabled = false, 
    validation_status = 'candidate',
    preflight_status = 'pending'
WHERE source_key = 'autoauctions_sydney';

COMMENT ON COLUMN auction_sources.preflight_status IS 'Result of last preflight check: pending/pass/fail/blocked/timeout';
COMMENT ON COLUMN auction_sources.parser_profile IS 'Which parser variant to use for this source';
COMMENT ON COLUMN auction_sources.validation_status IS 'Overall validation state: candidate → validating → validated (auto-enable) or disabled_*';