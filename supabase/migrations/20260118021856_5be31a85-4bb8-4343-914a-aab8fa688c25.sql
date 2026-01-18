
-- Fix rpc_build_unified_candidates to read from hunt_external_candidates (not outward_candidates)
-- AND ensure outward-hunt writes criteria_version correctly

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

  -- INSERT OUTWARD CANDIDATES FROM hunt_external_candidates (FIXED TABLE NAME!)
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source, source_listing_id, url, title, year, make, model,
    variant_raw, km, price, location, domain, extracted, classification,
    match_score, dna_score, decision, reasons, alert_emitted, criteria_version, is_stale, 
    source_class, source_tier, blocked_reason, id_kit, requires_manual_check
  )
  SELECT 
    hec.hunt_id,
    'outward' as source_type,
    'firecrawl' as source,
    hec.id::text as source_listing_id,
    hec.source_url as url,
    hec.title,
    hec.year,
    hec.make,
    hec.model,
    hec.variant_raw,
    hec.km,
    hec.asking_price as price,
    hec.location,
    hec.source_name as domain,
    COALESCE(hec.verified_fields, '{}'::jsonb) as extracted,
    '{}'::jsonb as classification,
    COALESCE(hec.match_score, 5.0) as match_score,
    COALESCE(hec.match_score, 5.0) as dna_score,
    UPPER(hec.decision) as decision,
    CASE WHEN hec.reject_reason IS NOT NULL 
      THEN ARRAY[hec.reject_reason] 
      ELSE ARRAY[]::text[] 
    END as reasons,
    COALESCE(hec.alert_emitted, false) as alert_emitted,
    v_hunt.criteria_version,
    false as is_stale,
    -- source_class based on domain pattern  
    CASE 
      WHEN hec.source_name ILIKE '%pickles%' OR hec.source_name ILIKE '%manheim%' 
           OR hec.source_name ILIKE '%grays%' OR hec.source_name ILIKE '%lloyds%' THEN 'auction'
      WHEN hec.source_name ILIKE '%autotrader%' OR hec.source_name ILIKE '%drive%' 
           OR hec.source_name ILIKE '%gumtree%' OR hec.source_name ILIKE '%carsales%' THEN 'marketplace'
      ELSE 'web'
    END as source_class,
    -- source_tier: 1=auction, 2=marketplace, 3=web/dealer
    CASE 
      WHEN hec.source_name ILIKE '%pickles%' OR hec.source_name ILIKE '%manheim%' 
           OR hec.source_name ILIKE '%grays%' OR hec.source_name ILIKE '%lloyds%' THEN 1
      WHEN hec.source_name ILIKE '%autotrader%' OR hec.source_name ILIKE '%drive%' 
           OR hec.source_name ILIKE '%gumtree%' OR hec.source_name ILIKE '%carsales%' THEN 2
      ELSE 3
    END as source_tier,
    NULL as blocked_reason,
    NULL as id_kit,
    false as requires_manual_check
  FROM hunt_external_candidates hec
  WHERE hec.hunt_id = p_hunt_id
    AND (hec.criteria_version = v_hunt.criteria_version OR hec.criteria_version IS NULL)
    AND (hec.is_stale = false OR hec.is_stale IS NULL)
    AND hec.is_listing = true;

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;
  v_total_count := v_internal_count + v_outward_count;

  -- Calculate rank positions
  WITH ranked AS (
    SELECT id, 
           ROW_NUMBER() OVER (ORDER BY source_tier ASC, dna_score DESC, price ASC NULLS LAST) as rn
    FROM hunt_unified_candidates
    WHERE hunt_id = p_hunt_id
      AND criteria_version = v_hunt.criteria_version
      AND is_stale = false
  )
  UPDATE hunt_unified_candidates uc
  SET rank_position = ranked.rn,
      is_cheapest = (ranked.rn = 1)
  FROM ranked
  WHERE uc.id = ranked.id;

  RETURN jsonb_build_object(
    'success', true,
    'criteria_version', v_hunt.criteria_version,
    'internal_count', v_internal_count,
    'outward_count', v_outward_count,
    'total_count', v_total_count
  );
END;
$function$;
