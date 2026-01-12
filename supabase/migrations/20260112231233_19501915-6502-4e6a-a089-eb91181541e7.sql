-- Create pipeline_runs table
CREATE TABLE public.pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL_FAIL', 'FAIL')),
  triggered_by TEXT,
  total_steps INTEGER DEFAULT 0,
  completed_steps INTEGER DEFAULT 0,
  failed_steps INTEGER DEFAULT 0,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create pipeline_steps table
CREATE TABLE public.pipeline_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAIL', 'SKIPPED')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  records_processed INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  error_sample TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_pipeline_runs_status ON public.pipeline_runs(status);
CREATE INDEX idx_pipeline_runs_started_at ON public.pipeline_runs(started_at DESC);
CREATE INDEX idx_pipeline_steps_run_id ON public.pipeline_steps(run_id);
CREATE INDEX idx_pipeline_steps_status ON public.pipeline_steps(status);

-- Enable RLS
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_steps ENABLE ROW LEVEL SECURITY;

-- RLS policies for pipeline_runs
CREATE POLICY "Admins can view pipeline runs"
ON public.pipeline_runs FOR SELECT
USING (is_admin_or_internal());

CREATE POLICY "Service can manage pipeline runs"
ON public.pipeline_runs FOR ALL
USING (true)
WITH CHECK (true);

-- RLS policies for pipeline_steps
CREATE POLICY "Admins can view pipeline steps"
ON public.pipeline_steps FOR SELECT
USING (is_admin_or_internal());

CREATE POLICY "Service can manage pipeline steps"
ON public.pipeline_steps FOR ALL
USING (true)
WITH CHECK (true);

-- Add advisory lock function for pipeline concurrency control
CREATE OR REPLACE FUNCTION public.try_acquire_pipeline_lock()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Try to acquire advisory lock (non-blocking)
  -- Lock ID 12345 is arbitrary but consistent for pipeline runs
  RETURN pg_try_advisory_lock(12345);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_pipeline_lock()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM pg_advisory_unlock(12345);
END;
$$;