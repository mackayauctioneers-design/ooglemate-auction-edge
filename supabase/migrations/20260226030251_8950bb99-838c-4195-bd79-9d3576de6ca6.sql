-- Function to cross-check operator_opportunities against vehicle_listings lifecycle
CREATE OR REPLACE FUNCTION public.reconcile_dead_opportunities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE operator_opportunities o
  SET status = 'expired',
      updated_at = now()
  FROM vehicle_listings vl
  WHERE o.listing_id = concat(vl.source, ':', vl.listing_id)
    AND o.status IN ('new', 'assigned')
    AND vl.lifecycle_state IN ('DEAD', 'SOLD', 'STALE', 'INVALID');

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;