-- Add source_key column to va_tasks for deep-linking blocked source uploads
ALTER TABLE public.va_tasks
ADD COLUMN IF NOT EXISTS source_key text;

-- Update spawn_va_tasks_for_blocked_sources to populate source_key
CREATE OR REPLACE FUNCTION public.spawn_va_tasks_for_blocked_sources(p_limit int DEFAULT 20)
RETURNS TABLE(created_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_created int := 0;
BEGIN
  -- Create tasks for blocked sources (auction + trap) with one open task per source per day
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
    attempt_count,
    source_key
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
    NULL::uuid AS listing_uuid,
    bs.url AS listing_url,
    NULL::text AS watch_reason,
    NULL::text AS watch_confidence,
    NULL::timestamptz AS buy_window_at,
    NULL::int AS attempt_count,
    bs.source_key AS source_key
  FROM public.va_blocked_sources bs
  WHERE bs.url IS NOT NULL
  ORDER BY bs.source_type, bs.display_name
  LIMIT p_limit
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN QUERY SELECT v_created;
END;
$$;