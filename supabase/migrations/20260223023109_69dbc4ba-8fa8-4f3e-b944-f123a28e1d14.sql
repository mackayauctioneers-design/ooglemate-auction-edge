
-- Manual URL Intake table
CREATE TABLE public.manual_url_intake (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Other',
  submitted_by UUID NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  crosssafe_job_id UUID REFERENCES public.crosssafe_jobs(id),
  match_score NUMERIC,
  opportunity_id UUID,
  CONSTRAINT manual_url_intake_url_unique UNIQUE (url)
);

-- Enable RLS
ALTER TABLE public.manual_url_intake ENABLE ROW LEVEL SECURITY;

-- Admin/internal can see all
CREATE POLICY "Admins can manage all manual intake"
  ON public.manual_url_intake FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'internal')
    )
  );

-- Users can see their own submissions
CREATE POLICY "Users can view own submissions"
  ON public.manual_url_intake FOR SELECT
  USING (submitted_by = auth.uid());

-- Users can insert their own submissions
CREATE POLICY "Users can insert own submissions"
  ON public.manual_url_intake FOR INSERT
  WITH CHECK (submitted_by = auth.uid());

-- Index for fast lookups
CREATE INDEX idx_manual_url_intake_submitted_by ON public.manual_url_intake(submitted_by);
CREATE INDEX idx_manual_url_intake_status ON public.manual_url_intake(status);

-- Trigger: auto-enqueue CrossSafe url_ingest job on insert
CREATE OR REPLACE FUNCTION public.manual_intake_enqueue_crosssafe()
RETURNS TRIGGER AS $$
DECLARE
  job_id UUID;
BEGIN
  INSERT INTO public.crosssafe_jobs (type, source, payload, priority, status)
  VALUES (
    'url_ingest',
    NEW.source,
    jsonb_build_object('url', NEW.url, 'intake_id', NEW.id),
    1,
    'queued'
  )
  RETURNING id INTO job_id;

  NEW.crosssafe_job_id := job_id;
  NEW.status := 'queued';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_manual_intake_enqueue
  BEFORE INSERT ON public.manual_url_intake
  FOR EACH ROW
  EXECUTE FUNCTION public.manual_intake_enqueue_crosssafe();
