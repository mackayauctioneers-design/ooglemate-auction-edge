-- ============================================================
-- AUTONOMOUS DEAL FLOW - FINALISATION BLOCK
-- ============================================================

-- 1) Missed Buy Window view - shows BUY_WINDOW cars that sold without action
CREATE OR REPLACE VIEW missed_buy_window AS
SELECT
  vl.id,
  vl.listing_id,
  vl.make,
  vl.model,
  vl.variant_used,
  vl.year,
  vl.km,
  vl.location,
  vl.buy_window_at,
  vl.watch_confidence,
  vl.asking_price,
  vl.source,
  ce.cleared_at AS sold_date,
  ce.days_to_clear
FROM vehicle_listings vl
JOIN clearance_events ce ON ce.listing_id = vl.id
WHERE vl.watch_status = 'buy_window'
  AND vl.assigned_to IS NULL
  AND ce.clearance_type = 'sold'
  AND ce.cleared_at > vl.buy_window_at;

-- 2) Get Today Actions RPC - single source of truth for daily priorities
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
        buy_window_at
      FROM vehicle_listings
      WHERE watch_status = 'buy_window'
        AND assigned_to IS NULL
        AND lifecycle_state NOT IN ('AVOID', 'SOLD', 'CLEARED')
      ORDER BY 
        CASE watch_confidence 
          WHEN 'high' THEN 1 
          WHEN 'medium' THEN 2 
          ELSE 3 
        END,
        buy_window_at ASC
      LIMIT 5
    ) t
  )
);
$$;

-- 3) Escalate stale VA tasks function
CREATE OR REPLACE FUNCTION escalate_stale_va_tasks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  escalated_count integer;
BEGIN
  -- Escalate VA tasks if untouched after due_at
  UPDATE va_tasks
  SET priority = 'high',
      updated_at = now()
  WHERE status = 'todo'
    AND due_at < now()
    AND priority <> 'high';
  
  GET DIAGNOSTICS escalated_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'escalated', escalated_count,
    'run_at', now()
  );
END;
$$;

-- 4) Flag stale buy window listings function
CREATE OR REPLACE FUNCTION flag_stale_buy_windows()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  flagged_count integer;
BEGIN
  UPDATE vehicle_listings
  SET watch_reason = CONCAT(
    COALESCE(watch_reason, ''),
    CASE WHEN watch_reason IS NOT NULL AND watch_reason <> '' THEN ' | ' ELSE '' END,
    'STALE_BUY_WINDOW'
  ),
  updated_at = now()
  WHERE watch_status = 'buy_window'
    AND buy_window_at < now() - interval '36 hours'
    AND assigned_to IS NULL
    AND watch_reason NOT LIKE '%STALE_BUY_WINDOW%';
  
  GET DIAGNOSTICS flagged_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'flagged', flagged_count,
    'run_at', now()
  );
END;
$$;