-- Add fingerprint matching columns to outward_search_results
ALTER TABLE outward_search_results
  ADD COLUMN IF NOT EXISTS fingerprint_id     text,
  ADD COLUMN IF NOT EXISTS match_score        integer,
  ADD COLUMN IF NOT EXISTS margin_estimate    numeric,
  ADD COLUMN IF NOT EXISTS margin_band_low    numeric,
  ADD COLUMN IF NOT EXISTS margin_band_high   numeric,
  ADD COLUMN IF NOT EXISTS retail_truth       numeric,
  ADD COLUMN IF NOT EXISTS confidence         text,
  ADD COLUMN IF NOT EXISTS match_reasons      jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS scored_at          timestamptz,
  ADD COLUMN IF NOT EXISTS status             text NOT NULL DEFAULT 'pending_score';

-- Add validation trigger instead of CHECK constraints (immutability-safe)
CREATE OR REPLACE FUNCTION public.validate_osr_confidence_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.confidence IS NOT NULL AND NEW.confidence NOT IN ('HIGH', 'MEDIUM', 'LOW') THEN
    RAISE EXCEPTION 'confidence must be HIGH, MEDIUM, or LOW';
  END IF;
  IF NEW.status NOT IN ('pending_score', 'scored', 'no_match', 'deduped') THEN
    RAISE EXCEPTION 'status must be pending_score, scored, no_match, or deduped';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_osr_confidence_status
  BEFORE INSERT OR UPDATE ON outward_search_results
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_osr_confidence_status();

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_osr_status 
  ON outward_search_results(status);

CREATE INDEX IF NOT EXISTS idx_osr_fingerprint_id 
  ON outward_search_results(fingerprint_id) 
  WHERE fingerprint_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_osr_scored_at
  ON outward_search_results(scored_at)
  WHERE scored_at IS NOT NULL;