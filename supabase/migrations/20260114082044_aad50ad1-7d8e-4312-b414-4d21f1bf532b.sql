-- Fix evaluate_trigger to use correct column names
DROP FUNCTION IF EXISTS evaluate_trigger(UUID, TEXT);

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

  IF v_proven IS NULL THEN
    v_result := 'IGNORE'; v_gate_failures := array_append(v_gate_failures, 'no_proven_exit');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, NULL::NUMERIC, NULL::NUMERIC, v_reasons, v_gate_failures; RETURN;
  END IF;

  v_gap_dollars := v_proven.exit_value - v_listing.asking_price;
  v_gap_pct := ROUND((v_gap_dollars / NULLIF(v_proven.exit_value::NUMERIC, 0)) * 100, 2);

  IF v_gap_dollars <= 0 THEN
    v_result := 'IGNORE'; v_reasons := array_append(v_reasons, 'gap_not_positive');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, proven_exit_value, gap_dollars, gap_pct, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  v_proven_confidence_rank := CASE v_proven.confidence_label WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END;
  IF v_proven_confidence_rank < v_min_confidence_rank THEN
    v_result := 'IGNORE'; v_gate_failures := array_append(v_gate_failures, 'confidence_too_low');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, proven_exit_value, gap_dollars, gap_pct, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  IF v_proven.sale_recency_days > 270 THEN
    v_result := 'IGNORE'; v_gate_failures := array_append(v_gate_failures, 'stale_evidence');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, proven_exit_value, gap_dollars, gap_pct, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  IF v_gap_dollars > v_max_gap_threshold THEN
    v_result := 'WATCH'; v_reasons := array_append(v_reasons, 'exceeds_max_gap');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, proven_exit_value, gap_dollars, gap_pct, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    INSERT INTO sales_triggers (listing_id, trigger_type, asking_price, proven_exit_value, gap_dollars, gap_pct, identity_id, config_version)
    VALUES (p_listing_id, 'WATCH', v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_listing.identity_id, p_config_version);
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  IF v_gap_pct >= v_pct_threshold AND v_gap_dollars >= v_abs_threshold THEN
    v_result := 'BUY'; v_reasons := array_append(array_append(v_reasons, 'pct_threshold_met'), 'abs_threshold_met');
  ELSE
    v_result := 'WATCH'; v_reasons := array_append(v_reasons, 'below_buy_threshold');
  END IF;

  INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, proven_exit_value, gap_dollars, gap_pct, result, reasons, gate_failures, snapshot)
  VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures, jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven), 'thresholds', jsonb_build_object('pct', v_pct_threshold, 'abs', v_abs_threshold, 'max_gap', v_max_gap_threshold)))
  RETURNING id INTO v_evaluation_id;

  INSERT INTO sales_triggers (listing_id, trigger_type, asking_price, proven_exit_value, gap_dollars, gap_pct, identity_id, config_version)
  VALUES (p_listing_id, v_result, v_listing.asking_price, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_listing.identity_id, p_config_version);

  RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures;
END;
$$;