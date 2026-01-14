-- ============================================================
-- SALES TRIGGERS ENGINE v0 - PART 2: VIEWS, FRESHNESS, SCHEDULING
-- ============================================================

-- ============================================================
-- 1. ADMIN OBSERVABILITY VIEWS
-- ============================================================

-- View: Trigger stats by result
CREATE OR REPLACE VIEW public.trigger_stats_by_result AS
SELECT 
  result,
  config_version,
  COUNT(*) as count,
  DATE(evaluated_at) as eval_date
FROM trigger_evaluations
WHERE evaluated_at >= NOW() - INTERVAL '7 days'
GROUP BY result, config_version, DATE(evaluated_at)
ORDER BY eval_date DESC, result;

-- View: Top gate failures
CREATE OR REPLACE VIEW public.trigger_gate_failure_stats AS
SELECT 
  unnest(gate_failures) as failure_type,
  COUNT(*) as count,
  config_version
FROM trigger_evaluations
WHERE evaluated_at >= NOW() - INTERVAL '7 days'
  AND gate_failures IS NOT NULL 
  AND array_length(gate_failures, 1) > 0
GROUP BY unnest(gate_failures), config_version
ORDER BY count DESC;

-- View: Latest evaluations (for debugging)
CREATE OR REPLACE VIEW public.trigger_evaluations_recent AS
SELECT 
  te.id,
  te.listing_id,
  rl.make,
  rl.model,
  rl.year,
  rl.asking_price,
  te.proven_exit_value,
  te.gap_dollars,
  te.gap_pct,
  te.result,
  te.reasons,
  te.gate_failures,
  te.config_version,
  te.evaluated_at
FROM trigger_evaluations te
LEFT JOIN retail_listings rl ON rl.id = te.listing_id
WHERE te.evaluated_at >= NOW() - INTERVAL '24 hours'
ORDER BY te.evaluated_at DESC
LIMIT 500;

-- View: Triggers emitted in last 24h
CREATE OR REPLACE VIEW public.triggers_emitted_24h AS
SELECT 
  st.id,
  st.listing_id,
  rl.make,
  rl.model,
  rl.year,
  rl.asking_price,
  st.trigger_type,
  st.gap_dollars,
  st.gap_pct,
  st.proven_exit_value as proven_exit_used,
  st.config_version,
  st.created_at,
  st.sent_at
FROM sales_triggers st
LEFT JOIN retail_listings rl ON rl.id = st.listing_id
WHERE st.created_at >= NOW() - INTERVAL '24 hours'
ORDER BY st.created_at DESC;

-- View: Dashboard summary
CREATE OR REPLACE VIEW public.trigger_dashboard_summary AS
SELECT 
  (SELECT COUNT(*) FROM trigger_evaluations WHERE evaluated_at >= NOW() - INTERVAL '24 hours') as evaluations_24h,
  (SELECT COUNT(*) FROM trigger_evaluations WHERE evaluated_at >= NOW() - INTERVAL '24 hours' AND result = 'BUY') as buy_evaluations_24h,
  (SELECT COUNT(*) FROM trigger_evaluations WHERE evaluated_at >= NOW() - INTERVAL '24 hours' AND result = 'WATCH') as watch_evaluations_24h,
  (SELECT COUNT(*) FROM trigger_evaluations WHERE evaluated_at >= NOW() - INTERVAL '24 hours' AND result = 'IGNORE') as ignore_evaluations_24h,
  (SELECT COUNT(*) FROM sales_triggers WHERE created_at >= NOW() - INTERVAL '24 hours') as triggers_emitted_24h,
  (SELECT COUNT(*) FROM sales_triggers WHERE created_at >= NOW() - INTERVAL '24 hours' AND trigger_type = 'BUY') as buy_triggers_24h,
  (SELECT COUNT(*) FROM sales_triggers WHERE created_at >= NOW() - INTERVAL '24 hours' AND trigger_type = 'WATCH') as watch_triggers_24h,
  (SELECT COUNT(*) FROM proven_exits WHERE computed_at >= NOW() - INTERVAL '24 hours') as proven_exits_updated_24h;

-- ============================================================
-- 2. PROVEN EXIT FRESHNESS: Track last evidence update
-- ============================================================

-- Add column to track when evidence last changed
ALTER TABLE public.vehicle_identities 
ADD COLUMN IF NOT EXISTS evidence_updated_at TIMESTAMPTZ DEFAULT NULL;

-- Function to mark identity as needing exit recompute
CREATE OR REPLACE FUNCTION public.mark_identity_evidence_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE vehicle_identities 
  SET evidence_updated_at = NOW()
  WHERE id = NEW.identity_id;
  RETURN NEW;
END;
$$;

-- Trigger on sales_evidence insert/update
DROP TRIGGER IF EXISTS trg_sales_evidence_updated ON sales_evidence;
CREATE TRIGGER trg_sales_evidence_updated
AFTER INSERT OR UPDATE ON sales_evidence
FOR EACH ROW
EXECUTE FUNCTION public.mark_identity_evidence_updated();

-- Function to get identities needing exit recompute
CREATE OR REPLACE FUNCTION public.get_identities_needing_exit_recompute()
RETURNS TABLE (identity_id UUID)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT vi.id
  FROM vehicle_identities vi
  LEFT JOIN proven_exits pe ON pe.identity_id = vi.id
  WHERE 
    vi.evidence_updated_at IS NOT NULL
    AND (
      pe.id IS NULL 
      OR vi.evidence_updated_at > pe.computed_at
    )
  LIMIT 500;
$$;

-- ============================================================
-- 3. EVALUATION SCHEDULING: Track listing evaluation state
-- ============================================================

-- Add columns to retail_listings for evaluation tracking
ALTER TABLE public.retail_listings 
ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_evaluation_result TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS price_changed_at TIMESTAMPTZ DEFAULT NULL;

-- Function to mark price change
CREATE OR REPLACE FUNCTION public.mark_listing_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.asking_price IS DISTINCT FROM NEW.asking_price THEN
    NEW.price_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger on price change
DROP TRIGGER IF EXISTS trg_listing_price_change ON retail_listings;
CREATE TRIGGER trg_listing_price_change
BEFORE UPDATE ON retail_listings
FOR EACH ROW
EXECUTE FUNCTION public.mark_listing_price_change();

-- Function to get listings needing evaluation
CREATE OR REPLACE FUNCTION public.get_listings_needing_evaluation(
  p_max_age_hours INTEGER DEFAULT 24,
  p_limit INTEGER DEFAULT 500
)
RETURNS TABLE (listing_id UUID, reason TEXT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- New listings never evaluated
  SELECT rl.id, 'new_listing'::TEXT
  FROM retail_listings rl
  WHERE rl.last_evaluated_at IS NULL
    AND rl.identity_id IS NOT NULL
    AND rl.delisted_at IS NULL
  
  UNION ALL
  
  -- Listings with price change since last eval
  SELECT rl.id, 'price_changed'::TEXT
  FROM retail_listings rl
  WHERE rl.price_changed_at > rl.last_evaluated_at
    AND rl.identity_id IS NOT NULL
    AND rl.delisted_at IS NULL
  
  UNION ALL
  
  -- Listings with stale evaluation (identity evidence updated)
  SELECT rl.id, 'evidence_updated'::TEXT
  FROM retail_listings rl
  JOIN vehicle_identities vi ON vi.id = rl.identity_id
  JOIN proven_exits pe ON pe.identity_id = vi.id
  WHERE pe.computed_at > rl.last_evaluated_at
    AND rl.delisted_at IS NULL
  
  UNION ALL
  
  -- Listings not evaluated in X hours
  SELECT rl.id, 'stale_evaluation'::TEXT
  FROM retail_listings rl
  WHERE rl.last_evaluated_at < NOW() - (p_max_age_hours || ' hours')::INTERVAL
    AND rl.identity_id IS NOT NULL
    AND rl.delisted_at IS NULL
  
  LIMIT p_limit;
$$;

-- Update evaluate_and_emit_trigger to mark evaluation timestamp
DROP FUNCTION IF EXISTS public.evaluate_and_emit_trigger(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.evaluate_and_emit_trigger(
  p_listing_id UUID,
  p_config_version TEXT DEFAULT 'v0_provisional'
)
RETURNS TABLE (
  result TEXT,
  trigger_id UUID,
  evaluation_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval_result RECORD;
  v_trigger_id UUID;
BEGIN
  -- Run evaluation
  SELECT * INTO v_eval_result 
  FROM public.evaluate_trigger(p_listing_id, p_config_version);

  -- Update listing with evaluation timestamp
  UPDATE retail_listings 
  SET 
    last_evaluated_at = NOW(),
    last_evaluation_result = v_eval_result.result
  WHERE id = p_listing_id;

  -- Emit trigger if BUY or WATCH
  IF v_eval_result.result IN ('BUY', 'WATCH') THEN
    SELECT * INTO v_trigger_id 
    FROM public.emit_sales_trigger(v_eval_result.evaluation_id);
  END IF;

  RETURN QUERY SELECT v_eval_result.result, v_trigger_id, v_eval_result.evaluation_id;
END;
$$;

-- ============================================================
-- 4. BATCH EVALUATION FUNCTION (for nightly backfill)
-- ============================================================

CREATE OR REPLACE FUNCTION public.run_trigger_backfill(
  p_config_version TEXT DEFAULT 'v0_provisional',
  p_batch_size INTEGER DEFAULT 100
)
RETURNS TABLE (
  processed INTEGER,
  buy_count INTEGER,
  watch_count INTEGER,
  ignore_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing RECORD;
  v_result RECORD;
  v_processed INTEGER := 0;
  v_buy INTEGER := 0;
  v_watch INTEGER := 0;
  v_ignore INTEGER := 0;
BEGIN
  -- First, recompute stale proven exits
  FOR v_listing IN 
    SELECT identity_id FROM get_identities_needing_exit_recompute() LIMIT p_batch_size
  LOOP
    PERFORM compute_proven_exit(v_listing.identity_id);
  END LOOP;

  -- Then evaluate listings needing it
  FOR v_listing IN 
    SELECT listing_id FROM get_listings_needing_evaluation(24, p_batch_size)
  LOOP
    SELECT * INTO v_result 
    FROM evaluate_and_emit_trigger(v_listing.listing_id, p_config_version);
    
    v_processed := v_processed + 1;
    
    IF v_result.result = 'BUY' THEN v_buy := v_buy + 1;
    ELSIF v_result.result = 'WATCH' THEN v_watch := v_watch + 1;
    ELSE v_ignore := v_ignore + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_buy, v_watch, v_ignore;
END;
$$;