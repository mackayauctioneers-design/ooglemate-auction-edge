-- =============================================================================
-- AUTONOMOUS DEAL FLOW - FINAL FORM
-- =============================================================================

-- 1) Update get_today_actions() to match spec exactly
DROP FUNCTION IF EXISTS get_today_actions();

CREATE OR REPLACE FUNCTION get_today_actions()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
SELECT jsonb_build_object(
  'buy_window_unassigned', (
    SELECT count(*) FROM vehicle_listings
    WHERE watch_status = 'buy_window'
      AND assigned_to IS NULL
      AND lifecycle_state NOT IN ('AVOID', 'SOLD', 'CLEARED')
      AND NOT COALESCE(sold_returned_suspected, false)
  ),
  'buy_window_stale', (
    SELECT count(*) FROM vehicle_listings
    WHERE watch_status = 'buy_window'
      AND assigned_to IS NULL
      AND buy_window_at < now() - interval '36 hours'
      AND lifecycle_state NOT IN ('AVOID', 'SOLD', 'CLEARED')
      AND NOT COALESCE(sold_returned_suspected, false)
  ),
  'va_tasks_due', (
    SELECT count(*) FROM va_tasks
    WHERE status IN ('todo', 'in_progress')
      AND (due_at IS NULL OR due_at < now() + interval '24 hours')
  ),
  'va_tasks_overdue', (
    SELECT count(*) FROM va_tasks
    WHERE status IN ('todo', 'in_progress')
      AND due_at < now()
  ),
  'trap_validation_pending', (
    SELECT count(*) FROM dealer_traps
    WHERE validation_status = 'pending'
      AND enabled = true
  ),
  'missed_buy_window_7d', (
    SELECT count(*) FROM missed_buy_window
    WHERE sold_date > now() - interval '7 days'
  ),
  'top_buy_window', (
    SELECT jsonb_agg(row_to_json(t)) FROM (
      SELECT 
        id, 
        make, 
        model, 
        year, 
        location,
        watch_confidence,
        buy_window_at,
        asking_price
      FROM vehicle_listings
      WHERE watch_status = 'buy_window'
        AND assigned_to IS NULL
        AND lifecycle_state NOT IN ('AVOID', 'SOLD', 'CLEARED')
        AND NOT COALESCE(sold_returned_suspected, false)
      ORDER BY 
        CASE watch_confidence 
          WHEN 'high' THEN 1 
          WHEN 'medium' THEN 2 
          ELSE 3 
        END,
        buy_window_at ASC
      LIMIT 5
    ) t
  ),
  'run_at', now()
);
$$;

-- 2) Update escalate_stale_va_tasks() - safer version
DROP FUNCTION IF EXISTS escalate_stale_va_tasks();

CREATE OR REPLACE FUNCTION escalate_stale_va_tasks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  n int;
BEGIN
  UPDATE va_tasks
  SET priority = 'high', updated_at = now()
  WHERE status = 'todo'
    AND due_at < now()
    AND priority <> 'high';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('escalated', n, 'run_at', now());
END;
$$;

-- 3) Update flag_stale_buy_windows() - safer version
DROP FUNCTION IF EXISTS flag_stale_buy_windows();

CREATE OR REPLACE FUNCTION flag_stale_buy_windows()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  n int;
BEGIN
  UPDATE vehicle_listings
  SET watch_reason = concat(
        coalesce(watch_reason, ''), 
        CASE WHEN coalesce(watch_reason, '') <> '' THEN ' | ' ELSE '' END,
        'STALE_BUY_WINDOW'
      ),
      updated_at = now()
  WHERE watch_status = 'buy_window'
    AND assigned_to IS NULL
    AND buy_window_at < now() - interval '36 hours'
    AND (watch_reason IS NULL OR watch_reason NOT LIKE '%STALE_BUY_WINDOW%')
    AND lifecycle_state NOT IN ('AVOID', 'SOLD', 'CLEARED')
    AND NOT COALESCE(sold_returned_suspected, false);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('flagged', n, 'run_at', now());
END;
$$;

-- 4) Grant execute permissions
GRANT EXECUTE ON FUNCTION get_today_actions() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION escalate_stale_va_tasks() TO authenticated;
GRANT EXECUTE ON FUNCTION flag_stale_buy_windows() TO authenticated;