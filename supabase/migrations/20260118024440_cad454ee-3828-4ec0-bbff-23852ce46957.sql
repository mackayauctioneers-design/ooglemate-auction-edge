-- Fix rpc_build_unified_candidates to match hunt_external_candidates schema
CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt RECORD;
  v_internal_count INT := 0;
  v_outward_count INT := 0;
  v_total_count INT := 0;
BEGIN
  -- Get hunt details
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF v_hunt IS NULL THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;

  -- Clear existing unified candidates for this hunt/version
  DELETE FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id 
  AND criteria_version = v_hunt.criteria_version;

  -- Insert internal candidates from hunt_matches
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source_listing_id, source, domain,
    year, make, model, variant_raw, km, price, url, location,
    dna_score, match_score, decision, reasons, source_tier, source_class,
    criteria_version, is_stale, created_at
  )
  SELECT 
    hm.hunt_id,
    'internal',
    hm.listing_id::text,
    COALESCE(rl.source, 'unknown'),
    CASE 
      WHEN rl.source = 'autotrader' THEN 'autotrader.com.au'
      WHEN rl.source = 'drive' THEN 'drive.com.au'
      WHEN rl.source = 'gumtree' THEN 'gumtree.com.au'
      ELSE rl.source
    END,
    rl.year,
    rl.make,
    rl.model,
    rl.variant_raw,
    rl.km,
    rl.asking_price,
    rl.listing_url,
    COALESCE(rl.suburb, rl.state),
    hm.match_score,
    hm.match_score,
    UPPER(hm.decision),
    hm.reasons,
    2, -- marketplace tier for internal sources
    'internal',
    hm.criteria_version,
    false,
    NOW()
  FROM hunt_matches hm
  JOIN retail_listings rl ON rl.id = hm.listing_id
  WHERE hm.hunt_id = p_hunt_id
  AND hm.criteria_version = v_hunt.criteria_version
  AND hm.is_stale = false
  AND hm.decision IN ('buy', 'watch', 'BUY', 'WATCH');

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- Insert outward candidates from hunt_external_candidates (DEDUPLICATED by base URL)
  -- Extract domain from source_url
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source_listing_id, source, domain,
    year, make, model, variant_raw, km, price, url, location, title,
    dna_score, match_score, decision, reasons, source_tier, source_class,
    criteria_version, is_stale, created_at
  )
  SELECT DISTINCT ON (REGEXP_REPLACE(hec.source_url, '\?.*$', ''))
    hec.hunt_id,
    'outward',
    hec.id::text,
    COALESCE(hec.source_name, 'firecrawl'),
    -- Extract domain from URL
    REGEXP_REPLACE(
      REGEXP_REPLACE(hec.source_url, '^https?://(www\.)?', ''),
      '/.*$', ''
    ),
    hec.year,
    hec.make,
    hec.model,
    hec.variant_raw,
    hec.km,
    hec.asking_price,
    hec.source_url,
    hec.location,
    hec.title,
    hec.match_score,
    hec.match_score,
    UPPER(COALESCE(hec.decision, 'WATCH')),
    ARRAY[hec.reject_reason]::text[],
    -- Source tier based on domain
    CASE 
      WHEN hec.source_url LIKE '%pickles%' OR hec.source_url LIKE '%manheim%' OR hec.source_url LIKE '%grays%' OR hec.source_url LIKE '%lloyds%' THEN 1
      WHEN hec.source_url LIKE '%carsales%' OR hec.source_url LIKE '%autotrader%' OR hec.source_url LIKE '%drive%' OR hec.source_url LIKE '%gumtree%' THEN 2
      ELSE 3
    END,
    CASE 
      WHEN hec.source_url LIKE '%pickles%' OR hec.source_url LIKE '%manheim%' OR hec.source_url LIKE '%grays%' OR hec.source_url LIKE '%lloyds%' THEN 'auction'
      WHEN hec.source_url LIKE '%carsales%' OR hec.source_url LIKE '%autotrader%' OR hec.source_url LIKE '%drive%' OR hec.source_url LIKE '%gumtree%' THEN 'marketplace'
      ELSE 'dealer'
    END,
    hec.criteria_version,
    false,
    NOW()
  FROM hunt_external_candidates hec
  WHERE hec.hunt_id = p_hunt_id
  AND hec.criteria_version = v_hunt.criteria_version
  AND hec.is_stale = false
  AND UPPER(hec.decision) IN ('BUY', 'WATCH')
  ORDER BY REGEXP_REPLACE(hec.source_url, '\?.*$', ''), hec.asking_price ASC NULLS LAST;

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  v_total_count := v_internal_count + v_outward_count;

  RETURN jsonb_build_object(
    'success', true,
    'hunt_id', p_hunt_id,
    'criteria_version', v_hunt.criteria_version,
    'internal_count', v_internal_count,
    'outward_count', v_outward_count,
    'total_count', v_total_count
  );
END;
$$;