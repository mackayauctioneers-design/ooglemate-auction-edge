
CREATE OR REPLACE FUNCTION public.rpc_purge_stale_pickles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dead_count int := 0;
  v_expired_candidates int := 0;
  v_dead_aa int := 0;
  v_expired_aa int := 0;
  v_expired_ops int := 0;
BEGIN
  -- Mark vehicle_listings as DEAD if Pickles and unseen 48h+
  UPDATE vehicle_listings
  SET lifecycle_state = 'DEAD'
  WHERE source ILIKE '%pickles%'
    AND lifecycle_state IN ('NEW', 'WATCH')
    AND last_seen_at < now() - interval '48 hours';
  GET DIAGNOSTICS v_dead_count = ROW_COUNT;

  -- Mark vehicle_listings as DEAD if Auto Auctions and unseen 48h+
  UPDATE vehicle_listings
  SET lifecycle_state = 'DEAD'
  WHERE source = 'auto_auctions'
    AND lifecycle_state IN ('NEW', 'WATCH')
    AND last_seen_at < now() - interval '48 hours';
  GET DIAGNOSTICS v_dead_aa = ROW_COUNT;

  -- Mark hunt_external_candidates as expired if Pickles and unseen 48h+
  UPDATE hunt_external_candidates
  SET lifecycle_status = 'expired',
      last_lifecycle_check_at = now(),
      lifecycle_reason = 'pickles:auto_purge_48h'
  WHERE source_name ILIKE '%pickles%'
    AND lifecycle_status = 'active'
    AND last_lifecycle_check_at < now() - interval '48 hours';
  GET DIAGNOSTICS v_expired_candidates = ROW_COUNT;

  -- Mark hunt_external_candidates as expired if Auto Auctions and unseen 48h+
  UPDATE hunt_external_candidates
  SET lifecycle_status = 'expired',
      last_lifecycle_check_at = now(),
      lifecycle_reason = 'auto_auctions:auto_purge_48h'
  WHERE source_name ILIKE '%auto_auctions%'
    AND lifecycle_status = 'active'
    AND last_lifecycle_check_at < now() - interval '48 hours';
  GET DIAGNOSTICS v_expired_aa = ROW_COUNT;

  -- Expire operator_opportunities for auction sources unseen 48h+
  UPDATE operator_opportunities
  SET status = 'expired', updated_at = now()
  WHERE status IN ('new', 'reviewed', 'assigned')
    AND is_starred = false
    AND auction_house IN ('pickles', 'Auto Auctions')
    AND updated_at < now() - interval '48 hours';
  GET DIAGNOSTICS v_expired_ops = ROW_COUNT;

  RETURN jsonb_build_object(
    'dead_listings_pickles', v_dead_count,
    'dead_listings_auto_auctions', v_dead_aa,
    'expired_candidates_pickles', v_expired_candidates,
    'expired_candidates_auto_auctions', v_expired_aa,
    'expired_opportunities', v_expired_ops
  );
END;
$$;
