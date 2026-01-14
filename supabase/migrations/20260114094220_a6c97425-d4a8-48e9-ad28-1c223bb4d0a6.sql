-- Create cursor table for Autotrader seeding (separate from Gumtree)
CREATE TABLE IF NOT EXISTS public.retail_seed_cursor_autotrader (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending',
  make_idx int NOT NULL DEFAULT 0,
  state_idx int NOT NULL DEFAULT 0,
  batch_idx int NOT NULL DEFAULT 0,
  batches_completed int DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  locked_until timestamptz,
  lock_token text,
  last_done_log_at timestamptz,
  last_error text,
  total_new int DEFAULT 0,
  total_updated int DEFAULT 0,
  total_evaluations int DEFAULT 0,
  total_errors int DEFAULT 0
);

-- Seed with initial row
INSERT INTO public.retail_seed_cursor_autotrader (id, status)
VALUES ('00000000-0000-0000-0000-000000000002', 'pending')
ON CONFLICT DO NOTHING;

-- Add source column index for faster queries
CREATE INDEX IF NOT EXISTS idx_retail_listings_source ON public.retail_listings(source);

-- Enable RLS
ALTER TABLE public.retail_seed_cursor_autotrader ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on retail_seed_cursor_autotrader"
  ON public.retail_seed_cursor_autotrader
  FOR ALL
  USING (true)
  WITH CHECK (true);