-- Phase 2: Classifier RPCs for Badge Authority Layer

-- ============================================
-- 1. rpc_classify_listing - Classify a single listing
-- ============================================
CREATE OR REPLACE FUNCTION public.rpc_classify_listing(p_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing record;
  v_blob text;
  v_rule record;
  v_result jsonb := '{}'::jsonb;
  v_reasons text[] := ARRAY[]::text[];
  v_rules_applied uuid[] := ARRAY[]::uuid[];
  v_model_root text;
  v_series_family text;
  v_badge text;
  v_badge_tier int;
  v_body_type text;
  v_engine_family text;
  v_confidence text := 'low';
  v_taxonomy record;
BEGIN
  -- Load listing
  SELECT id, make, model, variant, variant_raw, title, listing_url, body
  INTO v_listing
  FROM retail_listings
  WHERE id = p_listing_id;
  
  IF v_listing IS NULL THEN
    RETURN jsonb_build_object('error', 'listing_not_found', 'listing_id', p_listing_id);
  END IF;
  
  -- Build combined text blob (lowercase for matching)
  v_blob := lower(
    coalesce(v_listing.listing_url, '') || ' ' ||
    coalesce(v_listing.title, '') || ' ' ||
    coalesce(v_listing.variant_raw, '') || ' ' ||
    coalesce(v_listing.variant, '') || ' ' ||
    coalesce(v_listing.model, '') || ' ' ||
    coalesce(v_listing.body, '')
  );
  
  -- Infer model_root from make/model
  IF upper(v_listing.make) = 'TOYOTA' THEN
    IF upper(v_listing.model) ILIKE '%LANDCRUISER%' OR upper(v_listing.model) ILIKE '%LAND CRUISER%' THEN
      v_model_root := 'LANDCRUISER';
    ELSIF upper(v_listing.model) ILIKE '%PRADO%' THEN
      v_model_root := 'PRADO';
    END IF;
  END IF;
  
  -- Apply variant_rules in priority order
  FOR v_rule IN (
    SELECT id, pattern, set_json, confidence, notes
    FROM variant_rules
    WHERE enabled = true
      AND make = upper(v_listing.make)
      AND (model_root = v_model_root OR model_root IS NULL)
    ORDER BY priority ASC
  )
  LOOP
    -- Check if pattern matches the blob
    IF v_blob ~* v_rule.pattern THEN
      v_rules_applied := array_append(v_rules_applied, v_rule.id);
      v_reasons := array_append(v_reasons, 'rule:' || coalesce(v_rule.notes, v_rule.id::text));
      
      -- Apply set_json values (only if not already set - first match wins per field)
      IF v_series_family IS NULL AND v_rule.set_json ? 'series_family' THEN
        v_series_family := v_rule.set_json->>'series_family';
      END IF;
      IF v_badge IS NULL AND v_rule.set_json ? 'badge' THEN
        v_badge := v_rule.set_json->>'badge';
      END IF;
      IF v_body_type IS NULL AND v_rule.set_json ? 'body_type' THEN
        v_body_type := v_rule.set_json->>'body_type';
      END IF;
      IF v_engine_family IS NULL AND v_rule.set_json ? 'engine_family' THEN
        v_engine_family := v_rule.set_json->>'engine_family';
      END IF;
    END IF;
  END LOOP;
  
  -- Resolve badge_tier from model_taxonomy
  IF v_model_root IS NOT NULL AND v_series_family IS NOT NULL AND v_badge IS NOT NULL THEN
    SELECT badge_tiers INTO v_taxonomy
    FROM model_taxonomy
    WHERE make = upper(v_listing.make)
      AND model_root = v_model_root
      AND series_family = v_series_family
    LIMIT 1;
    
    IF v_taxonomy IS NOT NULL AND v_taxonomy.badge_tiers ? v_badge THEN
      v_badge_tier := (v_taxonomy.badge_tiers->>v_badge)::int;
    END IF;
  END IF;
  
  -- Set confidence level
  IF v_series_family IS NOT NULL AND (v_engine_family IS NOT NULL OR v_body_type IS NOT NULL) THEN
    v_confidence := 'high';
  ELSIF v_series_family IS NOT NULL THEN
    v_confidence := 'medium';
  ELSE
    v_confidence := 'low';
    IF array_length(v_reasons, 1) IS NULL THEN
      v_reasons := ARRAY['UNCLASSIFIED'];
    END IF;
  END IF;
  
  -- Update the listing
  UPDATE retail_listings
  SET 
    model_root = v_model_root,
    series_family = v_series_family,
    badge = v_badge,
    badge_tier = v_badge_tier,
    body_type = v_body_type,
    engine_family = v_engine_family,
    variant_confidence = v_confidence,
    variant_source = 'ruleset',
    variant_reasons = v_reasons,
    classified_at = now()
  WHERE id = p_listing_id;
  
  -- Insert audit record
  INSERT INTO variant_audit (
    listing_id,
    raw_title,
    raw_variant,
    raw_url,
    output_model_root,
    output_series_family,
    output_badge,
    output_badge_tier,
    output_body_type,
    output_engine_family,
    confidence,
    reasons,
    rules_applied
  ) VALUES (
    p_listing_id,
    v_listing.title,
    v_listing.variant_raw,
    v_listing.listing_url,
    v_model_root,
    v_series_family,
    v_badge,
    v_badge_tier,
    v_body_type,
    v_engine_family,
    v_confidence,
    v_reasons,
    v_rules_applied
  );
  
  -- Return summary
  RETURN jsonb_build_object(
    'listing_id', p_listing_id,
    'model_root', v_model_root,
    'series_family', v_series_family,
    'badge', v_badge,
    'badge_tier', v_badge_tier,
    'body_type', v_body_type,
    'engine_family', v_engine_family,
    'confidence', v_confidence,
    'reasons', to_jsonb(v_reasons)
  );
END;
$$;

-- ============================================
-- 2. rpc_classify_hunt - Classify a single hunt
-- ============================================
CREATE OR REPLACE FUNCTION public.rpc_classify_hunt(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt record;
  v_blob text;
  v_rule record;
  v_reasons text[] := ARRAY[]::text[];
  v_rules_applied uuid[] := ARRAY[]::uuid[];
  v_model_root text;
  v_series_family text;
  v_badge text;
  v_badge_tier int;
  v_body_type text;
  v_engine_family text;
  v_confidence text := 'low';
  v_taxonomy record;
BEGIN
  -- Load hunt
  SELECT id, make, model, variant_family, notes
  INTO v_hunt
  FROM sale_hunts
  WHERE id = p_hunt_id;
  
  IF v_hunt IS NULL THEN
    RETURN jsonb_build_object('error', 'hunt_not_found', 'hunt_id', p_hunt_id);
  END IF;
  
  -- Build combined text blob
  v_blob := lower(
    coalesce(v_hunt.model, '') || ' ' ||
    coalesce(v_hunt.variant_family, '') || ' ' ||
    coalesce(v_hunt.notes, '')
  );
  
  -- Infer model_root
  IF upper(v_hunt.make) = 'TOYOTA' THEN
    IF upper(v_hunt.model) ILIKE '%LANDCRUISER%' OR upper(v_hunt.model) ILIKE '%LAND CRUISER%' THEN
      v_model_root := 'LANDCRUISER';
    ELSIF upper(v_hunt.model) ILIKE '%PRADO%' THEN
      v_model_root := 'PRADO';
    END IF;
  END IF;
  
  -- Apply variant_rules
  FOR v_rule IN (
    SELECT id, pattern, set_json, confidence, notes
    FROM variant_rules
    WHERE enabled = true
      AND make = upper(v_hunt.make)
      AND (model_root = v_model_root OR model_root IS NULL)
    ORDER BY priority ASC
  )
  LOOP
    IF v_blob ~* v_rule.pattern THEN
      v_rules_applied := array_append(v_rules_applied, v_rule.id);
      v_reasons := array_append(v_reasons, 'rule:' || coalesce(v_rule.notes, v_rule.id::text));
      
      IF v_series_family IS NULL AND v_rule.set_json ? 'series_family' THEN
        v_series_family := v_rule.set_json->>'series_family';
      END IF;
      IF v_badge IS NULL AND v_rule.set_json ? 'badge' THEN
        v_badge := v_rule.set_json->>'badge';
      END IF;
      IF v_body_type IS NULL AND v_rule.set_json ? 'body_type' THEN
        v_body_type := v_rule.set_json->>'body_type';
      END IF;
      IF v_engine_family IS NULL AND v_rule.set_json ? 'engine_family' THEN
        v_engine_family := v_rule.set_json->>'engine_family';
      END IF;
    END IF;
  END LOOP;
  
  -- Resolve badge_tier
  IF v_model_root IS NOT NULL AND v_series_family IS NOT NULL AND v_badge IS NOT NULL THEN
    SELECT badge_tiers INTO v_taxonomy
    FROM model_taxonomy
    WHERE make = upper(v_hunt.make)
      AND model_root = v_model_root
      AND series_family = v_series_family
    LIMIT 1;
    
    IF v_taxonomy IS NOT NULL AND v_taxonomy.badge_tiers ? v_badge THEN
      v_badge_tier := (v_taxonomy.badge_tiers->>v_badge)::int;
    END IF;
  END IF;
  
  -- Set confidence
  IF v_series_family IS NOT NULL AND (v_engine_family IS NOT NULL OR v_body_type IS NOT NULL) THEN
    v_confidence := 'high';
  ELSIF v_series_family IS NOT NULL THEN
    v_confidence := 'medium';
  ELSE
    v_confidence := 'low';
    IF array_length(v_reasons, 1) IS NULL THEN
      v_reasons := ARRAY['UNCLASSIFIED'];
    END IF;
  END IF;
  
  -- Update the hunt
  UPDATE sale_hunts
  SET 
    model_root = v_model_root,
    series_family = v_series_family,
    badge = v_badge,
    badge_tier = v_badge_tier,
    body_type = v_body_type,
    engine_family = v_engine_family,
    variant_confidence = v_confidence,
    variant_source = 'ruleset',
    variant_reasons = v_reasons
  WHERE id = p_hunt_id;
  
  -- Insert audit record
  INSERT INTO variant_audit (
    hunt_id,
    raw_title,
    raw_variant,
    output_model_root,
    output_series_family,
    output_badge,
    output_badge_tier,
    output_body_type,
    output_engine_family,
    confidence,
    reasons,
    rules_applied
  ) VALUES (
    p_hunt_id,
    v_hunt.model,
    v_hunt.variant_family,
    v_model_root,
    v_series_family,
    v_badge,
    v_badge_tier,
    v_body_type,
    v_engine_family,
    v_confidence,
    v_reasons,
    v_rules_applied
  );
  
  -- Return summary
  RETURN jsonb_build_object(
    'hunt_id', p_hunt_id,
    'model_root', v_model_root,
    'series_family', v_series_family,
    'badge', v_badge,
    'badge_tier', v_badge_tier,
    'body_type', v_body_type,
    'engine_family', v_engine_family,
    'confidence', v_confidence,
    'reasons', to_jsonb(v_reasons)
  );
END;
$$;

-- ============================================
-- 3. Trigger to auto-classify hunts on insert/update
-- ============================================
CREATE OR REPLACE FUNCTION public.trg_classify_hunt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only classify if classification fields are null
  IF NEW.series_family IS NULL THEN
    PERFORM rpc_classify_hunt(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_classify_hunt_on_insert ON sale_hunts;
CREATE TRIGGER trg_classify_hunt_on_insert
  AFTER INSERT ON sale_hunts
  FOR EACH ROW
  EXECUTE FUNCTION trg_classify_hunt();

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.rpc_classify_listing(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_classify_hunt(uuid) TO anon, authenticated, service_role;