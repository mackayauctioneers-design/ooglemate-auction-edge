-- Update rpc_evaluate_candidates to include price gap logic for BUY/WATCH decisions
-- BUY: price <= proven_exit_value * 0.92 (8% under) AND score >= 7.0
-- WATCH: price <= proven_exit_value * 1.0 (at or under) AND score >= 5.0

CREATE OR REPLACE FUNCTION rpc_evaluate_candidates(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version int;
  v_updated int := 0;
  v_buy_count int := 0;
  v_watch_count int := 0;
  v_exit_value numeric;
  v_buy_threshold numeric;
  v_watch_threshold numeric;
BEGIN
  -- Get hunt version and proven exit value
  SELECT h.criteria_version, h.proven_exit_value
  INTO v_version, v_exit_value
  FROM sale_hunts h
  WHERE h.id = p_hunt_id;

  IF v_version IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Hunt not found');
  END IF;

  -- Calculate thresholds:
  -- BUY: Must be at least 8% under exit value (price <= exit * 0.92)
  -- WATCH: Can be at or under exit value (price <= exit * 1.0)
  v_buy_threshold := COALESCE(v_exit_value * 0.92, 999999999);
  v_watch_threshold := COALESCE(v_exit_value * 1.0, 999999999);

  -- Phase 2: Promote DISCOVERED → BUY/WATCH with price gating
  UPDATE public.hunt_unified_candidates
  SET
    decision =
      CASE
        -- BUY: verified, has price, under buy threshold, high score
        WHEN verified = true 
          AND price IS NOT NULL 
          AND v_exit_value IS NOT NULL
          AND price <= v_buy_threshold
          AND COALESCE(dna_score,0) >= 7.0 
        THEN 'BUY'
        
        -- WATCH: has price under watch threshold OR high score without price
        WHEN price IS NOT NULL 
          AND v_exit_value IS NOT NULL
          AND price <= v_watch_threshold
          AND COALESCE(dna_score,0) >= 5.0 
        THEN 'WATCH'
        
        -- WATCH: high score but no price (discovery mode)
        WHEN COALESCE(dna_score,0) >= 6.0 
        THEN 'WATCH'
        
        -- Stay in DISCOVERED
        ELSE 'DISCOVERED'
      END,
    candidate_stage =
      CASE
        WHEN verified = true 
          AND price IS NOT NULL 
          AND v_exit_value IS NOT NULL
          AND price <= v_buy_threshold
          AND COALESCE(dna_score,0) >= 7.0 
        THEN 'MONITORED'
        
        WHEN (price IS NOT NULL 
              AND v_exit_value IS NOT NULL
              AND price <= v_watch_threshold
              AND COALESCE(dna_score,0) >= 5.0)
          OR COALESCE(dna_score,0) >= 6.0
        THEN 'MONITORED'
        
        ELSE 'DISCOVERED'
      END,
    -- Store gap info for display
    gap_dollars = CASE 
      WHEN price IS NOT NULL AND v_exit_value IS NOT NULL 
      THEN v_exit_value - price 
      ELSE NULL 
    END,
    gap_pct = CASE 
      WHEN price IS NOT NULL AND v_exit_value IS NOT NULL AND v_exit_value > 0
      THEN ROUND(((v_exit_value - price) / v_exit_value * 100)::numeric, 1)
      ELSE NULL 
    END
  WHERE hunt_id = p_hunt_id
    AND criteria_version = v_version
    AND decision = 'DISCOVERED'
    AND COALESCE(blocked_reason,'') = '';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Count results
  SELECT 
    COUNT(*) FILTER (WHERE decision = 'BUY'),
    COUNT(*) FILTER (WHERE decision = 'WATCH')
  INTO v_buy_count, v_watch_count
  FROM hunt_unified_candidates
  WHERE hunt_id = p_hunt_id AND criteria_version = v_version;

  RETURN jsonb_build_object(
    'success', true,
    'hunt_id', p_hunt_id,
    'criteria_version', v_version,
    'evaluated', v_updated,
    'buy_count', v_buy_count,
    'watch_count', v_watch_count,
    'thresholds', jsonb_build_object(
      'exit_value', v_exit_value,
      'buy_max_price', v_buy_threshold,
      'watch_max_price', v_watch_threshold
    )
  );
END;
$$;