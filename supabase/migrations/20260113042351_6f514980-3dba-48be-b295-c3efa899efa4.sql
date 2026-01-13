-- VA tasks table for vehicle-level delegation
CREATE TABLE IF NOT EXISTS public.va_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  status text NOT NULL DEFAULT 'todo', -- todo | in_progress | done | blocked
  priority text NOT NULL DEFAULT 'normal', -- normal | high

  listing_uuid uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,

  task_type text NOT NULL DEFAULT 'buy_window_chase', -- extensible
  assigned_to text NULL, -- "va" or specific VA username
  due_at timestamptz NULL,

  note text NULL,

  -- snapshot of why it was created
  watch_reason text NULL,
  watch_confidence text NULL,
  buy_window_at timestamptz NULL,
  attempt_count int NULL,
  listing_url text NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS va_tasks_status_idx ON public.va_tasks(status);
CREATE INDEX IF NOT EXISTS va_tasks_listing_idx ON public.va_tasks(listing_uuid);

-- Dedup rule: only one open VA task per listing
CREATE UNIQUE INDEX IF NOT EXISTS va_tasks_open_unique
ON public.va_tasks(listing_uuid)
WHERE status IN ('todo','in_progress');

-- Enable RLS
ALTER TABLE public.va_tasks ENABLE ROW LEVEL SECURITY;

-- RLS policies: admin/internal can do everything
CREATE POLICY "Admin/internal can manage VA tasks"
ON public.va_tasks
FOR ALL
USING (public.is_admin_or_internal());

-- Updated_at trigger
CREATE TRIGGER update_va_tasks_updated_at
BEFORE UPDATE ON public.va_tasks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- RPC: create VA tasks for new BUY_WINDOW listings
CREATE OR REPLACE FUNCTION public.spawn_va_tasks_for_buy_window(p_hours int DEFAULT 24)
RETURNS TABLE(created_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created int := 0;
BEGIN
  INSERT INTO public.va_tasks (
    listing_uuid,
    task_type,
    assigned_to,
    priority,
    due_at,
    note,
    watch_reason,
    watch_confidence,
    buy_window_at,
    attempt_count,
    listing_url
  )
  SELECT
    vl.id,
    'buy_window_chase',
    'va',
    CASE
      WHEN vl.watch_confidence IN ('high') THEN 'high'
      WHEN vl.source_class = 'auction' AND COALESCE(vl.attempt_count,0) >= 3 THEN 'high'
      ELSE 'normal'
    END AS priority,
    now() + interval '8 hours' AS due_at,
    'Chase this BUY_WINDOW listing. Get reserve/guide/buy range + report back.' AS note,
    vl.watch_reason,
    vl.watch_confidence,
    vl.buy_window_at,
    vl.attempt_count,
    vl.listing_url
  FROM public.vehicle_listings vl
  WHERE vl.watch_status = 'buy_window'
    AND COALESCE(vl.sold_returned_suspected, false) = false
    AND COALESCE(vl.avoid_reason, '') = ''
    AND vl.buy_window_at >= now() - make_interval(hours => p_hours)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN QUERY SELECT v_created;
END;
$$;