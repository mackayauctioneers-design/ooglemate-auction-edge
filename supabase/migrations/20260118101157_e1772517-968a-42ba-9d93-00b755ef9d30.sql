-- Add rpc_get_live_matches_count if it doesn't exist
CREATE OR REPLACE FUNCTION public.rpc_get_live_matches_count(p_hunt_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_criteria_version int;
  v_count int;
BEGIN
  SELECT sh.criteria_version INTO v_criteria_version
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  SELECT COUNT(*)::int INTO v_count
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_criteria_version
    AND huc.decision <> 'IGNORE';

  RETURN v_count;
END;
$$;