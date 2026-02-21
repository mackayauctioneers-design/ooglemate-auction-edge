
-- CrossSafe Core Tables

-- 1. Unified job queue
CREATE TABLE public.crosssafe_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('source_refresh', 'url_ingest', 'search_query', 'lifecycle_sweep', 'score_batch')),
  source TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'parked')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  error TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  priority INT NOT NULL DEFAULT 0
);

-- Indexes for worker claim pattern
CREATE INDEX idx_crosssafe_jobs_claim ON public.crosssafe_jobs (status, priority DESC, created_at ASC) WHERE status = 'queued';
CREATE INDEX idx_crosssafe_jobs_status ON public.crosssafe_jobs (status);
CREATE INDEX idx_crosssafe_jobs_source ON public.crosssafe_jobs (source, created_at DESC);

-- 2. Step-level audit log
CREATE TABLE public.crosssafe_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.crosssafe_jobs(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crosssafe_audit_job ON public.crosssafe_audit_log (job_id, created_at);
CREATE INDEX idx_crosssafe_audit_recent ON public.crosssafe_audit_log (created_at DESC);

-- 3. Enable RLS
ALTER TABLE public.crosssafe_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crosssafe_audit_log ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read (operator dashboard)
CREATE POLICY "Authenticated users can read jobs" ON public.crosssafe_jobs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can read audit" ON public.crosssafe_audit_log FOR SELECT USING (auth.role() = 'authenticated');

-- Service role can do everything (edge functions)
CREATE POLICY "Service role full access jobs" ON public.crosssafe_jobs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access audit" ON public.crosssafe_audit_log FOR ALL USING (auth.role() = 'service_role');

-- 4. Add lifecycle columns to vehicle_listings if missing
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS content_hash TEXT;
