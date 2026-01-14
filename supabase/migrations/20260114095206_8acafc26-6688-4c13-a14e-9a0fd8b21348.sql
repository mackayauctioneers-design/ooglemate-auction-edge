-- Create queue table for async Apify runs
CREATE TABLE IF NOT EXISTS public.apify_runs_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'autotrader',
  run_id text,
  dataset_id text,
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued', -- queued|running|fetching|done|error
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  items_fetched int DEFAULT 0,
  items_upserted int DEFAULT 0,
  lock_token text,
  locked_until timestamptz,
  CONSTRAINT valid_status CHECK (status IN ('queued', 'running', 'fetching', 'done', 'error'))
);

-- Index for efficient queue polling
CREATE INDEX IF NOT EXISTS idx_apify_runs_queue_status ON apify_runs_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_apify_runs_queue_source ON apify_runs_queue(source, status);

-- Enable RLS
ALTER TABLE apify_runs_queue ENABLE ROW LEVEL SECURITY;

-- Service role access only
CREATE POLICY "Service role full access on apify_runs_queue" 
ON apify_runs_queue FOR ALL 
USING (true) 
WITH CHECK (true);

COMMENT ON TABLE apify_runs_queue IS 'Async queue for Apify actor runs - decouples enqueue from fetch/upsert';