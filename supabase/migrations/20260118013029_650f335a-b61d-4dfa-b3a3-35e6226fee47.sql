
-- Fix the source_tier assignment in rpc_build_unified_candidates to use domain-based tier matching consistently
-- Also ensure the tier is correctly set from the start (not just patched by rpc_compute_rank_score later)

CREATE OR REPLACE FUNCTION public.rpc_build_unified_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hunt record;
  v_internal_count integer := 0;
  v_outward_count integer := 0;
  v_total_count integer := 0;
  v_min_price integer;
  v_max_price integer;
BEGIN
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF v_hunt.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;

  -- Clear existing unified candidates for this version
  DELETE FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id 
    AND criteria_version = v_hunt.criteria_version;

  -- Insert internal candidates with proper tier assignment based on domain patterns
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source, source_listing_id, url, title, year, make, model,
    variant_raw, km, price, location, domain, extracted, classification,
    match_score, dna_score, decision, reasons, criteria_version, is_stale, source_class, source_tier
  )
  SELECT 
    hm.hunt_id,
    'internal' as source_type,
    rl.source,
    rl.id::text as source_listing_id,
    COALESCE(rl.listing_url, 'internal://' || rl.id::text) as url,
    COALESCE(rl.title, rl.year || ' ' || rl.make || ' ' || rl.model) as title,
    rl.year,
    rl.make,
    rl.model,
    rl.variant_raw,
    rl.km,
    rl.asking_price as price,
    COALESCE(rl.suburb, rl.state) as location,
    COALESCE(
      CASE 
        WHEN rl.source = 'autotrader' THEN 'autotrader.com.au'
        WHEN rl.source = 'drive' THEN 'drive.com.au'
        WHEN rl.source LIKE 'gumtree%' THEN 'gumtree.com.au'
        WHEN rl.source = 'pickles' THEN 'pickles.com.au'
        WHEN rl.source = 'manheim' THEN 'manheim.com.au'
        WHEN rl.source = 'grays' THEN 'grays.com'
        WHEN rl.source = 'lloyds' THEN 'lloydsauctions.com.au'
        ELSE rl.source
      END, 
      'internal'
    ) as domain,
    jsonb_build_object(
      'badge', rl.badge,
      'body_type', rl.body_type,
      'engine_family', rl.engine_family,
      'enrichment_status', rl.enrichment_status
    ) as extracted,
    jsonb_build_object(
      'series_family', rl.series_family,
      'engine_family', rl.engine_family,
      'body_type', rl.body_type,
      'cab_type', rl.cab_type,
      'badge', rl.badge
    ) as classification,
    hm.match_score,
    COALESCE(hm.dna_score, hm.match_score) as dna_score,
    UPPER(hm.decision) as decision,
    hm.reasons,
    v_hunt.criteria_version,
    false as is_stale,
    -- source_class based on domain pattern
    CASE 
      WHEN rl.source IN ('pickles', 'manheim', 'grays', 'lloyds') THEN 'auction'
      WHEN rl.source IN ('autotrader', 'drive', 'gumtree', 'gumtree_dealer', 'carsales') THEN 'marketplace'
      ELSE 'internal'
    END as source_class,
    -- source_tier: 1=auction, 2=marketplace, 3=dealer/other
    CASE 
      WHEN rl.source IN ('pickles', 'manheim', 'grays', 'lloyds') THEN 1
      WHEN rl.source IN ('autotrader', 'drive', 'gumtree', 'gumtree_dealer', 'carsales') THEN 2
      ELSE 3
    END as source_tier
  FROM hunt_matches hm
  JOIN retail_listings rl ON rl.id = hm.listing_id
  WHERE hm.hunt_id = p_hunt_id
    AND hm.criteria_version = v_hunt.criteria_version
    AND hm.is_stale = false
    AND UPPER(hm.decision) IN ('BUY', 'WATCH');

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- Insert outward candidates with proper tier assignment based on domain patterns
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source, source_listing_id, url, title, year, make, model,
    variant_raw, km, price, location, domain, extracted, classification,
    match_score, dna_score, decision, reasons, alert_emitted, criteria_version, is_stale, source_class, source_tier
  )
  SELECT 
    oc.hunt_id,
    'outward' as source_type,
    COALESCE(oc.provider, 'firecrawl') as source,
    oc.id::text as source_listing_id,
    oc.url,
    oc.title,
    (oc.extracted->>'year')::integer as year,
    COALESCE(oc.extracted->>'make', oc.classification->>'make') as make,
    COALESCE(oc.extracted->>'model', oc.classification->>'model') as model,
    oc.extracted->>'variant' as variant_raw,
    (oc.extracted->>'km')::integer as km,
    COALESCE(
      (oc.extracted->>'price')::integer,
      (oc.extracted->>'asking_price')::integer
    ) as price,
    oc.extracted->>'location' as location,
    oc.domain,
    oc.extracted,
    oc.classification,
    oc.match_score,
    COALESCE(oc.dna_score, oc.match_score) as dna_score,
    UPPER(COALESCE(oc.decision, 'WATCH')) as decision,
    oc.reasons,
    oc.alert_emitted,
    v_hunt.criteria_version,
    false as is_stale,
    -- source_class based on domain pattern
    CASE 
      WHEN oc.domain LIKE '%pickles%' OR oc.domain LIKE '%manheim%' OR oc.domain LIKE '%grays%' OR oc.domain LIKE '%lloyds%' THEN 'auction'
      WHEN oc.domain LIKE '%autotrader%' OR oc.domain LIKE '%drive%' OR oc.domain LIKE '%carsales%' OR oc.domain LIKE '%gumtree%' THEN 'marketplace'
      ELSE 'dealer'
    END as source_class,
    -- source_tier: 1=auction, 2=marketplace, 3=dealer/other
    CASE 
      WHEN oc.domain LIKE '%pickles%' OR oc.domain LIKE '%manheim%' OR oc.domain LIKE '%grays%' OR oc.domain LIKE '%lloyds%' THEN 1
      WHEN oc.domain LIKE '%autotrader%' OR oc.domain LIKE '%drive%' OR oc.domain LIKE '%carsales%' OR oc.domain LIKE '%gumtree%' THEN 2
      ELSE 3
    END as source_tier
  FROM outward_candidates oc
  WHERE oc.hunt_id = p_hunt_id
    AND oc.criteria_version = v_hunt.criteria_version
    AND oc.is_stale = false
    AND UPPER(COALESCE(oc.decision, 'WATCH')) IN ('BUY', 'WATCH')
  ON CONFLICT (hunt_id, url) DO UPDATE SET
    source_type = EXCLUDED.source_type,
    source = EXCLUDED.source,
    title = EXCLUDED.title,
    year = EXCLUDED.year,
    make = EXCLUDED.make,
    model = EXCLUDED.model,
    km = EXCLUDED.km,
    price = EXCLUDED.price,
    location = EXCLUDED.location,
    domain = EXCLUDED.domain,
    extracted = EXCLUDED.extracted,
    classification = EXCLUDED.classification,
    match_score = EXCLUDED.match_score,
    dna_score = EXCLUDED.dna_score,
    decision = EXCLUDED.decision,
    criteria_version = EXCLUDED.criteria_version,
    is_stale = false,
    source_class = EXCLUDED.source_class,
    source_tier = EXCLUDED.source_tier,
    updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  -- Calculate effective_price
  UPDATE hunt_unified_candidates
  SET effective_price = price
  WHERE hunt_id = p_hunt_id 
    AND criteria_version = v_hunt.criteria_version
    AND is_stale = false;

  -- Calculate gap metrics if proven_exit_value exists
  IF v_hunt.proven_exit_value IS NOT NULL THEN
    UPDATE hunt_unified_candidates
    SET 
      gap_dollars = v_hunt.proven_exit_value - price,
      gap_pct = CASE WHEN v_hunt.proven_exit_value > 0 
                THEN ((v_hunt.proven_exit_value - price)::numeric / v_hunt.proven_exit_value::numeric) * 100 
                ELSE 0 END
    WHERE hunt_id = p_hunt_id 
      AND price IS NOT NULL
      AND criteria_version = v_hunt.criteria_version
      AND is_stale = false;
  END IF;

  -- =====================================================
  -- COMPUTE RANK_SCORE AND SORT_REASON
  -- =====================================================
  PERFORM rpc_compute_rank_score(p_hunt_id);

  SELECT COUNT(*) INTO v_total_count 
  FROM hunt_unified_candidates 
  WHERE hunt_id = p_hunt_id
    AND criteria_version = v_hunt.criteria_version
    AND is_stale = false;

  RETURN jsonb_build_object(
    'success', true,
    'internal_count', v_internal_count,
    'outward_count', v_outward_count,
    'total_count', v_total_count,
    'criteria_version', v_hunt.criteria_version
  );
END;
$function$;
