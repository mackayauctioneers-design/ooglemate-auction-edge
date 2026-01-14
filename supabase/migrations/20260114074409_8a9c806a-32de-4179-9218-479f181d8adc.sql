-- Fix: Add config_version column first, then constraint

-- 1. Add config_version column to sales_triggers
ALTER TABLE sales_triggers ADD COLUMN IF NOT EXISTS config_version TEXT DEFAULT 'v0';

-- 2. Add unique constraint for dedup
ALTER TABLE sales_triggers DROP CONSTRAINT IF EXISTS sales_triggers_dedup;
ALTER TABLE sales_triggers 
  ADD CONSTRAINT sales_triggers_dedup UNIQUE (listing_id, trigger_type, config_version);

-- 3. Fix evaluate_trigger (threshold assignment, confidence gate, layered logic)
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
  
  -- BUG FIX #1: Assign thresholds immediately after loading config
  v_pct_threshold := COALESCE(v_config.guardrail_value_pct, 0);
  v_abs_threshold := COALESCE(v_config.guardrail_value_abs, 0);
  
  -- Get identity
  IF v_listing.identity_id IS NULL THEN
    RETURN QUERY SELECT 'IGNORE'::TEXT, ARRAY['no_identity_mapped']::TEXT[], ARRAY['no_identity']::TEXT[], 
      NULL::INTEGER, 0::INTEGER, 0::NUMERIC, 'none'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  -- Get proven exit
  SELECT * INTO v_proven FROM proven_exits pe WHERE pe.identity_id = v_listing.identity_id;
  IF v_proven.id IS NULL THEN
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
    'exit_method=' || v_proven.exit_method,
    'guardrail_type=' || v_config.guardrail_type,
    'pct_threshold=' || v_pct_threshold || '%',
    'abs_threshold=$' || v_abs_threshold
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
  
  -- BUG FIX #2: Proper confidence gate (handles both high and medium)
  IF v_config.min_confidence_buy = 'high' AND v_proven.confidence_label <> 'high' THEN
    v_gate_failures := v_gate_failures || 'confidence<high';
  ELSIF v_config.min_confidence_buy = 'medium' AND v_proven.confidence_label = 'low' THEN
    v_gate_failures := v_gate_failures || 'confidence<medium';
  END IF;
  
  -- Evaluate guardrails based on type
  IF v_config.guardrail_type = 'layered' THEN
    -- LAYERED: Must pass BOTH percentage AND absolute (AND logic)
    IF v_gap_pct >= v_pct_threshold AND v_gap_dollars >= v_abs_threshold THEN
      IF ARRAY_LENGTH(v_gate_failures, 1) IS NULL THEN
        v_result := 'BUY';
      ELSE
        v_result := 'WATCH';
      END IF;
    ELSIF v_gap_dollars > 0 THEN
      v_result := 'WATCH';
    ELSE
      v_result := 'IGNORE';
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
    
  ELSE
    v_result := 'IGNORE';
    v_reasons := v_reasons || ('unknown_guardrail_type=' || v_config.guardrail_type);
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

-- 4. Create emit_sales_trigger function
CREATE OR REPLACE FUNCTION public.emit_sales_trigger(p_evaluation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval trigger_evaluations%ROWTYPE;
  v_listing retail_listings%ROWTYPE;
  v_proven proven_exits%ROWTYPE;
  v_trigger_id UUID;
  v_exit_summary TEXT;
BEGIN
  SELECT * INTO v_eval FROM trigger_evaluations te WHERE te.id = p_evaluation_id;
  IF v_eval.id IS NULL THEN
    RAISE EXCEPTION 'Evaluation not found: %', p_evaluation_id;
  END IF;
  
  IF v_eval.result NOT IN ('BUY', 'WATCH') THEN
    RETURN NULL;
  END IF;
  
  SELECT * INTO v_listing FROM retail_listings rl WHERE rl.id = v_eval.listing_id;
  SELECT * INTO v_proven FROM proven_exits pe WHERE pe.identity_id = v_eval.identity_id;
  
  IF v_proven.id IS NOT NULL THEN
    v_exit_summary := 'Dealer exit @ $' || v_proven.exit_value || 
      ' (' || to_char(v_proven.newest_sale_date, 'Mon YYYY') || ', n=' || v_proven.sample_size || ')';
  ELSE
    v_exit_summary := 'Median exit @ $' || COALESCE(v_eval.proven_exit_value, 0);
  END IF;
  
  INSERT INTO sales_triggers (
    evaluation_id, listing_id, identity_id, trigger_type, config_version,
    year, make, model, variant_family, km, asking_price, listing_url, location,
    proven_exit_value, proven_exit_summary, gap_dollars, gap_pct, 
    confidence_label, sample_size, target_region_id
  ) VALUES (
    v_eval.id,
    v_eval.listing_id,
    v_eval.identity_id,
    v_eval.result,
    v_eval.config_version,
    v_listing.year,
    v_listing.make,
    v_listing.model,
    v_listing.variant_family,
    v_listing.km,
    v_eval.listing_price,
    v_listing.listing_url,
    COALESCE(v_listing.suburb, '') || ', ' || COALESCE(v_listing.state, ''),
    v_eval.proven_exit_value,
    v_exit_summary,
    v_eval.proven_exit_value - v_eval.listing_price,
    ROUND(((v_eval.proven_exit_value - v_eval.listing_price)::NUMERIC / NULLIF(v_eval.proven_exit_value, 0)) * 100, 2),
    COALESCE(v_proven.confidence_label, 'low'),
    COALESCE(v_eval.sample_size, 0),
    v_listing.region_id
  )
  ON CONFLICT (listing_id, trigger_type, config_version) DO UPDATE SET
    evaluation_id = EXCLUDED.evaluation_id,
    asking_price = EXCLUDED.asking_price,
    proven_exit_value = EXCLUDED.proven_exit_value,
    proven_exit_summary = EXCLUDED.proven_exit_summary,
    gap_dollars = EXCLUDED.gap_dollars,
    gap_pct = EXCLUDED.gap_pct,
    confidence_label = EXCLUDED.confidence_label,
    sample_size = EXCLUDED.sample_size
  RETURNING id INTO v_trigger_id;
  
  RETURN v_trigger_id;
END;
$$;

-- 5. Convenience: evaluate_and_emit
CREATE OR REPLACE FUNCTION public.evaluate_and_emit_trigger(
  p_listing_id UUID,
  p_config_version TEXT DEFAULT 'v0'
)
RETURNS TABLE(
  result TEXT,
  trigger_id UUID,
  evaluation_id UUID,
  gap_dollars INTEGER,
  confidence_label TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval RECORD;
  v_trigger_id UUID;
BEGIN
  SELECT * INTO v_eval FROM evaluate_trigger(p_listing_id, p_config_version);
  
  IF v_eval.result IN ('BUY', 'WATCH') THEN
    v_trigger_id := emit_sales_trigger(v_eval.evaluation_id);
  END IF;
  
  RETURN QUERY SELECT 
    v_eval.result,
    v_trigger_id,
    v_eval.evaluation_id,
    v_eval.gap_dollars,
    v_eval.confidence_label;
END;
$$;