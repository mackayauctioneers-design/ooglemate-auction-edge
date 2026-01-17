-- Add missing columns to hunt_unified_candidates
ALTER TABLE hunt_unified_candidates ADD COLUMN IF NOT EXISTS rank_position integer;
ALTER TABLE hunt_unified_candidates ADD COLUMN IF NOT EXISTS is_cheapest boolean DEFAULT false;

-- Fix the RPC to use outward_candidates table (not hunt_external_candidates)
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
    rl.variant_raw,
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
    AND UPPER(hm.decision) IN ('BUY', 'WATCH');

  GET DIAGNOSTICS v_internal_count = ROW_COUNT;

  -- Insert outward candidates from outward_candidates table
  INSERT INTO hunt_unified_candidates (
    hunt_id, source_type, source, source_listing_id, url, title, year, make, model,
    variant_raw, km, price, location, domain, extracted, classification,
    match_score, decision, reasons, alert_emitted
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
    UPPER(COALESCE(oc.decision, 'WATCH')) as decision,
    oc.reasons,
    oc.alert_emitted
  FROM outward_candidates oc
  WHERE oc.hunt_id = p_hunt_id
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
    SET final_score = (COALESCE(match_score, 5) * 0.70) + (COALESCE(price_score, 0) * 0.30)
    WHERE hunt_id = p_hunt_id;
  ELSE
    UPDATE hunt_unified_candidates
    SET final_score = (COALESCE(price_score, 0) * 0.60) + (COALESCE(match_score, 5) * 0.40)
    WHERE hunt_id = p_hunt_id;
  END IF;

  -- Rank by position
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY hunt_id 
      ORDER BY 
        CASE decision WHEN 'BUY' THEN 0 ELSE 1 END,
        final_score DESC,
        effective_price ASC NULLS LAST
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
  SET is_cheapest = (price = v_min_price)
  WHERE hunt_id = p_hunt_id AND price IS NOT NULL;

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