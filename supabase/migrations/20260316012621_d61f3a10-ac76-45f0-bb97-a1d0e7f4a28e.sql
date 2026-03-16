
-- Active Hunt tracking table
CREATE TABLE public.ooglebot_active_hunts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id TEXT,
  initiated_by TEXT NOT NULL DEFAULT 'user',
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  badge TEXT,
  year_min INT,
  year_max INT,
  km_max INT,
  price_max INT,
  internal_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'hunting',
  sources_triggered TEXT[] NOT NULL DEFAULT '{}',
  apify_queue_ids TEXT[] NOT NULL DEFAULT '{}',
  results_found INT NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  duration_ms INT
);

-- Index for polling
CREATE INDEX idx_active_hunts_status ON public.ooglebot_active_hunts(status) WHERE status = 'hunting';

-- RLS: open read for authenticated, write via service role
ALTER TABLE public.ooglebot_active_hunts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active hunts"
  ON public.ooglebot_active_hunts FOR SELECT
  USING (true);
