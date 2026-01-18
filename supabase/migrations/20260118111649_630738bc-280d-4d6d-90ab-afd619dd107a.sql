-- ============================================================
-- Kiting Mode: Phase-1 DISCOVERY (no price/gap gating) + Phase-2 EVALUATE
-- ============================================================

-- 0) Add a stage column so we can separate "discovered pool" vs "watch/buy"
ALTER TABLE public.hunt_unified_candidates
  ADD COLUMN IF NOT EXISTS candidate_stage text DEFAULT 'DISCOVERED';

-- Normalize any existing rows
UPDATE public.hunt_unified_candidates
SET candidate_stage = 'DISCOVERED'
WHERE candidate_stage IS NULL;

-- Helpful index
CREATE INDEX IF NOT EXISTS idx_huc_stage
  ON public.hunt_unified_candidates(hunt_id, criteria_version, candidate_stage, decision);

-- 1) Discovery-first builder: ALWAYS populates DISCOVERED pool
DROP FUNCTION IF EXISTS public.rpc_build_unified_candidates(uuid);

CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt record;
  v_version int;
  v_internal int := 0;
  v_outward int := 0;
BEGIN
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Hunt not found');
  END IF;

  v_version := v_hunt.criteria_version;

  -- wipe this version and rebuild clean
  DELETE FROM public.hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_version;

  -- A) INTERNAL / INGESTED POOL
  INSERT INTO public.hunt_unified_candidates (
    hunt_id, criteria_version,
    source_type, source, url, title,
    year, make, model, variant_raw, km, price, location,
    source_tier, source_class,
    series_family, engine_family, body_type, cab_type, badge,
    listing_intent, listing_intent_reason, verified,
    dna_score, match_score, rank_score,
    decision, blocked_reason,
    candidate_stage,
    created_at
  )
  SELECT
    p_hunt_id, v_version,
    'internal'::text,
    COALESCE(rl.source,'internal')::text,
    rl.listing_url,
    COALESCE(rl.title, (rl.year::text || ' ' || rl.make || ' ' || rl.model))::text,
    rl.year, rl.make, rl.model, rl.variant_raw,
    rl.km,
    rl.asking_price,
    COALESCE(rl.suburb, rl.state)::text,
    CASE
      WHEN lower(COALESCE(rl.source,'')) ~ '(pickles|manheim|grays|lloyds|slattery)' THEN 1
      WHEN lower(COALESCE(rl.source,'')) ~ '(carsales|autotrader|drive|gumtree)' THEN 2
      ELSE 3
    END AS source_tier,
    CASE
      WHEN lower(COALESCE(rl.source,'')) ~ '(pickles|manheim|grays|lloyds|slattery)' THEN 'auction'
      WHEN lower(COALESCE(rl.source,'')) ~ '(carsales|autotrader|drive|gumtree)' THEN 'marketplace'
      ELSE 'other'
    END AS source_class,
    NULLIF(rl.series_family,'UNKNOWN'),
    NULLIF(rl.engine_family,'UNKNOWN'),
    NULLIF(rl.body_type,'UNKNOWN'),
    NULLIF(rl.cab_type,'UNKNOWN'),
    NULLIF(rl.badge,'UNKNOWN'),
    COALESCE(NULLIF(rl.listing_intent,''),'unknown')::text,
    rl.listing_intent_reason,
    true,
    COALESCE(rl.match_score, 5.0) as dna_score,
    COALESCE(rl.match_score, 5.0) as match_score,
    COALESCE(rl.match_score, 5.0) as rank_score,
    CASE
      WHEN COALESCE(rl.listing_intent,'unknown') = 'non_listing' THEN 'IGNORE'
      WHEN v_hunt.required_series_family IS NOT NULL
       AND NULLIF(rl.series_family,'UNKNOWN') IS NOT NULL
       AND upper(NULLIF(rl.series_family,'UNKNOWN')) <> upper(v_hunt.required_series_family)
      THEN 'IGNORE'
      ELSE 'DISCOVERED'
    END AS decision,
    CASE
      WHEN COALESCE(rl.listing_intent,'unknown') = 'non_listing' THEN 'NOT_LISTING'
      WHEN v_hunt.required_series_family IS NOT NULL
       AND NULLIF(rl.series_family,'UNKNOWN') IS NOT NULL
       AND upper(NULLIF(rl.series_family,'UNKNOWN')) <> upper(v_hunt.required_series_family)
      THEN 'SERIES_MISMATCH'
      ELSE NULL
    END AS blocked_reason,
    'DISCOVERED'::text AS candidate_stage,
    now()
  FROM public.retail_listings rl
  WHERE upper(rl.make) = upper(v_hunt.make)
    AND upper(rl.model) = upper(v_hunt.model)
    AND rl.lifecycle_status = 'active';

  GET DIAGNOSTICS v_internal = ROW_COUNT;

  -- B) OUTWARD / WEB DISCOVERY POOL
  INSERT INTO public.hunt_unified_candidates (
    hunt_id, criteria_version,
    source_type, source, url, title,
    year, make, model, variant_raw, km, price, location,
    source_tier, source_class,
    series_family, engine_family, body_type, cab_type, badge,
    listing_intent, listing_intent_reason, verified,
    dna_score, match_score, rank_score,
    decision, blocked_reason,
    candidate_stage,
    created_at
  )
  SELECT
    p_hunt_id, v_version,
    'outward'::text,
    COALESCE(hec.source_name,'web')::text,
    hec.source_url,
    COALESCE(hec.title, hec.make || ' ' || hec.model)::text,
    hec.year, hec.make, hec.model, hec.variant_raw,
    hec.km,
    hec.asking_price,
    hec.location,
    CASE
      WHEN lower(COALESCE(hec.source_name,'')) ~ '(pickles|manheim|grays|lloyds|slattery)'
        OR lower(COALESCE(hec.source_url,'')) ~ '(pickles\.com\.au|manheim\.com\.au|grays\.com|lloydsauctions\.com\.au)'
      THEN 1
      WHEN lower(COALESCE(hec.source_name,'')) ~ '(carsales|autotrader|drive|gumtree)'
        OR lower(COALESCE(hec.source_url,'')) ~ '(carsales\.com\.au|autotrader\.com\.au|drive\.com\.au|gumtree\.com\.au)'
      THEN 2
      ELSE 3
    END AS source_tier,
    CASE
      WHEN lower(COALESCE(hec.source_name,'')) ~ '(pickles|manheim|grays|lloyds|slattery)'
        OR lower(COALESCE(hec.source_url,'')) ~ '(pickles\.com\.au|manheim\.com\.au|grays\.com|lloydsauctions\.com\.au)'
      THEN 'auction'
      WHEN lower(COALESCE(hec.source_name,'')) ~ '(carsales|autotrader|drive|gumtree)'
        OR lower(COALESCE(hec.source_url,'')) ~ '(carsales\.com\.au|autotrader\.com\.au|drive\.com\.au|gumtree\.com\.au)'
      THEN 'marketplace'
      ELSE 'other'
    END AS source_class,
    NULLIF(hec.series_family,'UNKNOWN'),
    NULLIF(hec.engine_family,'UNKNOWN'),
    NULLIF(hec.body_type,'UNKNOWN'),
    NULLIF(hec.cab_type,'UNKNOWN'),
    NULLIF(hec.badge,'UNKNOWN'),
    COALESCE(NULLIF(hec.listing_intent,''),'unknown')::text,
    hec.listing_intent_reason,
    COALESCE(hec.verified,false),
    COALESCE(hec.match_score, 5.0) as dna_score,
    COALESCE(hec.match_score, 5.0) as match_score,
    COALESCE(hec.match_score, 5.0) as rank_score,
    CASE
      WHEN COALESCE(hec.listing_intent,'unknown') = 'non_listing' THEN 'IGNORE'
      WHEN v_hunt.required_series_family IS NOT NULL
       AND NULLIF(hec.series_family,'UNKNOWN') IS NOT NULL
       AND upper(NULLIF(hec.series_family,'UNKNOWN')) <> upper(v_hunt.required_series_family)
      THEN 'IGNORE'
      ELSE 'DISCOVERED'
    END AS decision,
    CASE
      WHEN COALESCE(hec.listing_intent,'unknown') = 'non_listing' THEN 'NOT_LISTING'
      WHEN v_hunt.required_series_family IS NOT NULL
       AND NULLIF(hec.series_family,'UNKNOWN') IS NOT NULL
       AND upper(NULLIF(hec.series_family,'UNKNOWN')) <> upper(v_hunt.required_series_family)
      THEN 'SERIES_MISMATCH'
      ELSE NULL
    END AS blocked_reason,
    'DISCOVERED'::text AS candidate_stage,
    now()
  FROM public.hunt_external_candidates hec
  WHERE hec.hunt_id = p_hunt_id
    AND hec.criteria_version = v_version
    AND hec.is_stale = false;

  GET DIAGNOSTICS v_outward = ROW_COUNT;

  -- Rank positions
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY hunt_id, criteria_version
             ORDER BY
               CASE decision WHEN 'DISCOVERED' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'BUY' THEN 3 WHEN 'UNVERIFIED' THEN 4 ELSE 5 END,
               source_tier ASC,
               price ASC NULLS LAST,
               dna_score DESC NULLS LAST,
               created_at DESC
           ) AS rn
    FROM public.hunt_unified_candidates
    WHERE hunt_id = p_hunt_id AND criteria_version = v_version
  )
  UPDATE public.hunt_unified_candidates h
  SET rank_position = r.rn
  FROM ranked r
  WHERE h.id = r.id;

  RETURN jsonb_build_object(
    'success', true,
    'hunt_id', p_hunt_id,
    'criteria_version', v_version,
    'internal_inserted', v_internal,
    'outward_inserted', v_outward
  );
END;
$$;

-- 2) Phase-2 evaluation: convert DISCOVERED → WATCH/BUY
DROP FUNCTION IF EXISTS public.rpc_evaluate_candidates(uuid);

CREATE OR REPLACE FUNCTION public.rpc_evaluate_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt record;
  v_version int;
  v_buy int := 0;
  v_watch int := 0;
BEGIN
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Hunt not found');
  END IF;

  v_version := v_hunt.criteria_version;

  -- Promote DISCOVERED → BUY/WATCH
  UPDATE public.hunt_unified_candidates
  SET
    decision =
      CASE
        WHEN verified = true AND price IS NOT NULL AND COALESCE(dna_score,0) >= 7.0 THEN 'BUY'
        WHEN COALESCE(dna_score,0) >= 5.0 THEN 'WATCH'
        ELSE 'DISCOVERED'
      END,
    candidate_stage =
      CASE
        WHEN verified = true AND price IS NOT NULL AND COALESCE(dna_score,0) >= 7.0 THEN 'MONITORED'
        WHEN COALESCE(dna_score,0) >= 5.0 THEN 'MONITORED'
        ELSE 'DISCOVERED'
      END
  WHERE hunt_id = p_hunt_id
    AND criteria_version = v_version
    AND decision = 'DISCOVERED'
    AND COALESCE(blocked_reason,'') = '';

  SELECT COUNT(*) INTO v_buy
  FROM public.hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_version AND decision = 'BUY';

  SELECT COUNT(*) INTO v_watch
  FROM public.hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_version AND decision = 'WATCH';

  RETURN jsonb_build_object(
    'success', true,
    'hunt_id', p_hunt_id,
    'criteria_version', v_version,
    'buy', v_buy,
    'watch', v_watch
  );
END;
$$;

-- 3) Get candidates for UI: include DISCOVERED by default
DROP FUNCTION IF EXISTS public.rpc_get_unified_candidates(uuid, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.rpc_get_unified_candidates(
  p_hunt_id uuid,
  p_decision_filter text DEFAULT NULL,
  p_source_filter text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  hunt_id uuid,
  criteria_version int,
  candidate_stage text,
  decision text,
  source_type text,
  source text,
  source_tier int,
  source_class text,
  url text,
  title text,
  year int,
  make text,
  model text,
  variant_raw text,
  km int,
  price int,
  location text,
  dna_score numeric,
  verified boolean,
  blocked_reason text,
  rank_position int,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version int;
BEGIN
  SELECT criteria_version INTO v_version FROM sale_hunts WHERE id = p_hunt_id;

  RETURN QUERY
  SELECT
    h.id, h.hunt_id, h.criteria_version, h.candidate_stage, h.decision,
    h.source_type, h.source, h.source_tier, h.source_class,
    h.url, h.title, h.year, h.make, h.model, h.variant_raw, h.km, h.price, h.location,
    h.dna_score, h.verified, h.blocked_reason, h.rank_position, h.created_at
  FROM public.hunt_unified_candidates h
  WHERE h.hunt_id = p_hunt_id
    AND h.criteria_version = v_version
    AND (p_decision_filter IS NULL OR h.decision = p_decision_filter)
    AND (p_source_filter IS NULL OR h.source_type = p_source_filter)
  ORDER BY
    CASE h.decision WHEN 'DISCOVERED' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'BUY' THEN 3 WHEN 'UNVERIFIED' THEN 4 ELSE 5 END,
    h.source_tier ASC,
    h.price ASC NULLS LAST,
    h.dna_score DESC NULLS LAST,
    h.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;