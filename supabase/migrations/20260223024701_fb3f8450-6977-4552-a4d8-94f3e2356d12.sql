-- Auto-purge function: marks Pickles listings DEAD if unseen for 48h
-- Called by crosssafe lifecycle_sweep jobs
CREATE OR REPLACE FUNCTION public.rpc_purge_stale_pickles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dead_count int;
  v_expired_candidates int;
BEGIN
  -- Mark vehicle_listings as DEAD if Pickles and unseen 48h+
  UPDATE vehicle_listings
  SET lifecycle_state = 'DEAD'
  WHERE source ILIKE '%pickles%'
    AND lifecycle_state IN ('NEW', 'WATCH')
    AND last_seen_at < now() - interval '48 hours';
  GET DIAGNOSTICS v_dead_count = ROW_COUNT;

  -- Mark hunt_external_candidates as expired if Pickles and unseen 48h+
  UPDATE hunt_external_candidates
  SET lifecycle_status = 'expired',
      last_lifecycle_check_at = now(),
      lifecycle_reason = 'pickles:auto_purge_48h'
  WHERE source_name ILIKE '%pickles%'
    AND lifecycle_status = 'active'
    AND last_lifecycle_check_at < now() - interval '48 hours';
  GET DIAGNOSTICS v_expired_candidates = ROW_COUNT;

  RETURN jsonb_build_object(
    'dead_listings', v_dead_count,
    'expired_candidates', v_expired_candidates
  );
END;
$$;