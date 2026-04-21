-- Queue table for durable invoice -> EasyCars pipeline
CREATE TABLE IF NOT EXISTS public.pending_stock_entry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'lindy',
  status TEXT NOT NULL DEFAULT 'approved',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  easycars_stock_id TEXT,
  ppsr_purchased BOOLEAN,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pending_stock_entry_status_chk
    CHECK (status IN ('approved', 'processing', 'completed', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_pending_stock_entry_status_created
  ON public.pending_stock_entry (status, created_at);

CREATE INDEX IF NOT EXISTS idx_pending_stock_entry_locked
  ON public.pending_stock_entry (locked_at) WHERE locked_at IS NOT NULL;

-- Enable RLS, no policies => only service role can access
ALTER TABLE public.pending_stock_entry ENABLE ROW LEVEL SECURITY;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.pending_stock_entry_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pending_stock_entry_touch ON public.pending_stock_entry;
CREATE TRIGGER trg_pending_stock_entry_touch
BEFORE UPDATE ON public.pending_stock_entry
FOR EACH ROW EXECUTE FUNCTION public.pending_stock_entry_touch();

-- Atomic claim function: oldest approved row, locks via SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_next_pending_stock_entry(_locked_by TEXT)
RETURNS SETOF public.pending_stock_entry
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM public.pending_stock_entry
  WHERE status = 'approved'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.pending_stock_entry
  SET status = 'processing',
      locked_at = now(),
      locked_by = _locked_by,
      attempts = attempts + 1
  WHERE id = v_id
  RETURNING *;
END;
$$;