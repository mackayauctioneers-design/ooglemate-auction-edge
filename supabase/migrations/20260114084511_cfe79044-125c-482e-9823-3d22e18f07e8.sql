-- Cursor table for bulk seed progress tracking
CREATE TABLE IF NOT EXISTS public.retail_seed_cursor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make_idx integer NOT NULL DEFAULT 0,
  state_idx integer NOT NULL DEFAULT 0,
  page integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending', -- pending, running, done, error
  last_error text,
  batches_completed integer DEFAULT 0,
  total_new integer DEFAULT 0,
  total_updated integer DEFAULT 0,
  total_evaluations integer DEFAULT 0,
  total_errors integer DEFAULT 0,
  started_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Single row constraint
CREATE UNIQUE INDEX IF NOT EXISTS retail_seed_cursor_singleton ON retail_seed_cursor ((true));

-- Initialize with single row
INSERT INTO retail_seed_cursor (status) VALUES ('pending')
ON CONFLICT DO NOTHING;

-- RLS (service role only)
ALTER TABLE retail_seed_cursor ENABLE ROW LEVEL SECURITY;