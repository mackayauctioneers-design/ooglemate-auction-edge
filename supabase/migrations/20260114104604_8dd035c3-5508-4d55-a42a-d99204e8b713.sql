-- 1. Add should_notify and notify_reason to sales_triggers
ALTER TABLE public.sales_triggers 
ADD COLUMN IF NOT EXISTS should_notify BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS notify_reason TEXT NULL;

-- 2. Update emit_sales_trigger to set should_notify based on v_should_realert
CREATE OR REPLACE FUNCTION public.emit_sales_trigger(
  p_listing_id UUID,
  p_evaluation_id UUID,
  p_trigger_type TEXT,
  p_gap_dollars NUMERIC,
  p_gap_pct NUMERIC,
  p_proven_exit_value NUMERIC,
  p_config_version INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_config RECORD;
  v_should_realert BOOLEAN := true;
  v_notify_reason TEXT := NULL;
  v_trigger_id UUID;
  v_price_drop_pct NUMERIC;
  v_listing RECORD;
BEGIN
  -- Get current config
  SELECT realert_cooldown_hours, realert_min_price_drop_pct
  INTO v_config
  FROM trigger_config
  WHERE is_active = true
  LIMIT 1;
  
  -- Get current listing price
  SELECT asking_price INTO v_listing
  FROM retail_listings
  WHERE id = p_listing_id;
  
  -- Check for existing trigger with same listing and type
  SELECT id, sent_at, sent_price, created_at
  INTO v_existing
  FROM sales_triggers
  WHERE listing_id = p_listing_id
    AND trigger_type = p_trigger_type
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- Apply re-alert suppression logic
  IF v_existing.id IS NOT NULL AND v_existing.sent_at IS NOT NULL THEN
    -- Check cooldown period
    IF NOW() < v_existing.sent_at + (COALESCE(v_config.realert_cooldown_hours, 24) || ' hours')::INTERVAL THEN
      v_should_realert := false;
      v_notify_reason := 'cooldown_active';
    ELSE
      -- Check price drop requirement
      IF v_existing.sent_price IS NOT NULL AND v_listing.asking_price IS NOT NULL THEN
        v_price_drop_pct := ((v_existing.sent_price - v_listing.asking_price) / v_existing.sent_price) * 100;
        IF v_price_drop_pct < COALESCE(v_config.realert_min_price_drop_pct, 2.0) THEN
          v_should_realert := false;
          v_notify_reason := 'insufficient_price_drop';
        END IF;
      END IF;
    END IF;
  END IF;
  
  -- Insert trigger with should_notify flag
  INSERT INTO sales_triggers (
    listing_id,
    evaluation_id,
    trigger_type,
    gap_dollars,
    gap_pct,
    proven_exit_value,
    config_version,
    should_notify,
    notify_reason
  ) VALUES (
    p_listing_id,
    p_evaluation_id,
    p_trigger_type,
    p_gap_dollars,
    p_gap_pct,
    p_proven_exit_value,
    p_config_version,
    v_should_realert,
    v_notify_reason
  )
  RETURNING id INTO v_trigger_id;
  
  RETURN v_trigger_id;
END;
$$;

-- 3. Security: Revoke QA view access from authenticated, restrict to service_role only
REVOKE ALL ON trigger_qa_recent FROM authenticated;
REVOKE ALL ON trigger_qa_recent FROM anon;
GRANT SELECT ON trigger_qa_recent TO service_role;