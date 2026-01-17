-- Fix rpc_classify_listing to use correct column name (variant_raw instead of variant)
CREATE OR REPLACE FUNCTION public.rpc_classify_listing(p_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing record;
  v_rule record;
  v_combined_text text;
  v_result jsonb := '{}';
  v_matched_rules text[] := '{}';
  v_cab_reasons text[] := '{}';
  v_variant_reasons text[] := '{}';
BEGIN
  -- Get listing
  SELECT * INTO v_listing FROM retail_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Listing not found');
  END IF;
  
  -- Combine searchable text (using variant_raw, not variant)
  v_combined_text := UPPER(COALESCE(v_listing.listing_url, '') || ' ' || 
                           COALESCE(v_listing.title, '') || ' ' ||
                           COALESCE(v_listing.variant_raw, '') || ' ' ||
                           COALESCE(v_listing.model, ''));
  
  -- Apply variant_rules in priority order
  FOR v_rule IN 
    SELECT * FROM variant_rules 
    WHERE make = UPPER(v_listing.make)
      AND (model_root IS NULL OR UPPER(v_listing.model) LIKE model_root || '%')
      AND enabled = true
    ORDER BY priority ASC
  LOOP
    IF v_combined_text ~* v_rule.pattern THEN
      v_result := v_result || v_rule.set_json;
      v_matched_rules := array_append(v_matched_rules, v_rule.id::text);
      
      -- Track cab vs variant reasons
      IF v_rule.set_json ? 'cab_type' THEN
        v_cab_reasons := array_append(v_cab_reasons, 'rule:' || v_rule.id::text || ':' || COALESCE(v_rule.notes, ''));
      ELSE
        v_variant_reasons := array_append(v_variant_reasons, 'rule:' || v_rule.id::text || ':' || COALESCE(v_rule.notes, ''));
      END IF;
    END IF;
  END LOOP;
  
  -- Set defaults for unknowns on LC70 series
  IF NOT (v_result ? 'cab_type') AND (v_result->>'series_family' = 'LC70' OR v_listing.series_family = 'LC70') THEN
    v_result := v_result || '{"cab_type": "UNKNOWN"}'::jsonb;
    v_cab_reasons := array_append(v_cab_reasons, 'default:no_pattern_matched');
  END IF;
  
  IF NOT (v_result ? 'engine_code') AND (v_result->>'series_family' = 'LC70' OR v_listing.series_family = 'LC70') THEN
    v_result := v_result || '{"engine_code": "UNKNOWN"}'::jsonb;
    v_variant_reasons := array_append(v_variant_reasons, 'default:engine_unknown');
  END IF;
  
  -- Calculate confidence
  DECLARE
    v_confidence text := 'low';
  BEGIN
    IF array_length(v_matched_rules, 1) >= 3 THEN
      v_confidence := 'high';
    ELSIF array_length(v_matched_rules, 1) >= 1 THEN
      v_confidence := 'medium';
    END IF;
    v_result := v_result || jsonb_build_object('variant_confidence', v_confidence);
  END;
  
  v_result := v_result || jsonb_build_object(
    'matched_rules', v_matched_rules,
    'cab_reasons', v_cab_reasons,
    'variant_reasons', v_variant_reasons
  );
  
  -- Update listing with classification
  UPDATE retail_listings SET
    series_family = COALESCE(v_result->>'series_family', series_family),
    engine_family = COALESCE(v_result->>'engine_family', engine_family),
    cab_type = COALESCE(v_result->>'cab_type', cab_type),
    badge = COALESCE(v_result->>'badge', badge),
    body_type = COALESCE(v_result->>'body_type', body_type),
    engine_code = COALESCE(v_result->>'engine_code', engine_code),
    engine_litres = COALESCE((v_result->>'engine_litres')::numeric, engine_litres),
    cylinders = COALESCE((v_result->>'cylinders')::int, cylinders),
    variant_confidence = COALESCE(v_result->>'variant_confidence', variant_confidence),
    cab_reasons = COALESCE(v_cab_reasons, cab_reasons),
    variant_reasons = COALESCE(v_variant_reasons, variant_reasons)
  WHERE id = p_listing_id;
  
  RETURN v_result;
END;
$$;