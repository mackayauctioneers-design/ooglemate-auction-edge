-- Fix: Drop old dedup_key constraint and use canonical_id for upsert
-- Also add canonical_id to hunt_unified_candidates

-- 1) Drop the old dedup_key unique index (conflicts with canonical_id upsert)
DROP INDEX IF EXISTS idx_hunt_external_candidates_dedup;

-- 2) Add canonical_id to hunt_unified_candidates if missing
ALTER TABLE public.hunt_unified_candidates
  ADD COLUMN IF NOT EXISTS canonical_id text;

-- 3) Create index on canonical_id for hunt_unified_candidates
CREATE INDEX IF NOT EXISTS idx_huc_canonical ON public.hunt_unified_candidates(canonical_id);

-- 4) Update rpc_build_unified_candidates to include canonical_id
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
  SELECT criteria_version
  INTO v_criteria_version
  FROM sale_hunts
  WHERE id = p_hunt_id;

  IF v_criteria_version IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Hunt not found');
  END IF;

  DELETE FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id
    AND criteria_version = v_criteria_version;

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
    candidate_stage,
    rank_position,
    created_at
  )
  SELECT
    hec.hunt_id,
    hec.criteria_version,
    'external',
    hec.source_name,
    hec.source_url,
    hec.canonical_id,
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
      ELSE 'other'
    END,
    'DISCOVERED',
    COALESCE(hec.listing_intent, fn_is_listing_intent(hec.source_url, hec.title, hec.raw_snippet)),
    'DISCOVERED',
    0,
    now()
  FROM hunt_external_candidates hec
  WHERE hec.hunt_id = p_hunt_id
    AND hec.criteria_version = v_criteria_version
    AND hec.is_stale = false
    AND COALESCE(hec.listing_intent, fn_is_listing_intent(hec.source_url, hec.title, hec.raw_snippet)) != 'non_listing'
  ON CONFLICT (hunt_id, criteria_version, canonical_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Rank: auction → marketplace → other, then cheapest
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