-- Create table to store daily feeding mode reports
CREATE TABLE public.feeding_mode_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date DATE NOT NULL,
  report_json JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT feeding_mode_reports_report_date_key UNIQUE (report_date)
);

-- Enable RLS
ALTER TABLE public.feeding_mode_reports ENABLE ROW LEVEL SECURITY;

-- Admin read-only policy
CREATE POLICY "Admins can view feeding mode reports"
  ON public.feeding_mode_reports
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Add index for date lookups
CREATE INDEX idx_feeding_mode_reports_date ON public.feeding_mode_reports(report_date DESC);