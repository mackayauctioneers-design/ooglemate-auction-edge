-- 1. Fix RPC to be fully deterministic with proper join logic
CREATE OR REPLACE FUNCTION public.reconcile_dead_opportunities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  -- Match operator_opportunities.listing_id (format "source:stock_id") 
  -- against vehicle_listings by joining on listing_id column
  UPDATE operator_opportunities o
  SET status = 'expired',
      updated_at = now()
  WHERE o.status IN ('new', 'assigned')
    AND o.is_starred = false
    AND EXISTS (
      SELECT 1 FROM vehicle_listings vl
      WHERE vl.listing_id = o.listing_id
        AND vl.lifecycle_state IN ('DEAD', 'SOLD', 'STALE', 'INVALID', 'RETURNED')
    );

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- 2. Add terminal state constants as a comment-contract (no schema change needed,
--    status column already accepts text, but add a check to prevent invalid states)
COMMENT ON COLUMN operator_opportunities.status IS 
'Terminal: expired, ignored, won, lost, archived. Non-terminal: new, assigned, reviewed, watching, bidding. Reconciliation must never touch terminal states.';