
-- 1) Add lifecycle verification columns
ALTER TABLE hunt_external_candidates
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_lifecycle_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_http_status int,
  ADD COLUMN IF NOT EXISTS lifecycle_reason text,
  ADD COLUMN IF NOT EXISTS lifecycle_error text;

-- 2) Index for verifier queue
CREATE INDEX IF NOT EXISTS idx_hec_lifecycle_queue
ON hunt_external_candidates (lifecycle_status, last_lifecycle_check_at);

-- 3) Constrain to canonical statuses via trigger (not CHECK, per Supabase best practice)
CREATE OR REPLACE FUNCTION validate_lifecycle_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lifecycle_status NOT IN ('active', 'sold', 'expired') THEN
    RAISE EXCEPTION 'Invalid lifecycle_status: %. Must be active, sold, or expired.', NEW.lifecycle_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_lifecycle_status ON hunt_external_candidates;
CREATE TRIGGER trg_validate_lifecycle_status
  BEFORE INSERT OR UPDATE OF lifecycle_status ON hunt_external_candidates
  FOR EACH ROW EXECUTE FUNCTION validate_lifecycle_status();

-- 4) Normalize existing data: mark stale/expired rows
UPDATE hunt_external_candidates
SET lifecycle_status = 'expired'
WHERE (is_stale = true OR expired_at IS NOT NULL)
  AND lifecycle_status = 'active';

-- 5) RPC to pull a verify batch (source-aware scheduling)
CREATE OR REPLACE FUNCTION rpc_get_verify_batch(p_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  source_name text,
  source_url text,
  identity_key text,
  last_lifecycle_check_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    hec.id,
    hec.source_name,
    hec.source_url,
    hec.identity_key,
    hec.last_lifecycle_check_at
  FROM hunt_external_candidates hec
  WHERE hec.lifecycle_status = 'active'
    AND hec.source_url IS NOT NULL
    AND hec.source_url <> ''
    AND (
      hec.last_lifecycle_check_at IS NULL
      OR (
        hec.source_name ILIKE '%pickles%' AND hec.last_lifecycle_check_at < now() - interval '6 hours'
      )
      OR (
        hec.source_name NOT ILIKE '%pickles%' AND hec.last_lifecycle_check_at < now() - interval '24 hours'
      )
    )
  ORDER BY COALESCE(hec.last_lifecycle_check_at, '1970-01-01'::timestamptz) ASC
  LIMIT p_limit;
$$;
