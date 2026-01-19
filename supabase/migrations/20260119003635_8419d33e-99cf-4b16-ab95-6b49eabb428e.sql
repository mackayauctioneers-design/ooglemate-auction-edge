
-- Fix unified candidates builder to exclude rejected candidates
CREATE OR REPLACE FUNCTION rpc_build_unified_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_criteria_version int;
  v_inserted int := 0;
BEGIN
  SELECT criteria_version
  INTO v_criteria_version
  FROM sale_hunts
  WHERE id = p_hunt_id;

  IF v_criteria_version IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Hunt not found');
  END IF;

  -- Clear existing unified candidates for this version
  DELETE FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id
    AND criteria_version = v_criteria_version;

  -- Insert external candidates with guaranteed canonical_id
  -- CRITICAL: Exclude rejected candidates (decision = 'IGNORE' OR reject_reason IS NOT NULL)
  INSERT INTO hunt_unified_candidates (
    hunt_id,
    criteria_version,
    source_type,
    source,
    url,
    canonical_id,
    title,
    year,
    make,
    model,
    variant_raw,
    km,
    price,
    location,
    source_tier,
    source_class,
    decision,
    listing_intent,
    rank_position,
    created_at
  )
  SELECT
    hec.hunt_id,
    hec.criteria_version,
    'external',
    hec.source_name,
    hec.source_url,
    COALESCE(
      NULLIF(hec.canonical_id, ''),
      fn_canonical_listing_id(hec.source_url),
      'md5:' || md5(hec.source_url)
    ),
    hec.title,
    hec.year,
    hec.make,
    hec.model,
    hec.variant_raw,
    hec.km,
    hec.asking_price,
    hec.location,
    COALESCE(hec.source_tier, fn_source_tier(hec.source_url)),
    CASE 
      WHEN hec.source_url ~* '(pickles|manheim|grays|lloyds)' THEN 'auction'
      WHEN hec.source_url ~* '(carsales|autotrader|gumtree)' THEN 'marketplace'
      ELSE 'dealer'
    END,
    'DISCOVERED',
    COALESCE(hec.listing_intent, fn_is_listing_intent(hec.source_url, hec.title, hec.raw_snippet)),
    0,
    now()
  FROM hunt_external_candidates hec
  WHERE hec.hunt_id = p_hunt_id
    AND hec.criteria_version = v_criteria_version
    AND hec.is_stale = false
    -- NEW: Exclude rejected candidates
    AND hec.decision != 'IGNORE'
    AND hec.reject_reason IS NULL
    -- Existing: Exclude non-listings by intent
    AND COALESCE(hec.listing_intent, fn_is_listing_intent(hec.source_url, hec.title, hec.raw_snippet)) != 'non_listing';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Rank: auction (tier 1) → marketplace (tier 2) → dealer (tier 3), then cheapest
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        ORDER BY
          source_tier ASC,
          price ASC NULLS LAST,
          created_at ASC
      ) AS rn
    FROM hunt_unified_candidates
    WHERE hunt_id = p_hunt_id
      AND criteria_version = v_criteria_version
  )
  UPDATE hunt_unified_candidates h
  SET rank_position = r.rn
  FROM ranked r
  WHERE h.id = r.id;

  RETURN jsonb_build_object(
    'success', true,
    'hunt_id', p_hunt_id,
    'criteria_version', v_criteria_version,
    'inserted', v_inserted
  );
END;
$$;
