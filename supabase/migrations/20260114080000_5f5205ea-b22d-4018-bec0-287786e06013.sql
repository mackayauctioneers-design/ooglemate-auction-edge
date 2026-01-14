-- ============================================================
-- SALES TRIGGERS ENGINE v0 - FIXES
-- ============================================================

-- 1. Ensure v0_provisional config exists with correct values
INSERT INTO trigger_config (
  version,
  guardrail_type,
  guardrail_value_pct,
  guardrail_value_abs,
  guardrail_max_gap,
  min_sample_size_buy,
  max_sale_age_days_buy,
  min_confidence_buy,
  min_sample_size_watch,
  max_sale_age_days_watch,
  exit_method,
  is_provisional,
  provisional_notes
) VALUES (
  'v0_provisional',
  'layered',
  5.0,
  500,
  15000,
  2,
  270,
  'medium',
  1,
  365,
  'median',
  TRUE,
  'v0 provisional: layered guardrail requires BOTH 5% AND $500 gap. Max gap cap at $15k.'
)
ON CONFLICT (version) DO UPDATE SET
  guardrail_type = EXCLUDED.guardrail_type,
  guardrail_value_pct = EXCLUDED.guardrail_value_pct,
  guardrail_value_abs = EXCLUDED.guardrail_value_abs,
  guardrail_max_gap = EXCLUDED.guardrail_max_gap,
  min_sample_size_buy = EXCLUDED.min_sample_size_buy,
  max_sale_age_days_buy = EXCLUDED.max_sale_age_days_buy,
  min_confidence_buy = EXCLUDED.min_confidence_buy,
  min_sample_size_watch = EXCLUDED.min_sample_size_watch,
  max_sale_age_days_watch = EXCLUDED.max_sale_age_days_watch,
  exit_method = EXCLUDED.exit_method,
  is_provisional = EXCLUDED.is_provisional,
  provisional_notes = EXCLUDED.provisional_notes;

-- 2. Drop and recreate evaluate_trigger with FIXED logic
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
  v_max_gap_threshold NUMERIC;
  v_result TEXT := 'IGNORE';
  v_reasons TEXT[] := '{}';
  v_gate_failures TEXT[] := '{}';
  v_buy_gates_pass BOOLEAN := TRUE;
  v_watch_gates_pass BOOLEAN := TRUE;
  v_evaluation_id UUID;
  v_max_gap_hit BOOLEAN := FALSE;
  v_config_confidence TEXT;
  v_proven_confidence TEXT;
  v_confidence_rank INTEGER;
  v_required_rank INTEGER;
BEGIN
  -- Load listing
  SELECT * INTO v_listing FROM retail_listings WHERE id = p_listing_id;
  IF v_listing.id IS NULL THEN
    RAISE EXCEPTION 'Listing not found: %', p_listing_id;
  END IF;

  -- Load config (check is_provisional or active_from/active_to if needed)
  SELECT * INTO v_config FROM trigger_config WHERE version = p_config_version;
  IF v_config.version IS NULL THEN
    RAISE EXCEPTION 'Config not found: %', p_config_version;
  END IF;

  -- Assign thresholds from config (NOT hardcoded)
  v_pct_threshold := COALESCE(v_config.guardrail_value_pct, 0);
  v_abs_threshold := COALESCE(v_config.guardrail_value_abs, 0);
  v_max_gap_threshold := v_config.guardrail_max_gap; -- can be NULL

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

  -- ============================================================
  -- Calculate gaps with NUMERIC division (FIX #1)
  -- ============================================================
  v_gap_dollars := v_proven.exit_value::NUMERIC - v_listing.asking_price::NUMERIC;
  
  IF v_proven.exit_value > 0 THEN
    v_gap_pct := (v_gap_dollars / v_proven.exit_value::NUMERIC) * 100.0;
  ELSE
    v_gap_pct := 0;
  END IF;

  v_reasons := v_reasons || format('gap_dollars=%s', ROUND(v_gap_dollars, 2));
  v_reasons := v_reasons || format('gap_pct=%s', ROUND(v_gap_pct, 2));

  -- ============================================================
  -- DECISION FLOW
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
  -- CHECK BUY GATES
  -- ============================================================

  -- Gate: sample_size
  IF COALESCE(v_proven.sample_size, 0) < COALESCE(v_config.min_sample_size_buy, 2) THEN
    v_gate_failures := v_gate_failures || format('sample_size<%s', v_config.min_sample_size_buy);
    v_buy_gates_pass := FALSE;
  END IF;

  -- Gate: sale_recency
  IF COALESCE(v_proven.sale_recency_days, 9999) > COALESCE(v_config.max_sale_age_days_buy, 270) THEN
    v_gate_failures := v_gate_failures || format('sale_recency>%s', v_config.max_sale_age_days_buy);
    v_buy_gates_pass := FALSE;
  END IF;

  -- ============================================================
  -- Gate: confidence (FIX #2 - clean ordered logic)
  -- Ranking: high=3, medium=2, low=1
  -- ============================================================
  v_config_confidence := COALESCE(v_config.min_confidence_buy, 'low');
  v_proven_confidence := COALESCE(v_proven.confidence_label, 'low');
  
  -- Convert to numeric rank for comparison
  v_required_rank := CASE v_config_confidence
    WHEN 'high' THEN 3
    WHEN 'medium' THEN 2
    WHEN 'low' THEN 1
    ELSE 1
  END;
  
  v_confidence_rank := CASE v_proven_confidence
    WHEN 'high' THEN 3
    WHEN 'medium' THEN 2
    WHEN 'low' THEN 1
    ELSE 1
  END;
  
  IF v_confidence_rank < v_required_rank THEN
    v_gate_failures := v_gate_failures || format('confidence<%s', v_config_confidence);
    v_buy_gates_pass := FALSE;
  END IF;

  -- ============================================================
  -- CHECK WATCH GATES
  -- ============================================================
  IF COALESCE(v_proven.sample_size, 0) < COALESCE(v_config.min_sample_size_watch, 1) THEN
    v_watch_gates_pass := FALSE;
  END IF;

  IF COALESCE(v_proven.sale_recency_days, 9999) > COALESCE(v_config.max_sale_age_days_watch, 365) THEN
    v_watch_gates_pass := FALSE;
  END IF;

  -- ============================================================
  -- CHECK GUARDRAIL_MAX_GAP (from config, FIX #4)
  -- ============================================================
  IF v_max_gap_threshold IS NOT NULL AND v_gap_dollars > v_max_gap_threshold THEN
    v_max_gap_hit := TRUE;
    v_reasons := v_reasons || format('max_gap_cap_hit=%s', v_max_gap_threshold);
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
      'thresholds', jsonb_build_object('pct', v_pct_threshold, 'abs', v_abs_threshold, 'max_gap', v_max_gap_threshold)
    )
  )
  RETURNING id INTO v_evaluation_id;

  RETURN QUERY SELECT v_result, v_reasons, v_gate_failures, v_evaluation_id;
END;
$$;

-- ============================================================
-- 3. Schedule nightly cron job
-- ============================================================

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the nightly backfill at 3:00 AM UTC
SELECT cron.schedule(
  'trigger-backfill-nightly',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/trigger-backfill-nightly',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);