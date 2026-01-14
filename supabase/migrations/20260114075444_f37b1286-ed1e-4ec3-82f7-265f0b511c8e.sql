-- ============================================================
-- SALES TRIGGERS ENGINE v0 FINALIZATION
-- ============================================================

-- 1. Add missing columns to trigger_evaluations
ALTER TABLE public.trigger_evaluations 
ADD COLUMN IF NOT EXISTS gap_dollars NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS gap_pct NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS snapshot JSONB DEFAULT NULL;

-- 2. Add WATCH gate columns to trigger_config
ALTER TABLE public.trigger_config 
ADD COLUMN IF NOT EXISTS min_sample_size_watch INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS max_sale_age_days_watch INTEGER DEFAULT 365,
ADD COLUMN IF NOT EXISTS guardrail_max_gap INTEGER DEFAULT NULL;

-- Add comment explaining max gap
COMMENT ON COLUMN public.trigger_config.guardrail_max_gap IS 'Maximum allowable gap in dollars. Gaps exceeding this are capped to prevent junk alerts from bad km/variant matches.';

-- 3. Update the default config with WATCH gates
UPDATE public.trigger_config 
SET 
  min_sample_size_watch = 1,
  max_sale_age_days_watch = 365,
  guardrail_max_gap = 15000
WHERE version = 'v0_provisional';

-- 4. Drop and recreate evaluate_trigger with complete logic
DROP FUNCTION IF EXISTS public.evaluate_trigger(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.evaluate_trigger(
  p_listing_id UUID,
  p_config_version TEXT DEFAULT 'v0_provisional'
)
RETURNS TABLE (
  result TEXT,
  reasons TEXT[],
  gate_failures TEXT[],
  evaluation_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing retail_listings%ROWTYPE;
  v_config trigger_config%ROWTYPE;
  v_proven RECORD;
  v_gap_dollars NUMERIC;
  v_gap_pct NUMERIC;
  v_pct_threshold NUMERIC;
  v_abs_threshold NUMERIC;
  v_result TEXT := 'IGNORE';
  v_reasons TEXT[] := '{}';
  v_gate_failures TEXT[] := '{}';
  v_buy_gates_pass BOOLEAN := TRUE;
  v_watch_gates_pass BOOLEAN := TRUE;
  v_evaluation_id UUID;
  v_max_gap_hit BOOLEAN := FALSE;
BEGIN
  -- Load listing
  SELECT * INTO v_listing FROM retail_listings WHERE id = p_listing_id;
  IF v_listing.id IS NULL THEN
    RAISE EXCEPTION 'Listing not found: %', p_listing_id;
  END IF;

  -- Load config
  SELECT * INTO v_config FROM trigger_config WHERE version = p_config_version AND enabled = TRUE;
  IF v_config.version IS NULL THEN
    RAISE EXCEPTION 'Config not found or disabled: %', p_config_version;
  END IF;

  -- Assign thresholds from config
  v_pct_threshold := COALESCE(v_config.guardrail_value_pct, 0);
  v_abs_threshold := COALESCE(v_config.guardrail_value_abs, 0);

  -- Check if listing has identity mapping
  IF v_listing.identity_id IS NULL THEN
    v_result := 'IGNORE';
    v_reasons := v_reasons || 'no_identity_mapping';
    
    INSERT INTO trigger_evaluations (
      listing_id, config_version, identity_id, listing_price, proven_exit_value,
      gap_dollars, gap_pct, result, reasons, gate_failures, snapshot
    ) VALUES (
      p_listing_id, p_config_version, NULL, v_listing.asking_price, NULL,
      NULL, NULL, v_result, v_reasons, v_gate_failures, 
      jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config))
    )
    RETURNING id INTO v_evaluation_id;

    RETURN QUERY SELECT v_result, v_reasons, v_gate_failures, v_evaluation_id;
    RETURN;
  END IF;

  -- Load proven exit
  SELECT 
    pe.exit_value,
    pe.sample_size,
    pe.confidence_label,
    pe.sale_recency_days,
    pe.newest_sale_date
  INTO v_proven
  FROM proven_exits pe
  WHERE pe.identity_id = v_listing.identity_id;

  -- No proven exit → IGNORE
  IF v_proven.exit_value IS NULL THEN
    v_result := 'IGNORE';
    v_reasons := v_reasons || 'no_proven_exit';
    
    INSERT INTO trigger_evaluations (
      listing_id, config_version, identity_id, listing_price, proven_exit_value,
      gap_dollars, gap_pct, result, reasons, gate_failures, snapshot
    ) VALUES (
      p_listing_id, p_config_version, v_listing.identity_id, v_listing.asking_price, NULL,
      NULL, NULL, v_result, v_reasons, v_gate_failures,
      jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config))
    )
    RETURNING id INTO v_evaluation_id;

    RETURN QUERY SELECT v_result, v_reasons, v_gate_failures, v_evaluation_id;
    RETURN;
  END IF;

  -- Calculate gaps
  v_gap_dollars := v_proven.exit_value - v_listing.asking_price;
  IF v_proven.exit_value > 0 THEN
    v_gap_pct := (v_gap_dollars / v_proven.exit_value) * 100;
  ELSE
    v_gap_pct := 0;
  END IF;

  v_reasons := v_reasons || format('gap_dollars=%s', v_gap_dollars);
  v_reasons := v_reasons || format('gap_pct=%s', ROUND(v_gap_pct, 2));

  -- ============================================================
  -- DECISION FLOW (as specified)
  -- ============================================================

  -- Step 1: If gap <= 0 → IGNORE
  IF v_gap_dollars <= 0 THEN
    v_result := 'IGNORE';
    v_reasons := v_reasons || 'gap_not_positive';
    
    INSERT INTO trigger_evaluations (
      listing_id, config_version, identity_id, listing_price, proven_exit_value,
      gap_dollars, gap_pct, result, reasons, gate_failures, snapshot
    ) VALUES (
      p_listing_id, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value,
      v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures,
      jsonb_build_object('listing', row_to_json(v_listing), 'config', row_to_json(v_config), 'proven', row_to_json(v_proven))
    )
    RETURNING id INTO v_evaluation_id;

    RETURN QUERY SELECT v_result, v_reasons, v_gate_failures, v_evaluation_id;
    RETURN;
  END IF;

  -- ============================================================
  -- CHECK GATES
  -- ============================================================

  -- BUY GATES
  IF COALESCE(v_proven.sample_size, 0) < COALESCE(v_config.min_sample_size_buy, 2) THEN
    v_gate_failures := v_gate_failures || format('sample_size<%s', v_config.min_sample_size_buy);
    v_buy_gates_pass := FALSE;
  END IF;

  IF COALESCE(v_proven.sale_recency_days, 9999) > COALESCE(v_config.max_sale_age_days_buy, 270) THEN
    v_gate_failures := v_gate_failures || format('sale_recency>%s', v_config.max_sale_age_days_buy);
    v_buy_gates_pass := FALSE;
  END IF;

  IF v_config.min_confidence_buy = 'high' THEN
    IF COALESCE(v_proven.confidence_label, 'low') <> 'high' THEN
      v_gate_failures := v_gate_failures || 'confidence<high';
      v_buy_gates_pass := FALSE;
    END IF;
  ELSIF v_config.min_confidence_buy = 'medium' THEN
    IF COALESCE(v_proven.confidence_label, 'low') = 'low' THEN
      v_gate_failures := v_gate_failures || 'confidence<medium';
      v_buy_gates_pass := FALSE;
    END IF;
  END IF;

  -- WATCH GATES
  IF COALESCE(v_proven.sample_size, 0) < COALESCE(v_config.min_sample_size_watch, 1) THEN
    v_watch_gates_pass := FALSE;
  END IF;

  IF COALESCE(v_proven.sale_recency_days, 9999) > COALESCE(v_config.max_sale_age_days_watch, 365) THEN
    v_watch_gates_pass := FALSE;
  END IF;

  -- ============================================================
  -- CHECK GUARDRAIL_MAX_GAP (anti-junk cap)
  -- ============================================================
  IF v_config.guardrail_max_gap IS NOT NULL AND v_gap_dollars > v_config.guardrail_max_gap THEN
    v_max_gap_hit := TRUE;
    v_reasons := v_reasons || format('max_gap_cap_hit=%s', v_config.guardrail_max_gap);
  END IF;

  -- ============================================================
  -- DETERMINE RESULT
  -- ============================================================

  IF v_config.guardrail_type = 'layered' THEN
    IF v_gap_pct >= v_pct_threshold AND v_gap_dollars >= v_abs_threshold THEN
      IF v_max_gap_hit THEN
        IF v_watch_gates_pass THEN
          v_result := 'WATCH';
          v_reasons := v_reasons || 'downgraded_max_gap';
        ELSE
          v_result := 'IGNORE';
          v_reasons := v_reasons || 'watch_gates_failed';
        END IF;
      ELSIF v_buy_gates_pass THEN
        v_result := 'BUY';
      ELSE
        IF v_watch_gates_pass THEN
          v_result := 'WATCH';
          v_reasons := v_reasons || 'buy_gates_failed';
        ELSE
          v_result := 'IGNORE';
          v_reasons := v_reasons || 'watch_gates_failed';
        END IF;
      END IF;
    ELSE
      IF v_gap_dollars > 0 AND v_watch_gates_pass AND NOT v_max_gap_hit THEN
        v_result := 'WATCH';
        v_reasons := v_reasons || 'below_buy_threshold';
      ELSIF v_gap_dollars > 0 AND v_watch_gates_pass AND v_max_gap_hit THEN
        v_result := 'WATCH';
        v_reasons := v_reasons || 'below_buy_threshold';
        v_reasons := v_reasons || 'max_gap_applied';
      ELSE
        v_result := 'IGNORE';
        IF NOT v_watch_gates_pass THEN
          v_reasons := v_reasons || 'watch_gates_failed';
        END IF;
      END IF;
    END IF;
  ELSIF v_config.guardrail_type = 'percentage' THEN
    IF v_gap_pct >= v_pct_threshold THEN
      IF v_max_gap_hit THEN
        IF v_watch_gates_pass THEN v_result := 'WATCH'; ELSE v_result := 'IGNORE'; END IF;
      ELSIF v_buy_gates_pass THEN
        v_result := 'BUY';
      ELSIF v_watch_gates_pass THEN
        v_result := 'WATCH';
      ELSE
        v_result := 'IGNORE';
      END IF;
    ELSIF v_gap_dollars > 0 AND v_watch_gates_pass THEN
      v_result := 'WATCH';
    ELSE
      v_result := 'IGNORE';
    END IF;
  ELSIF v_config.guardrail_type = 'absolute' THEN
    IF v_gap_dollars >= v_abs_threshold THEN
      IF v_max_gap_hit THEN
        IF v_watch_gates_pass THEN v_result := 'WATCH'; ELSE v_result := 'IGNORE'; END IF;
      ELSIF v_buy_gates_pass THEN
        v_result := 'BUY';
      ELSIF v_watch_gates_pass THEN
        v_result := 'WATCH';
      ELSE
        v_result := 'IGNORE';
      END IF;
    ELSIF v_gap_dollars > 0 AND v_watch_gates_pass THEN
      v_result := 'WATCH';
    ELSE
      v_result := 'IGNORE';
    END IF;
  ELSE
    v_result := 'IGNORE';
    v_reasons := v_reasons || 'unknown_guardrail_type';
  END IF;

  -- ============================================================
  -- LOG IMMUTABLE EVALUATION
  -- ============================================================
  INSERT INTO trigger_evaluations (
    listing_id, config_version, identity_id, listing_price, proven_exit_value,
    gap_dollars, gap_pct, result, reasons, gate_failures, snapshot
  ) VALUES (
    p_listing_id, p_config_version, v_listing.identity_id, v_listing.asking_price, v_proven.exit_value,
    v_gap_dollars, v_gap_pct, v_result, v_reasons, v_gate_failures,
    jsonb_build_object(
      'listing', row_to_json(v_listing), 
      'config', row_to_json(v_config), 
      'proven', row_to_json(v_proven),
      'thresholds', jsonb_build_object('pct', v_pct_threshold, 'abs', v_abs_threshold, 'max_gap', v_config.guardrail_max_gap)
    )
  )
  RETURNING id INTO v_evaluation_id;

  RETURN QUERY SELECT v_result, v_reasons, v_gate_failures, v_evaluation_id;
END;
$$;