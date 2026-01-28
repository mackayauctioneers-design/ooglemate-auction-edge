-- Add Manheim support to pickles_detail_queue (rename is too risky, just add source support)
-- Also add indexes for Manheim source queries

-- Create index for Manheim source queries on detail queue  
CREATE INDEX IF NOT EXISTS idx_detail_queue_manheim_pending 
ON public.pickles_detail_queue (source, crawl_status, claimed_at, retry_count)
WHERE source = 'manheim' AND crawl_status = 'pending';

-- Add Manheim to stub_anchors index
CREATE INDEX IF NOT EXISTS idx_stub_anchors_manheim_pending
ON public.stub_anchors (source, status, deep_fetch_triggered, make_norm, model_norm)
WHERE source = 'manheim' AND status = 'pending';

-- Create index for Manheim stub matching
CREATE INDEX IF NOT EXISTS idx_stub_anchors_manheim_match
ON public.stub_anchors (make_norm, model_norm, year)
WHERE source = 'manheim' AND status = 'pending' AND deep_fetch_triggered = false;

-- Add stub_ingest_runs index for Manheim
CREATE INDEX IF NOT EXISTS idx_stub_ingest_runs_manheim
ON public.stub_ingest_runs (source, started_at DESC)
WHERE source = 'manheim';