-- View of blocked sources (auctions + traps)
CREATE OR REPLACE VIEW public.va_blocked_sources AS
SELECT
  'auction'::text AS source_type,
  a.source_key AS source_key,
  a.display_name AS display_name,
  a.list_url AS url,
  a.region_hint AS region_id,
  a.preflight_status AS preflight_status,
  a.preflight_reason AS reason,
  a.updated_at AS last_checked_at
FROM public.auction_sources a
WHERE a.enabled = false
  AND (a.preflight_status IN ('blocked','fail','timeout')
       OR a.validation_status LIKE 'disabled_%')

UNION ALL

SELECT
  'trap'::text AS source_type,
  dt.trap_slug AS source_key,
  COALESCE(dt.dealer_name, dt.trap_slug) AS display_name,
  dt.inventory_url AS url,
  dt.region_id AS region_id,
  dt.preflight_status AS preflight_status,
  dt.preflight_reason AS reason,
  dt.preflight_checked_at AS last_checked_at
FROM public.dealer_traps dt
WHERE dt.enabled = false
  AND (dt.preflight_status IN ('blocked','fail','timeout')
       OR dt.validation_status LIKE 'disabled_%');

-- Dedup constraint: one open blocked_source task per URL (simpler - no date_trunc)
CREATE UNIQUE INDEX IF NOT EXISTS va_tasks_blocked_source_dedup
ON public.va_tasks (task_type, listing_url)
WHERE task_type = 'blocked_source' AND status IN ('todo','in_progress','blocked');

-- Spawn VA tasks from blocked sources (dedup + daily due)
CREATE OR REPLACE FUNCTION public.spawn_va_tasks_for_blocked_sources(p_limit int DEFAULT 20)
RETURNS TABLE(created_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_created int := 0;
BEGIN
  -- Create tasks for blocked sources (auction + trap) with one open task per source
  INSERT INTO public.va_tasks (
    task_type,
    status,
    priority,
    due_at,
    note,
    listing_uuid,
    listing_url,
    watch_reason,
    watch_confidence,
    buy_window_at,
    attempt_count
  )
  SELECT
    'blocked_source'::text AS task_type,
    'todo'::text AS status,
    'normal'::text AS priority,
    (date_trunc('day', now()) + interval '9 hours') AS due_at,
    ('Download today''s catalogue for: ' || bs.display_name ||
     E'\n\nURL: ' || bs.url ||
     E'\n\nReason: ' || COALESCE(bs.reason,'unknown') ||
     E'\n\nAction: Download/Export → upload CSV into VA Auction Intake (or save PDF if no CSV).')::text AS note,
    '00000000-0000-0000-0000-000000000000'::uuid AS listing_uuid,
    bs.url AS listing_url,
    NULL::text AS watch_reason,
    NULL::text AS watch_confidence,
    NULL::timestamptz AS buy_window_at,
    0::int AS attempt_count
  FROM public.va_blocked_sources bs
  WHERE bs.url IS NOT NULL
  ORDER BY bs.source_type, bs.display_name
  LIMIT p_limit
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN QUERY SELECT v_created;
END;
$$;