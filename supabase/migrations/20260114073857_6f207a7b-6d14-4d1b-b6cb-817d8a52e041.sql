-- v0 Guardrail consistency + Immutability + RPCs

-- 1. Update v0 config to clarify AND logic
UPDATE trigger_config SET
  provisional_notes = 'Initial BUY guardrail (provisional) - requires BOTH 5% gap AND $500 minimum. Evidence gates: sample>=2, recency<=270d. To be replaced by confidence-weighted logic.'
WHERE version = 'v0';

-- 2. Enforce immutability on trigger_evaluations (block UPDATE/DELETE for non-service-role)
DROP POLICY IF EXISTS "Full access" ON trigger_evaluations;
DROP POLICY IF EXISTS "Service role full access" ON trigger_evaluations;

-- Allow INSERT only (anyone can insert via RPC)
CREATE POLICY "Insert only" ON trigger_evaluations 
  FOR INSERT WITH CHECK (true);

-- Allow SELECT (anyone can read)
CREATE POLICY "Select allowed" ON trigger_evaluations 
  FOR SELECT USING (true);

-- Block UPDATE/DELETE entirely (no policy = no access)
-- Service role bypasses RLS anyway

-- 3. Helper: compute identity hash
CREATE OR REPLACE FUNCTION public.compute_identity_hash(
  p_year_min INTEGER,
  p_year_max INTEGER,
  p_make TEXT,
  p_model TEXT,
  p_variant_family TEXT,
  p_fuel TEXT,
  p_drivetrain TEXT,
  p_transmission TEXT,
  p_km_band TEXT,
  p_region_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN md5(
    COALESCE(p_year_min::text, '') || '|' ||
    COALESCE(p_year_max::text, '') || '|' ||
    LOWER(COALESCE(p_make, '')) || '|' ||
    LOWER(COALESCE(p_model, '')) || '|' ||
    LOWER(COALESCE(p_variant_family, '')) || '|' ||
    LOWER(COALESCE(p_fuel, '')) || '|' ||
    LOWER(COALESCE(p_drivetrain, '')) || '|' ||
    LOWER(COALESCE(p_transmission, '')) || '|' ||
    COALESCE(p_km_band, '') || '|' ||
    COALESCE(p_region_id, 'AU-NATIONAL')
  );
END;
$$;

-- 4. RPC: map_listing_to_identity
CREATE OR REPLACE FUNCTION public.map_listing_to_identity(
  p_year INTEGER,
  p_make TEXT,
  p_model TEXT,
  p_variant_family TEXT DEFAULT NULL,
  p_fuel TEXT DEFAULT NULL,
  p_drivetrain TEXT DEFAULT NULL,
  p_transmission TEXT DEFAULT NULL,
  p_km INTEGER DEFAULT NULL,
  p_region_id TEXT DEFAULT 'AU-NATIONAL'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_km_band TEXT;
  v_identity_hash TEXT;
  v_identity_id UUID;
BEGIN
  -- Compute km band using existing function
  v_km_band := km_to_band(p_km);
  
  -- Compute identity hash
  v_identity_hash := compute_identity_hash(
    p_year, p_year,
    p_make, p_model, p_variant_family,
    p_fuel, p_drivetrain, p_transmission,
    v_km_band, p_region_id
  );
  
  -- Get or create identity
  INSERT INTO vehicle_identities (
    year_min, year_max, make, model, variant_family,
    fuel, drivetrain, transmission, km_band, region_id, identity_hash
  ) VALUES (
    p_year, p_year, UPPER(TRIM(p_make)), UPPER(TRIM(p_model)), 
    NULLIF(TRIM(p_variant_family), ''),
    NULLIF(TRIM(p_fuel), ''), 
    NULLIF(TRIM(p_drivetrain), ''), 
    NULLIF(TRIM(p_transmission), ''),
    v_km_band, p_region_id, v_identity_hash
  )
  ON CONFLICT (identity_hash) DO UPDATE SET
    listing_count = vehicle_identities.listing_count + 1,
    updated_at = now()
  RETURNING id INTO v_identity_id;
  
  RETURN v_identity_id;
END;
$$;

-- 5. RPC: compute_proven_exit (returns row + metadata)
CREATE OR REPLACE FUNCTION public.compute_proven_exit(p_identity_id UUID)
RETURNS TABLE(
  identity_id UUID,
  exit_value INTEGER,
  exit_method TEXT,
  sample_size INTEGER,
  recency_weighted BOOLEAN,
  region_scope TEXT,
  km_band_used TEXT,
  newest_sale_date DATE,
  oldest_sale_date DATE,
  sale_recency_days INTEGER,
  data_sources TEXT[],
  contributing_dealer_ids TEXT[],
  confidence_label TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exit_value INTEGER;
  v_sample_size INTEGER;
  v_newest_date DATE;
  v_oldest_date DATE;
  v_recency_days INTEGER;
  v_sources TEXT[];
  v_dealers TEXT[];
  v_region TEXT;
  v_km_band TEXT;
  v_confidence TEXT;
BEGIN
  -- Get identity info
  SELECT vi.km_band, vi.region_id INTO v_km_band, v_region
  FROM vehicle_identities vi WHERE vi.id = p_identity_id;
  
  IF v_km_band IS NULL THEN
    RETURN; -- Identity not found
  END IF;
  
  -- Aggregate evidence from sales_evidence table
  SELECT 
    COUNT(*)::INTEGER,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY se.exit_price)::INTEGER,
    MAX(se.exit_date),
    MIN(se.exit_date),
    ARRAY_AGG(DISTINCT se.source_type),
    ARRAY_AGG(DISTINCT se.dealer_id) FILTER (WHERE se.dealer_id IS NOT NULL)
  INTO v_sample_size, v_exit_value, v_newest_date, v_oldest_date, v_sources, v_dealers
  FROM sales_evidence se
  WHERE se.identity_id = p_identity_id;
  
  IF v_sample_size = 0 OR v_sample_size IS NULL THEN
    -- No evidence, remove proven exit if exists
    DELETE FROM proven_exits pe WHERE pe.identity_id = p_identity_id;
    RETURN;
  END IF;
  
  -- Compute recency
  v_recency_days := EXTRACT(DAY FROM now() - v_newest_date)::INTEGER;
  
  -- Compute confidence label
  IF v_sample_size >= 5 AND v_recency_days <= 90 THEN
    v_confidence := 'high';
  ELSIF v_sample_size >= 2 AND v_recency_days <= 180 THEN
    v_confidence := 'medium';
  ELSE
    v_confidence := 'low';
  END IF;
  
  -- Upsert proven exit
  INSERT INTO proven_exits (
    identity_id, exit_value, exit_method, sample_size,
    recency_weighted, region_scope, km_band_used,
    newest_sale_date, oldest_sale_date, sale_recency_days,
    data_sources, contributing_dealer_ids, confidence_label
  ) VALUES (
    p_identity_id, v_exit_value, 'median', v_sample_size,
    false, v_region, v_km_band,
    v_newest_date, v_oldest_date, v_recency_days,
    v_sources, v_dealers, v_confidence
  )
  ON CONFLICT (identity_id) DO UPDATE SET
    exit_value = EXCLUDED.exit_value,
    exit_method = EXCLUDED.exit_method,
    sample_size = EXCLUDED.sample_size,
    newest_sale_date = EXCLUDED.newest_sale_date,
    oldest_sale_date = EXCLUDED.oldest_sale_date,
    sale_recency_days = EXCLUDED.sale_recency_days,
    data_sources = EXCLUDED.data_sources,
    contributing_dealer_ids = EXCLUDED.contributing_dealer_ids,
    confidence_label = EXCLUDED.confidence_label,
    computed_at = now(),
    updated_at = now();
  
  -- Return the computed row
  RETURN QUERY
  SELECT 
    pe.identity_id,
    pe.exit_value,
    pe.exit_method,
    pe.sample_size,
    pe.recency_weighted,
    pe.region_scope,
    pe.km_band_used,
    pe.newest_sale_date,
    pe.oldest_sale_date,
    pe.sale_recency_days,
    pe.data_sources,
    pe.contributing_dealer_ids,
    pe.confidence_label
  FROM proven_exits pe
  WHERE pe.identity_id = p_identity_id;
END;
$$;

-- 6. RPC: evaluate_trigger (logs immutable snapshot + returns result)
CREATE OR REPLACE FUNCTION public.evaluate_trigger(
  p_listing_id UUID,
  p_config_version TEXT DEFAULT 'v0'
)
RETURNS TABLE(
  result TEXT,
  reasons TEXT[],
  gate_failures TEXT[],
  proven_exit_value INTEGER,
  gap_dollars INTEGER,
  gap_pct NUMERIC,
  confidence_label TEXT,
  evaluation_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing retail_listings%ROWTYPE;
  v_config trigger_config%ROWTYPE;
  v_proven proven_exits%ROWTYPE;
  v_result TEXT := 'IGNORE';
  v_reasons TEXT[] := '{}';
  v_gate_failures TEXT[] := '{}';
  v_gap_dollars INTEGER := 0;
  v_gap_pct NUMERIC := 0;
  v_pct_threshold NUMERIC;
  v_abs_threshold INTEGER;
  v_eval_id UUID;
BEGIN
  -- Get listing
  SELECT * INTO v_listing FROM retail_listings rl WHERE rl.id = p_listing_id;
  IF v_listing.id IS NULL THEN
    RETURN QUERY SELECT 'IGNORE'::TEXT, ARRAY['listing_not_found']::TEXT[], ARRAY[]::TEXT[], 
      NULL::INTEGER, 0::INTEGER, 0::NUMERIC, 'none'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  -- Get config
  SELECT * INTO v_config FROM trigger_config tc WHERE tc.version = p_config_version;
  IF v_config.id IS NULL THEN
    RETURN QUERY SELECT 'IGNORE'::TEXT, ARRAY['config_not_found']::TEXT[], ARRAY[]::TEXT[], 
      NULL::INTEGER, 0::INTEGER, 0::NUMERIC, 'none'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  -- Get identity
  IF v_listing.identity_id IS NULL THEN
    RETURN QUERY SELECT 'IGNORE'::TEXT, ARRAY['no_identity_mapped']::TEXT[], ARRAY['no_identity']::TEXT[], 
      NULL::INTEGER, 0::INTEGER, 0::NUMERIC, 'none'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  -- Get proven exit
  SELECT * INTO v_proven FROM proven_exits pe WHERE pe.identity_id = v_listing.identity_id;
  IF v_proven.id IS NULL THEN
    -- No evidence yet
    RETURN QUERY SELECT 'IGNORE'::TEXT, ARRAY['no_evidence']::TEXT[], ARRAY['no_proven_exit']::TEXT[], 
      NULL::INTEGER, 0::INTEGER, 0::NUMERIC, 'none'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  -- Calculate gap
  v_gap_dollars := v_proven.exit_value - v_listing.asking_price;
  IF v_proven.exit_value > 0 THEN
    v_gap_pct := ROUND((v_gap_dollars::NUMERIC / v_proven.exit_value) * 100, 2);
  END IF;
  
  -- Build reasons array
  v_reasons := ARRAY[
    'gap_dollars=' || v_gap_dollars,
    'gap_pct=' || v_gap_pct || '%',
    'sample=' || v_proven.sample_size,
    'recency=' || COALESCE(v_proven.sale_recency_days, 0) || 'd',
    'confidence=' || v_proven.confidence_label,
    'exit_method=' || v_proven.exit_method
  ];
  
  -- Check evidence gates for BUY eligibility
  -- Gate 1: sample size
  IF v_proven.sample_size < v_config.min_sample_size_buy THEN
    v_gate_failures := v_gate_failures || ('sample<' || v_config.min_sample_size_buy);
  END IF;
  
  -- Gate 2: recency
  IF COALESCE(v_proven.sale_recency_days, 999) > v_config.max_sale_age_days_buy THEN
    v_gate_failures := v_gate_failures || ('recency>' || v_config.max_sale_age_days_buy || 'd');
  END IF;
  
  -- Gate 3: confidence
  IF v_config.min_confidence_buy = 'high' AND v_proven.confidence_label != 'high' THEN
    v_gate_failures := v_gate_failures || 'confidence<high';
  ELSIF v_config.min_confidence_buy = 'medium' AND v_proven.confidence_label = 'low' THEN
    v_gate_failures := v_gate_failures || 'confidence<medium';
  END IF;
  
  -- Get guardrail thresholds
  v_pct_threshold := v_config.guardrail_value_pct;
  v_abs_threshold := v_config.guardrail_value_abs;
  
  -- Evaluate guardrails (layered = AND logic)
  IF v_config.guardrail_type = 'layered' THEN
    -- Must pass BOTH percentage AND absolute
    IF v_gap_pct >= v_pct_threshold AND v_gap_dollars >= v_abs_threshold THEN
      IF ARRAY_LENGTH(v_gate_failures, 1) IS NULL THEN
        v_result := 'BUY';
      ELSE
        v_result := 'WATCH'; -- Gates failed
      END IF;
    ELSIF v_gap_dollars > 0 THEN
      v_result := 'WATCH'; -- Some gap but not enough
    ELSE
      v_result := 'IGNORE'; -- Negative or zero gap
    END IF;
  ELSIF v_config.guardrail_type = 'percentage' THEN
    IF v_gap_pct >= v_pct_threshold THEN
      IF ARRAY_LENGTH(v_gate_failures, 1) IS NULL THEN v_result := 'BUY'; ELSE v_result := 'WATCH'; END IF;
    ELSIF v_gap_dollars > 0 THEN v_result := 'WATCH';
    ELSE v_result := 'IGNORE';
    END IF;
  ELSIF v_config.guardrail_type = 'absolute' THEN
    IF v_gap_dollars >= v_abs_threshold THEN
      IF ARRAY_LENGTH(v_gate_failures, 1) IS NULL THEN v_result := 'BUY'; ELSE v_result := 'WATCH'; END IF;
    ELSIF v_gap_dollars > 0 THEN v_result := 'WATCH';
    ELSE v_result := 'IGNORE';
    END IF;
  END IF;
  
  -- Log immutable evaluation snapshot
  INSERT INTO trigger_evaluations (
    listing_id, listing_source, identity_id, config_version,
    listing_price, listing_km, proven_exit_value, proven_exit_method,
    sample_size, sale_recency_days, region_scope, km_band_used,
    guardrail_pct_used, guardrail_abs_used, result, reasons, gate_failures
  ) VALUES (
    v_listing.id, v_listing.source, v_listing.identity_id, p_config_version,
    v_listing.asking_price, v_listing.km, v_proven.exit_value, v_proven.exit_method,
    v_proven.sample_size, v_proven.sale_recency_days, v_proven.region_scope, v_proven.km_band_used,
    v_pct_threshold, v_abs_threshold, v_result, v_reasons, v_gate_failures
  )
  RETURNING id INTO v_eval_id;
  
  RETURN QUERY SELECT v_result, v_reasons, v_gate_failures, v_proven.exit_value, 
    v_gap_dollars, v_gap_pct, v_proven.confidence_label, v_eval_id;
END;
$$;