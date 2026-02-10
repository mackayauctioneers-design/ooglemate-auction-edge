
-- Add fingerprint type fields to sales_target_candidates
ALTER TABLE public.sales_target_candidates
  ADD COLUMN IF NOT EXISTS fingerprint_type text NOT NULL DEFAULT 'core',
  ADD COLUMN IF NOT EXISTS confidence_level text NOT NULL DEFAULT 'high',
  ADD COLUMN IF NOT EXISTS outcome_verified boolean NOT NULL DEFAULT false;

-- Add constraint for valid fingerprint_type values
ALTER TABLE public.sales_target_candidates
  DROP CONSTRAINT IF EXISTS chk_fingerprint_type;

-- Use a trigger instead of CHECK for flexibility
CREATE OR REPLACE FUNCTION public.validate_fingerprint_type()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.fingerprint_type NOT IN ('core', 'outcome') THEN
    RAISE EXCEPTION 'fingerprint_type must be core or outcome';
  END IF;
  IF NEW.confidence_level NOT IN ('low', 'medium', 'high') THEN
    RAISE EXCEPTION 'confidence_level must be low, medium, or high';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_fingerprint_type ON public.sales_target_candidates;
CREATE TRIGGER trg_validate_fingerprint_type
  BEFORE INSERT OR UPDATE ON public.sales_target_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_fingerprint_type();

-- Index for filtering by fingerprint type
CREATE INDEX IF NOT EXISTS idx_stc_fingerprint_type ON public.sales_target_candidates (account_id, fingerprint_type, status);

-- Update existing records: set them to core/high (they all have sales_count >= 3)
UPDATE public.sales_target_candidates
SET fingerprint_type = 'core',
    confidence_level = CASE
      WHEN sales_count >= 10 THEN 'high'
      WHEN sales_count >= 5 THEN 'medium'
      ELSE 'high'
    END,
    outcome_verified = true
WHERE fingerprint_type = 'core';
