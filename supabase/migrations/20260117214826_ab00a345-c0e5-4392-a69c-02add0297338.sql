-- Fix the RPC to use variant_raw instead of variant
CREATE OR REPLACE FUNCTION rpc_build_unified_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hunt record;
  v_internal_count integer := 0;
  v_outward_count integer := 0;
  v_total_count integer := 0;
  v_min_price integer;
  v_max_price integer;
BEGIN
  -- Get hunt details
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF v_hunt.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;

  -- Clear existing unified candidates for this hunt
  DELETE FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id;

  -- Insert internal candidates from hunt_matches
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source, source_listing_id, url, title, year, make, model,
    variant_raw, km, price, location, domain, extracted, classification,
    match_score, decision, reasons
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
    rl.variant_raw as variant_raw,  -- FIXED: was rl.variant
    rl.km,
    rl.asking_price as price,
    COALESCE(rl.suburb, rl.state) as location,
    COALESCE(
      CASE 
        WHEN rl.source = 'autotrader' THEN 'autotrader.com.au'
        WHEN rl.source = 'drive' THEN 'drive.com.au'
        WHEN rl.source LIKE 'gumtree%' THEN 'gumtree.com.au'
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
    UPPER(hm.decision) as decision,
    hm.reasons
  FROM hunt_matches hm
  JOIN retail_listings rl ON rl.id = hm.listing_id
  WHERE hm.hunt_id = p_hunt_id
    AND hm.decision IN ('buy', 'watch', 'BUY', 'WATCH');

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- Insert outward candidates from hunt_external_candidates
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source, source_listing_id, url, title, year, make, model,
    variant_raw, km, price, location, domain, match_score, decision, reasons
  )
  SELECT 
    hec.hunt_id,
    'outward' as source_type,
    hec.source_name as source,
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
    -- Extract domain from URL
    CASE 
      WHEN hec.source_url LIKE '%pickles.com.au%' THEN 'pickles.com.au'
      WHEN hec.source_url LIKE '%manheim.com.au%' THEN 'manheim.com.au'
      WHEN hec.source_url LIKE '%grays.com%' THEN 'grays.com'
      WHEN hec.source_url LIKE '%autotrader.com.au%' THEN 'autotrader.com.au'
      WHEN hec.source_url LIKE '%carsales.com.au%' THEN 'carsales.com.au'
      WHEN hec.source_url LIKE '%drive.com.au%' THEN 'drive.com.au'
      WHEN hec.source_url LIKE '%gumtree.com.au%' THEN 'gumtree.com.au'
      ELSE regexp_replace(hec.source_url, '^https?://([^/]+).*$', '\1')
    END as domain,
    hec.match_score,
    UPPER(COALESCE(hec.decision, 'WATCH')) as decision,
    ARRAY['Web discovery'] as reasons
  FROM hunt_external_candidates hec
  WHERE hec.hunt_id = p_hunt_id
    AND hec.expired_at IS NULL
    AND COALESCE(hec.decision, 'WATCH') IN ('BUY', 'WATCH', 'buy', 'watch')
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
    match_score = EXCLUDED.match_score,
    decision = EXCLUDED.decision,
    updated_at = now();

  GET DIAGNOSTICS v_outward_count = ROW_COUNT;

  -- Calculate price scores (cheapest = 10, most expensive = 0)
  SELECT MIN(price), MAX(price) INTO v_min_price, v_max_price
  FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND price IS NOT NULL;

  IF v_max_price IS NOT NULL AND v_max_price > v_min_price THEN
    UPDATE hunt_unified_candidates
    SET 
      effective_price = COALESCE(price, v_max_price + 1),
      price_score = CASE 
        WHEN price IS NULL THEN 0
        ELSE 10.0 * (1.0 - (price - v_min_price)::numeric / NULLIF(v_max_price - v_min_price, 0))
      END
    WHERE hunt_id = p_hunt_id;
  ELSE
    UPDATE hunt_unified_candidates
    SET 
      effective_price = COALESCE(price, 999999999),
      price_score = CASE WHEN price IS NOT NULL THEN 5.0 ELSE 0 END
    WHERE hunt_id = p_hunt_id;
  END IF;

  -- Calculate final score based on hunt sort_mode
  IF v_hunt.sort_mode = 'best_match' THEN
    UPDATE hunt_unified_candidates
    SET final_score = (match_score * 0.70) + (price_score * 0.30)
    WHERE hunt_id = p_hunt_id;
  ELSE
    UPDATE hunt_unified_candidates
    SET final_score = (price_score * 0.60) + (match_score * 0.40)
    WHERE hunt_id = p_hunt_id;
  END IF;

  -- Rank by position
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY hunt_id 
      ORDER BY 
        CASE decision WHEN 'BUY' THEN 0 ELSE 1 END,
        final_score DESC,
        effective_price ASC
    ) as pos
    FROM hunt_unified_candidates
    WHERE hunt_id = p_hunt_id
  )
  UPDATE hunt_unified_candidates huc
  SET rank_position = ranked.pos
  FROM ranked
  WHERE huc.id = ranked.id;

  -- Mark cheapest
  UPDATE hunt_unified_candidates
  SET is_cheapest = true
  WHERE hunt_id = p_hunt_id
    AND price IS NOT NULL
    AND price = v_min_price;

  SELECT COUNT(*) INTO v_total_count FROM hunt_unified_candidates WHERE hunt_id = p_hunt_id;

  RETURN jsonb_build_object(
    'success', true,
    'internal_count', v_internal_count,
    'outward_count', v_outward_count,
    'total_count', v_total_count,
    'min_price', v_min_price,
    'max_price', v_max_price
  );
END;
$$;