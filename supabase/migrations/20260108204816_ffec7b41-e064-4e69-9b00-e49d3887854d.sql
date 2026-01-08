-- Create table to track sent alerts for deduplication (max 1 per trap per day)
CREATE TABLE public.trap_health_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trap_slug text NOT NULL,
  alert_date date NOT NULL DEFAULT CURRENT_DATE,
  alert_type text NOT NULL, -- 'crawl_fail', 'zero_vehicles', 'count_drop', 'consecutive_failures'
  payload jsonb NOT NULL DEFAULT '{}',
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trap_slug, alert_date, alert_type)
);

-- Enable RLS
ALTER TABLE public.trap_health_alerts ENABLE ROW LEVEL SECURITY;

-- Admin read-only policy
CREATE POLICY "Admins can read trap health alerts"
  ON public.trap_health_alerts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Index for date queries
CREATE INDEX idx_trap_health_alerts_date ON public.trap_health_alerts (alert_date);

-- Create cron audit log table
CREATE TABLE public.cron_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name text NOT NULL,
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  run_at timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL DEFAULT true,
  result jsonb,
  error text,
  UNIQUE (cron_name, run_date)
);

-- Enable RLS
ALTER TABLE public.cron_audit_log ENABLE ROW LEVEL SECURITY;

-- Admin read policy
CREATE POLICY "Admins can read cron audit log"
  ON public.cron_audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );