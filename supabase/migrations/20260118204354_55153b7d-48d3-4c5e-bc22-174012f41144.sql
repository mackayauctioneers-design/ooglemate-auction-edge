-- Fix: Remove ON CONFLICT since we DELETE first anyway
CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_criteria_version int;
  v_inserted int := 0;
BEGIN
  SELECT criteria_version INTO v_criteria_version FROM sale_hunts WHERE id = p_hunt_id;
  IF v_criteria_version IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Hunt not found');
  END IF;

  DELETE FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version;

  INSERT INTO hunt_unified_candidates (hunt_id, criteria_version, source_type, source, url, canonical_id, title, year, make, model, variant_raw, km, price, location, source_tier, source_class, decision, listing_intent, candidate_stage, rank_position, created_at)
  SELECT hec.hunt_id, hec.criteria_version, 'external', hec.source_name, hec.source_url, hec.canonical_id, hec.title, hec.year, hec.make, hec.model, hec.variant_raw, hec.km, hec.asking_price, hec.location, COALESCE(hec.source_tier, 3),
    CASE WHEN hec.source_url ~* '(pickles|manheim|grays|lloyds)' THEN 'auction' WHEN hec.source_url ~* '(carsales|autotrader|gumtree)' THEN 'marketplace' ELSE 'other' END,
    'DISCOVERED', COALESCE(hec.listing_intent, 'unknown'), 'DISCOVERED', 0, now()
  FROM hunt_external_candidates hec
  WHERE hec.hunt_id = p_hunt_id AND hec.criteria_version = v_criteria_version AND hec.is_stale = false AND COALESCE(hec.listing_intent,'unknown') != 'non_listing';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  WITH ranked AS (SELECT id, ROW_NUMBER() OVER (ORDER BY source_tier ASC, price ASC NULLS LAST, created_at ASC) AS rn FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id AND criteria_version = v_criteria_version)
  UPDATE hunt_unified_candidates h SET rank_position = r.rn FROM ranked r WHERE h.id = r.id;

  RETURN jsonb_build_object('success', true, 'hunt_id', p_hunt_id, 'criteria_version', v_criteria_version, 'inserted', v_inserted);
END;
$$;