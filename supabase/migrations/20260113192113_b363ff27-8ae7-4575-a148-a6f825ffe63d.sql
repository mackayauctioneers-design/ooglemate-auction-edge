-- Run log (one row per source per day/attempt)
CREATE TABLE IF NOT EXISTS public.auction_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  run_date date NOT NULL DEFAULT current_date,
  status text NOT NULL CHECK (status IN ('started','success','fail','skipped')),
  reason text NULL,
  lots_found int NULL,
  created int NULL,
  updated int NULL,
  dropped int NULL,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auction_schedule_runs_source_date_idx
  ON public.auction_schedule_runs (source_key, run_date);