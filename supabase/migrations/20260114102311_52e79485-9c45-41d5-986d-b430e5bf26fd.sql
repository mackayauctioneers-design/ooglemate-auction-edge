-- ============================================================
-- Trigger Quality v1: WATCH floors, listing age, re-alert, completeness
-- ============================================================

-- 1) Extend trigger_config with new columns
ALTER TABLE trigger_config
  ADD COLUMN IF NOT EXISTS watch_min_gap_abs INTEGER DEFAULT 250,
  ADD COLUMN IF NOT EXISTS watch_min_gap_pct NUMERIC(5,2) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS max_listing_age_days_buy INTEGER DEFAULT 7,
  ADD COLUMN IF NOT EXISTS max_listing_age_days_watch INTEGER DEFAULT 14,
  ADD COLUMN IF NOT EXISTS realert_cooldown_hours INTEGER DEFAULT 24,
  ADD COLUMN IF NOT EXISTS realert_min_price_drop_pct NUMERIC(5,2) DEFAULT 2.0;

-- Update v0_provisional with defaults
UPDATE trigger_config
SET 
  watch_min_gap_abs = 250,
  watch_min_gap_pct = 1.0,
  max_listing_age_days_buy = 7,
  max_listing_age_days_watch = 14,
  realert_cooldown_hours = 24,
  realert_min_price_drop_pct = 2.0
WHERE version = 'v0_provisional';

-- 2) Add sent_price to sales_triggers for re-alert tracking
ALTER TABLE sales_triggers
  ADD COLUMN IF NOT EXISTS sent_price INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- 3) Add listing_age_days, listing_first_seen to trigger_evaluations for QA
ALTER TABLE trigger_evaluations
  ADD COLUMN IF NOT EXISTS listing_age_days INTEGER,
  ADD COLUMN IF NOT EXISTS confidence_label TEXT;

-- 4) Drop and recreate evaluate_trigger with all new logic
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
  v_listing_age_days INTEGER;
  v_buy_passed BOOLEAN := FALSE;
BEGIN
  -- Fetch listing
  SELECT * INTO v_listing FROM retail_listings rl WHERE rl.id = p_listing_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found: %', p_listing_id; END IF;

  -- Fetch config
  SELECT * INTO v_config FROM trigger_config tc WHERE tc.version = p_config_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Config not found: %', p_config_version; END IF;

  -- Calculate listing age
  v_listing_age_days := COALESCE((CURRENT_DATE - v_listing.first_seen_at::date), 0);

  -- ============ COMPLETENESS GATE (missing required fields) ============
  IF v_listing.year IS NULL OR v_listing.make IS NULL OR v_listing.model IS NULL THEN
    v_result := 'IGNORE';
    v_gate_failures := array_append(v_gate_failures, 'missing_required_fields');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, listing_km, listing_age_days, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_listing.km, v_listing_age_days, v_result, v_reasons, v_gate_failures, 
            jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, NULL::NUMERIC, NULL::NUMERIC, v_reasons, v_gate_failures; RETURN;
  END IF;

  -- Fetch proven exit
  SELECT * INTO v_proven FROM proven_exits pe WHERE pe.identity_id = v_listing.identity_id;

  v_pct_threshold := v_config.guardrail_value_pct;
  v_abs_threshold := v_config.guardrail_value_abs;
  v_max_gap_threshold := COALESCE(v_config.guardrail_max_gap, 15000);
  v_min_confidence_rank := CASE v_config.min_confidence_buy WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END;

  -- No proven exit → IGNORE
  IF v_proven IS NULL THEN
    v_result := 'IGNORE'; v_gate_failures := array_append(v_gate_failures, 'no_proven_exit');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, listing_km, listing_age_days, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_listing.km, v_listing_age_days, v_result, v_reasons, v_gate_failures, 
            jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, NULL::NUMERIC, NULL::NUMERIC, v_reasons, v_gate_failures; RETURN;
  END IF;

  v_gap_dollars := v_proven.exit_value - v_listing.asking_price;
  v_gap_pct := ROUND((v_gap_dollars / NULLIF(v_proven.exit_value::NUMERIC, 0)) * 100, 2);
  v_proven_confidence_rank := CASE v_proven.confidence_label WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END;

  -- Gap not positive → IGNORE
  IF v_gap_dollars <= 0 THEN
    v_result := 'IGNORE'; v_reasons := array_append(v_reasons, 'gap_not_positive');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, listing_km, listing_age_days, proven_exit_value, gap_dollars, gap_pct, sample_size, sale_recency_days, confidence_label, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_listing.km, v_listing_age_days, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_proven.sample_size, v_proven.sale_recency_days, v_proven.confidence_label, v_result, v_reasons, v_gate_failures, 
            jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  -- Confidence gate
  IF v_proven_confidence_rank < v_min_confidence_rank THEN
    v_result := 'IGNORE'; v_gate_failures := array_append(v_gate_failures, 'confidence_too_low');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, listing_km, listing_age_days, proven_exit_value, gap_dollars, gap_pct, sample_size, sale_recency_days, confidence_label, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_listing.km, v_listing_age_days, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_proven.sample_size, v_proven.sale_recency_days, v_proven.confidence_label, v_result, v_reasons, v_gate_failures, 
            jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  -- Recency gate (270 days max for evidence)
  IF v_proven.sale_recency_days > 270 THEN
    v_result := 'IGNORE'; v_gate_failures := array_append(v_gate_failures, 'stale_evidence');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, listing_km, listing_age_days, proven_exit_value, gap_dollars, gap_pct, sample_size, sale_recency_days, confidence_label, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_listing.km, v_listing_age_days, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_proven.sample_size, v_proven.sale_recency_days, v_proven.confidence_label, v_result, v_reasons, v_gate_failures, 
            jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  -- Max gap guardrail (cap to WATCH if gap suspiciously large)
  IF v_gap_dollars > v_max_gap_threshold THEN
    v_result := 'WATCH'; v_reasons := array_append(v_reasons, 'exceeds_max_gap');
    INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, listing_km, listing_age_days, proven_exit_value, gap_dollars, gap_pct, sample_size, sale_recency_days, confidence_label, result, reasons, gate_failures, snapshot)
    VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_listing.km, v_listing_age_days, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_proven.sample_size, v_proven.sale_recency_days, v_proven.confidence_label, v_result, v_reasons, v_gate_failures, 
            jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven)))
    RETURNING id INTO v_evaluation_id;
    RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures; RETURN;
  END IF;

  -- ============ BUY EVALUATION ============
  -- Check if BUY thresholds pass: gap >= pct% AND gap >= $abs
  v_buy_passed := (v_gap_pct >= v_pct_threshold AND v_gap_dollars >= v_abs_threshold);

  -- ============ COMPLETENESS PENALTY: missing km → NEVER BUY ============
  IF v_listing.km IS NULL THEN
    v_buy_passed := FALSE;
    v_reasons := array_append(v_reasons, 'missing_km_buy_blocked');
  END IF;

  -- ============ LISTING AGE GATING ============
  IF v_buy_passed THEN
    IF v_listing_age_days > v_config.max_listing_age_days_buy THEN
      -- Downgrade BUY to WATCH due to age
      v_buy_passed := FALSE;
      v_reasons := array_append(v_reasons, 'listing_too_old_for_buy');
    END IF;
  END IF;

  -- Determine result: BUY or WATCH
  IF v_buy_passed THEN
    v_result := 'BUY';
    v_reasons := array_append(array_append(v_reasons, 'pct_threshold_met'), 'abs_threshold_met');
  ELSE
    -- Check if WATCH gates pass
    -- WATCH requires: gap_dollars >= watch_min_gap_abs OR gap_pct >= watch_min_gap_pct
    IF v_gap_dollars >= v_config.watch_min_gap_abs OR v_gap_pct >= v_config.watch_min_gap_pct THEN
      -- Check listing age for WATCH
      IF v_listing_age_days > v_config.max_listing_age_days_watch THEN
        v_result := 'IGNORE';
        v_reasons := array_append(v_reasons, 'listing_too_old_for_watch');
      ELSE
        v_result := 'WATCH';
        IF v_gap_dollars >= v_config.watch_min_gap_abs THEN
          v_reasons := array_append(v_reasons, 'watch_abs_floor_met');
        END IF;
        IF v_gap_pct >= v_config.watch_min_gap_pct THEN
          v_reasons := array_append(v_reasons, 'watch_pct_floor_met');
        END IF;
      END IF;
    ELSE
      -- Gap positive but below WATCH floors → IGNORE
      v_result := 'IGNORE';
      v_reasons := array_append(v_reasons, 'below_watch_floor');
    END IF;
  END IF;

  INSERT INTO trigger_evaluations (listing_id, listing_source, config_version, identity_id, listing_price, listing_km, listing_age_days, proven_exit_value, gap_dollars, gap_pct, sample_size, sale_recency_days, confidence_label, result, reasons, gate_failures, snapshot)
  VALUES (p_listing_id, v_listing.source, p_config_version, v_listing.identity_id, v_listing.asking_price, v_listing.km, v_listing_age_days, v_proven.exit_value, v_gap_dollars, v_gap_pct, v_proven.sample_size, v_proven.sale_recency_days, v_proven.confidence_label, v_result, v_reasons, v_gate_failures, 
          jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven), 'thresholds', jsonb_build_object('pct', v_pct_threshold, 'abs', v_abs_threshold, 'max_gap', v_max_gap_threshold, 'watch_min_gap_abs', v_config.watch_min_gap_abs, 'watch_min_gap_pct', v_config.watch_min_gap_pct)))
  RETURNING id INTO v_evaluation_id;

  RETURN QUERY SELECT v_evaluation_id, v_result, v_gap_dollars, v_gap_pct, v_reasons, v_gate_failures;
END;
$$;

-- 5) Update emit_sales_trigger to handle re-alert suppression
DROP FUNCTION IF EXISTS emit_sales_trigger(UUID);

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
  v_existing_trigger RECORD;
  v_config RECORD;
  v_should_realert BOOLEAN := TRUE;
  v_price_drop_pct NUMERIC;
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
  
  -- Get config for re-alert suppression settings
  SELECT * INTO v_config FROM trigger_config tc WHERE tc.version = v_eval.config_version;

  -- Check for existing trigger to handle re-alert suppression
  SELECT * INTO v_existing_trigger 
  FROM sales_triggers st 
  WHERE st.listing_id = v_eval.listing_id AND st.config_version = v_eval.config_version;

  IF v_existing_trigger IS NOT NULL AND v_existing_trigger.sent_at IS NOT NULL THEN
    -- Check if re-alert is allowed
    v_should_realert := FALSE;
    
    -- Check cooldown
    IF EXTRACT(EPOCH FROM (now() - v_existing_trigger.sent_at))/3600 >= COALESCE(v_config.realert_cooldown_hours, 24) THEN
      -- Check price drop
      IF v_existing_trigger.sent_price IS NOT NULL AND v_eval.listing_price < v_existing_trigger.sent_price THEN
        v_price_drop_pct := ((v_existing_trigger.sent_price - v_eval.listing_price)::NUMERIC / v_existing_trigger.sent_price) * 100;
        IF v_price_drop_pct >= COALESCE(v_config.realert_min_price_drop_pct, 2.0) THEN
          v_should_realert := TRUE;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Insert/update sales_triggers row
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
    evaluation_id,
    sample_size,
    confidence_label
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
    p_evaluation_id,
    v_eval.sample_size,
    v_eval.confidence_label
  )
  ON CONFLICT (listing_id, config_version) 
  DO UPDATE SET
    trigger_type = EXCLUDED.trigger_type,
    asking_price = EXCLUDED.asking_price,
    proven_exit_value = EXCLUDED.proven_exit_value,
    gap_dollars = EXCLUDED.gap_dollars,
    gap_pct = EXCLUDED.gap_pct,
    evaluation_id = EXCLUDED.evaluation_id,
    sample_size = EXCLUDED.sample_size,
    confidence_label = EXCLUDED.confidence_label,
    updated_at = now()
    -- Note: sent_at and sent_price NOT updated here - that happens in notification layer
  RETURNING id INTO v_trigger_id;

  RETURN v_trigger_id;
END;
$$;

-- 6) Create QA view: trigger_qa_recent
CREATE OR REPLACE VIEW trigger_qa_recent AS
SELECT 
  te.id AS evaluation_id,
  te.evaluated_at,
  te.listing_source AS source,
  rl.year,
  rl.make,
  rl.model,
  rl.variant_family,
  rl.km,
  rl.asking_price,
  te.proven_exit_value,
  te.gap_dollars::INTEGER AS gap_dollars,
  te.gap_pct,
  te.sample_size,
  te.sale_recency_days,
  te.confidence_label,
  te.result,
  te.reasons,
  te.gate_failures,
  rl.first_seen_at,
  te.listing_age_days,
  rl.listing_url,
  te.listing_id,
  te.snapshot
FROM trigger_evaluations te
LEFT JOIN retail_listings rl ON rl.id = te.listing_id
ORDER BY te.evaluated_at DESC
LIMIT 500;

COMMENT ON VIEW trigger_qa_recent IS 'Last 500 trigger evaluations with full context for QA tuning';

-- Grant access
GRANT SELECT ON trigger_qa_recent TO authenticated;
GRANT SELECT ON trigger_qa_recent TO service_role;