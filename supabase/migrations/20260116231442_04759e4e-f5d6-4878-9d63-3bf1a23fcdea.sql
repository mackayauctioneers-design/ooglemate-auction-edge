-- LC79 Precision Pack: Add cab_type, engine_code, engine_litres, cylinders
-- This enables precise matching for 79 Series (VDJ V8 vs GDJ 4cyl, single vs dual cab)

-- 1. Add columns to retail_listings
ALTER TABLE public.retail_listings 
  ADD COLUMN IF NOT EXISTS cab_type text,
  ADD COLUMN IF NOT EXISTS cab_confidence text DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS cab_source text,
  ADD COLUMN IF NOT EXISTS cab_reasons text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS engine_code text,
  ADD COLUMN IF NOT EXISTS engine_litres numeric,
  ADD COLUMN IF NOT EXISTS cylinders integer;

-- 2. Add columns to sale_hunts
ALTER TABLE public.sale_hunts
  ADD COLUMN IF NOT EXISTS cab_type text,
  ADD COLUMN IF NOT EXISTS engine_code text,
  ADD COLUMN IF NOT EXISTS engine_litres numeric,
  ADD COLUMN IF NOT EXISTS cylinders integer;

-- 3. Add columns to dealer_sales for capture at source
ALTER TABLE public.dealer_sales
  ADD COLUMN IF NOT EXISTS cab_type text,
  ADD COLUMN IF NOT EXISTS engine_code text,
  ADD COLUMN IF NOT EXISTS engine_litres numeric,
  ADD COLUMN IF NOT EXISTS cylinders integer;

-- 4. Create composite index for matching
CREATE INDEX IF NOT EXISTS idx_retail_listings_lc79_match 
  ON public.retail_listings (series_family, engine_family, cab_type);

CREATE INDEX IF NOT EXISTS idx_sale_hunts_lc79_match
  ON public.sale_hunts (series_family, engine_family, cab_type);

-- 5. Add cab type detection rules to variant_rules (without ON CONFLICT)
INSERT INTO public.variant_rules (make, model_root, priority, rule_type, pattern, apply_to, set_json, confidence, notes)
SELECT * FROM (VALUES
  -- Dual cab detection
  ('TOYOTA', 'LANDCRUISER', 55, 'SET', '(DUAL[\s-]?CAB|DOUBLE[\s-]?CAB|CREW[\s-]?CAB|D/CAB|DC)', 'any',
   '{"cab_type": "DUAL"}'::jsonb, 'high', 'Dual cab pattern'),
  -- Single cab detection  
  ('TOYOTA', 'LANDCRUISER', 56, 'SET', '(SINGLE[\s-]?CAB|S/CAB|SC)(?!.*DUAL)', 'any',
   '{"cab_type": "SINGLE"}'::jsonb, 'high', 'Single cab pattern'),
  -- Extra cab detection
  ('TOYOTA', 'LANDCRUISER', 57, 'SET', '(EXTRA[\s-]?CAB|SPACE[\s-]?CAB|E/CAB|EC)', 'any',
   '{"cab_type": "EXTRA"}'::jsonb, 'high', 'Extra cab pattern'),
  -- Engine code detection with litres
  ('TOYOTA', 'LANDCRUISER', 11, 'SET', '(VDJ79|VDJ78|VDJ76)', 'any',
   '{"engine_code": "VDJ", "engine_litres": 4.5, "cylinders": 8}'::jsonb, 'high', 'VDJ chassis code'),
  ('TOYOTA', 'LANDCRUISER', 12, 'SET', '(GDJ79|GDJ78|GDJ76)', 'any',
   '{"engine_code": "GDJ", "engine_litres": 2.8, "cylinders": 4}'::jsonb, 'high', 'GDJ chassis code'),
  ('TOYOTA', 'LANDCRUISER', 13, 'SET', '(GRJ79|GRJ76)', 'any',
   '{"engine_code": "GRJ", "engine_litres": 4.0, "cylinders": 6}'::jsonb, 'high', 'GRJ chassis code'),
  ('TOYOTA', 'LANDCRUISER', 14, 'SET', '(FJA300)', 'any',
   '{"engine_code": "FJA", "engine_litres": 3.3, "cylinders": 6}'::jsonb, 'high', 'FJA300 chassis code'),
  -- 4.5L / V8 detection
  ('TOYOTA', 'LANDCRUISER', 73, 'SET', '(4\.5[\s-]?L|4\.5L?\s*TURBO|4\.5\s*DIESEL|4500)', 'any',
   '{"engine_litres": 4.5, "cylinders": 8}'::jsonb, 'medium', '4.5L engine size'),
  -- 2.8L / 4cyl detection
  ('TOYOTA', 'LANDCRUISER', 74, 'SET', '(2\.8[\s-]?L|2\.8L?\s*TURBO|2\.8\s*DIESEL|2800)', 'any',
   '{"engine_litres": 2.8, "cylinders": 4}'::jsonb, 'medium', '2.8L engine size'),
  -- 4.0L / V6 detection
  ('TOYOTA', 'LANDCRUISER', 75, 'SET', '(4\.0[\s-]?L|4\.0L?\s*PETROL|4000)', 'any',
   '{"engine_litres": 4.0, "cylinders": 6}'::jsonb, 'medium', '4.0L engine size')
) AS v(make, model_root, priority, rule_type, pattern, apply_to, set_json, confidence, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM variant_rules vr 
  WHERE vr.make = v.make AND vr.pattern = v.pattern
);

-- 6. Update rpc_classify_listing to handle cab_type and engine details
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
  
  -- Combine searchable text
  v_combined_text := UPPER(COALESCE(v_listing.listing_url, '') || ' ' || 
                           COALESCE(v_listing.title, '') || ' ' ||
                           COALESCE(v_listing.variant, '') || ' ' ||
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
    IF (v_result ? 'series_family') AND (v_result ? 'engine_family') THEN
      v_confidence := 'high';
    ELSIF (v_result ? 'series_family') THEN
      v_confidence := 'medium';
    END IF;
    v_result := v_result || jsonb_build_object('variant_confidence', v_confidence);
  END;
  
  -- Update listing with classification
  UPDATE retail_listings SET
    series_family = COALESCE((v_result->>'series_family'), series_family),
    engine_family = COALESCE((v_result->>'engine_family'), engine_family),
    body_type = COALESCE((v_result->>'body_type'), body_type),
    badge = COALESCE((v_result->>'badge'), badge),
    cab_type = COALESCE((v_result->>'cab_type'), cab_type),
    cab_confidence = CASE 
      WHEN (v_result ? 'cab_type') AND v_result->>'cab_type' != 'UNKNOWN' THEN 'high'
      ELSE 'low'
    END,
    cab_reasons = v_cab_reasons,
    engine_code = COALESCE((v_result->>'engine_code'), engine_code),
    engine_litres = COALESCE((v_result->>'engine_litres')::numeric, engine_litres),
    cylinders = COALESCE((v_result->>'cylinders')::int, cylinders),
    variant_confidence = COALESCE((v_result->>'variant_confidence'), variant_confidence),
    variant_reasons = v_variant_reasons,
    classified_at = now()
  WHERE id = p_listing_id;
  
  -- Log to variant_audit if table exists
  INSERT INTO variant_audit (listing_id, matched_rules, result_json, source_text)
  VALUES (p_listing_id, v_matched_rules, v_result, LEFT(v_combined_text, 500))
  ON CONFLICT (listing_id) DO UPDATE SET
    matched_rules = EXCLUDED.matched_rules,
    result_json = EXCLUDED.result_json,
    source_text = EXCLUDED.source_text,
    created_at = now();
  
  RETURN v_result;
EXCEPTION WHEN undefined_table THEN
  -- variant_audit table doesn't exist, skip logging
  RETURN v_result;
END;
$$;

-- 7. Update rpc_classify_hunt to handle cab_type and engine details
CREATE OR REPLACE FUNCTION public.rpc_classify_hunt(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt record;
  v_rule record;
  v_combined_text text;
  v_result jsonb := '{}';
  v_matched_rules text[] := '{}';
BEGIN
  -- Get hunt
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hunt not found');
  END IF;
  
  -- Combine searchable text (from variant_family and any notes)
  v_combined_text := UPPER(COALESCE(v_hunt.variant_family, '') || ' ' || 
                           COALESCE(v_hunt.notes, '') || ' ' ||
                           COALESCE(v_hunt.model, ''));
  
  -- Apply variant_rules in priority order
  FOR v_rule IN 
    SELECT * FROM variant_rules 
    WHERE make = UPPER(v_hunt.make)
      AND (model_root IS NULL OR UPPER(v_hunt.model) LIKE model_root || '%')
      AND enabled = true
    ORDER BY priority ASC
  LOOP
    IF v_combined_text ~* v_rule.pattern THEN
      v_result := v_result || v_rule.set_json;
      v_matched_rules := array_append(v_matched_rules, v_rule.id::text);
    END IF;
  END LOOP;
  
  -- Update hunt with classification
  UPDATE sale_hunts SET
    model_root = COALESCE((v_result->>'model_root'), model_root),
    series_family = COALESCE((v_result->>'series_family'), series_family),
    engine_family = COALESCE((v_result->>'engine_family'), engine_family),
    body_type = COALESCE((v_result->>'body_type'), body_type),
    badge = COALESCE((v_result->>'badge'), badge),
    cab_type = COALESCE((v_result->>'cab_type'), cab_type),
    engine_code = COALESCE((v_result->>'engine_code'), engine_code),
    engine_litres = COALESCE((v_result->>'engine_litres')::numeric, engine_litres),
    cylinders = COALESCE((v_result->>'cylinders')::int, cylinders)
  WHERE id = p_hunt_id;
  
  RETURN v_result || jsonb_build_object('matched_rules', v_matched_rules);
END;
$$;

-- 8. Update create_hunt_from_sale to propagate cab_type and engine fields
CREATE OR REPLACE FUNCTION public.create_hunt_from_sale(p_sale_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_hunt_id uuid;
  v_existing_hunt_id uuid;
BEGIN
  -- Get the sale
  SELECT * INTO v_sale FROM dealer_sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;
  
  -- Check for existing hunt for this sale
  SELECT id INTO v_existing_hunt_id FROM sale_hunts 
  WHERE sale_id = p_sale_id AND status != 'archived';
  
  IF v_existing_hunt_id IS NOT NULL THEN
    RETURN v_existing_hunt_id;
  END IF;
  
  -- Create the hunt
  INSERT INTO sale_hunts (
    sale_id,
    dealer_id,
    year,
    make,
    model,
    variant_family,
    fuel,
    transmission,
    drivetrain,
    km,
    proven_exit_value,
    proven_exit_method,
    cab_type,
    engine_code,
    engine_litres,
    cylinders,
    status
  ) VALUES (
    p_sale_id,
    v_sale.dealer_id,
    v_sale.year,
    UPPER(v_sale.make),
    UPPER(v_sale.model),
    v_sale.variant_raw,
    NULL,
    NULL,
    NULL,
    v_sale.km,
    v_sale.sell_price,
    'SALE_UPLOAD',
    v_sale.cab_type,
    v_sale.engine_code,
    v_sale.engine_litres,
    v_sale.cylinders,
    'active'
  ) RETURNING id INTO v_hunt_id;
  
  -- Trigger classification
  PERFORM rpc_classify_hunt(v_hunt_id);
  
  RETURN v_hunt_id;
END;
$$;