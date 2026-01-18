-- ============================================================
-- Kiting Mode: Discovery-First Pipeline (Phase-1 Only)
-- NO PRICE LOGIC, NO BUY/WATCH, NO GAP, NO EXIT VALUE
-- Auction-first, identity-first, price-agnostic
-- ============================================================

-- Drop existing functions that have conflicting signatures
DROP FUNCTION IF EXISTS public.fn_is_listing_intent(text, text, text);
DROP FUNCTION IF EXISTS public.fn_canonical_listing_id(text);
DROP FUNCTION IF EXISTS public.fn_source_tier(text);
DROP FUNCTION IF EXISTS public.rpc_build_unified_candidates(uuid);

-- 1️⃣ Canonical listing ID (prevents over-dedupe)
CREATE OR REPLACE FUNCTION public.fn_canonical_listing_id(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_url ~* 'pickles\.com\.au/.*/lot/([0-9]+)'
        THEN 'pickles:' || regexp_replace(p_url, '.*lot/([0-9]+).*', '\1')
      WHEN p_url ~* 'manheim\.com\.au/.*/vehicle/([0-9]+)'
        THEN 'manheim:' || regexp_replace(p_url, '.*vehicle/([0-9]+).*', '\1')
      WHEN p_url ~* 'grays\.com/.*/lot/([0-9]+)'
        THEN 'grays:' || regexp_replace(p_url, '.*lot/([0-9]+).*', '\1')
      ELSE md5(p_url)
    END;
$$;

-- 2️⃣ Listing intent (auction-biased, very permissive)
CREATE OR REPLACE FUNCTION public.fn_is_listing_intent(
  p_url text,
  p_title text,
  p_snippet text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- AUCTION SITES = ALWAYS LISTING
  IF p_url ~* '(pickles|manheim|grays|lloyds)' THEN
    RETURN 'listing';
  END IF;

  -- MARKETPLACES
  IF p_url ~* '(carsales|autotrader|gumtree)' THEN
    RETURN 'listing';
  END IF;

  -- Hard reject editorial
  IF p_url ~* '(news|review|guide|spec|pricing)' THEN
    RETURN 'non_listing';
  END IF;

  RETURN 'unknown';
END;
$$;

-- 3️⃣ Source tier (auction always first)
CREATE OR REPLACE FUNCTION public.fn_source_tier(p_url text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_url ~* '(pickles|manheim|grays|lloyds)' THEN 1
    WHEN p_url ~* '(carsales|autotrader|gumtree)' THEN 2
    ELSE 3
  END;
$$;

-- 4️⃣ DISCOVERY-ONLY unified build (THE FIX)
-- ⚠️ NO PRICE LOGIC, NO BUY/WATCH, NO GAP, NO EXIT VALUE
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
    fn_canonical_listing_id(hec.source_url),
    hec.title,
    hec.year,
    hec.make,
    hec.model,
    hec.variant_raw,
    hec.km,
    hec.asking_price,
    hec.location,
    fn_source_tier(hec.source_url),
    CASE
      WHEN hec.source_url ~* '(pickles|manheim|grays|lloyds)' THEN 'auction'
      WHEN hec.source_url ~* '(carsales|autotrader|gumtree)' THEN 'marketplace'
      ELSE 'other'
    END,
    'DISCOVERED',
    fn_is_listing_intent(hec.source_url, hec.title, hec.raw_snippet),
    'DISCOVERED',
    0,
    now()
  FROM hunt_external_candidates hec
  WHERE hec.hunt_id = p_hunt_id
    AND hec.criteria_version = v_criteria_version
    AND hec.is_stale = false
    AND fn_is_listing_intent(hec.source_url, hec.title, hec.raw_snippet) != 'non_listing'
  ON CONFLICT (hunt_id, criteria_version, canonical_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Rank: auction → marketplace → dealer, then cheapest
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