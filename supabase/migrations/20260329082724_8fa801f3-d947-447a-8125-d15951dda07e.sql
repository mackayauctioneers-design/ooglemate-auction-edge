
CREATE TABLE IF NOT EXISTS public.manus_task_results (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id         text NOT NULL UNIQUE,
  task_type       text,
  trade_batch_id  text,
  easycars_updates jsonb DEFAULT '[]',
  xero_postings    jsonb DEFAULT '[]',
  logs             jsonb DEFAULT '[]',
  warnings         jsonb DEFAULT '[]',
  status           text DEFAULT 'completed',
  completed_at     timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS reconciled       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconciled_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by    text;
