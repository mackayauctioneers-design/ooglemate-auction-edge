-- Fix architecture: evaluate_trigger only writes trigger_evaluations
DROP FUNCTION IF EXISTS evaluate_trigger(UUID, TEXT);
DROP FUNCTION IF EXISTS emit_sales_trigger(UUID);

-- evaluate_trigger: ONLY writes to trigger_evaluations
CREATE FUNCTION evaluate_trigger(
  p_listing_id UUID,
  p_config_version TEXT
)
RETURNS TABLE (
  evaluation_id UUID,
  result TEXT,
  gap_dollars NUMERIC,
  gap_pct NUMERIC,
  reasons TEXT[],
  gate_failures TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing RECORD;
  v_config RECORD;
  v_proven RECORD;
  v_gap_dollars NUMERIC;
  v_gap_pct NUMERIC;
  v_result TEXT;
  v_reasons TEXT[] := ARRAY[]::TEXT[];
  v_gate_failures TEXT[] := ARRAY[]::TEXT[];
  v_pct_threshold NUMERIC;
  v_abs_threshold NUMERIC;
  v_max_gap_threshold NUMERIC;
  v_min_confidence_rank INTEGER;
  v_proven_confidence_rank INTEGER;
  v_evaluation_id UUID;
BEGIN
  SELECT * INTO v_listing FROM retail_listings rl WHERE rl.id = p_listing_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found: %', p_listing_id; END IF;

  SELECT * INTO v_config FROM trigger_config tc WHERE tc.version = p_config_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Config not found: %', p_config_version; END IF;

  SELECT * INTO v_proven FROM proven_exits pe WHERE pe.identity_id = v_listing.identity_id;

  v_pct_threshold := v_config.guardrail_value_pct;
  v_abs_threshold := v_config.guardrail_value_abs;
  v_max_gap_threshold := COALESCE(v_config.guardrail_max_gap, 15000);
  v_min_confidence_rank := CASE v_config.min_confidence_buy WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END;

  -- No proven exit → IGNORE
  IF v_proven IS NULL THEN
    v_result := 'IGNORE'; v_gate_failures := array_append(v_gate_failures, 'no_proven_exit');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, NULL::NUMERIC, NULL::NUMERIC, v_reasons, v_gate_failures; RETURN;
  END IF;

  v_gap_dollars := v_proven.exit_value - v_listing.asking_price;
  v_gap_pct := ROUND((v_gap_dollars / NULLIF(v_proven.exit_value::NUMERIC, 0)) * 100, 2);

  -- Gap not positive → IGNORE
  IF v_gap_dollars <= 0 THEN
    v_result := 'IGNORE'; v_reasons := array_append(v_reasons, 'gap_not_positive');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, proven_exit_value, gap_dollars, gap_pct, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  -- Confidence gate
  v_proven_confidence_rank := CASE v_proven.confidence_label WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END;
  IF v_proven_confidence_rank < v_min_confidence_rank THEN
    v_result := 'IGNORE'; v_gate_failures := array_append(v_gate_failures, 'confidence_too_low');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, proven_exit_value, gap_dollars, gap_pct, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  -- Recency gate (270 days max)
  IF v_proven.sale_recency_days > 270 THEN
    v_result := 'IGNORE'; v_gate_failures := array_append(v_gate_failures, 'stale_evidence');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, proven_exit_value, gap_dollars, gap_pct, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  -- Max gap guardrail
  IF v_gap_dollars > v_max_gap_threshold THEN
    v_result := 'WATCH'; v_reasons := array_append(v_reasons, 'exceeds_max_gap');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, proven_exit_value, gap_dollars, gap_pct, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  -- BUY thresholds: gap >= pct% AND gap >= $abs
  IF v_gap_pct >= v_pct_threshold AND v_gap_dollars >= v_abs_threshold THEN
    v_result := 'BUY'; v_reasons := array_append(array_append(v_reasons, 'pct_threshold_met'), 'abs_threshold_met');
  ELSE
    v_result := 'WATCH'; v_reasons := array_append(v_reasons, 'below_buy_threshold');
  END IF;

  INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, proven_exit_value, gap_dollars, gap_pct, result, reasons, gate_failures, snapshot)
  VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven), 'thresholds', jsonb_build_object('pct', v_pct_threshold, 'abs', v_abs_threshold, 'max_gap', v_max_gap_threshold)))
  RETURNING id INTO v_evaluation_id;

  RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures;
END;
$$;

-- emit_sales_trigger: builds full sales_triggers row from evaluation
CREATE FUNCTION emit_sales_trigger(p_evaluation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval RECORD;
  v_listing RECORD;
  v_identity RECORD;
  v_proven RECORD;
  v_trigger_id UUID;
BEGIN
  -- Get evaluation
  SELECT * INTO v_eval FROM trigger_evaluations te WHERE te.id = p_evaluation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evaluation not found: %', p_evaluation_id; END IF;

  -- Only emit for BUY or WATCH
  IF v_eval.result NOT IN ('BUY', 'WATCH') THEN
    RETURN NULL;
  END IF;

  -- Get listing details
  SELECT * INTO v_listing FROM retail_listings rl WHERE rl.id = v_eval.listing_id;
  
  -- Get identity details
  SELECT * INTO v_identity FROM vehicle_identities vi WHERE vi.id = v_eval.identity_id;
  
  -- Get proven exit details
  SELECT * INTO v_proven FROM proven_exits pe WHERE pe.identity_id = v_eval.identity_id;

  -- Insert full sales_triggers row (ON CONFLICT for dedup by listing_id + config_version)
  INSERT INTO sales_triggers (
    listing_id,
    identity_id,
    trigger_type,
    year,
    make,
    model,
    variant_family,
    km,
    location,
    listing_url,
    asking_price,
    proven_exit_value,
    gap_dollars,
    gap_pct,
    config_version,
    evaluation_snapshot
  ) VALUES (
    v_eval.listing_id,
    v_eval.identity_id,
    v_eval.result,
    v_listing.year,
    v_listing.make,
    v_listing.model,
    v_listing.variant_family,
    v_listing.km,
    v_listing.state,
    v_listing.listing_url,
    v_eval.listing_price,
    v_eval.proven_exit_value,
    v_eval.gap_dollars,
    v_eval.gap_pct,
    v_eval.config_version,
    v_eval.snapshot
  )
  ON CONFLICT (listing_id, config_version) 
  DO UPDATE SET
    trigger_type = EXCLUDED.trigger_type,
    asking_price = EXCLUDED.asking_price,
    proven_exit_value = EXCLUDED.proven_exit_value,
    gap_dollars = EXCLUDED.gap_dollars,
    gap_pct = EXCLUDED.gap_pct,
    evaluation_snapshot = EXCLUDED.evaluation_snapshot,
    updated_at = now()
  RETURNING id INTO v_trigger_id;

  RETURN v_trigger_id;
END;
$$;

-- Update evaluate_and_emit_trigger to chain evaluate → emit
DROP FUNCTION IF EXISTS evaluate_and_emit_trigger(UUID, TEXT);

CREATE FUNCTION evaluate_and_emit_trigger(
  p_listing_id UUID,
  p_config_version TEXT
)
RETURNS TABLE (
  evaluation_id UUID,
  trigger_id UUID,
  result TEXT,
  gap_dollars NUMERIC,
  gap_pct NUMERIC,
  reasons TEXT[],
  gate_failures TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval_id UUID;
  v_result TEXT;
  v_gap_dollars NUMERIC;
  v_gap_pct NUMERIC;
  v_reasons TEXT[];
  v_gate_failures TEXT[];
  v_trigger_id UUID;
BEGIN
  -- Step 1: Evaluate (writes to trigger_evaluations only)
  SELECT et.evaluation_id, et.result, et.gap_dollars, et.gap_pct, et.reasons, et.gate_failures
  INTO v_eval_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures
  FROM public.evaluate_trigger(p_listing_id, p_config_version) et;

  -- Step 2: Emit (builds full sales_triggers row if BUY/WATCH)
  SELECT public.emit_sales_trigger(v_eval_id) INTO v_trigger_id;

  RETURN QUERY SELECT v_eval_id, v_trigger_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures;
END;
$$;