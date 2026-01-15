-- Disable RLS on internal audit table - it's not client-accessible
ALTER TABLE public.cron_audit_log DISABLE ROW LEVEL SECURITY;

-- Drop the policies we created (no longer needed)
DROP POLICY IF EXISTS "Only service role can insert cron audit logs" ON public.cron_audit_log;
DROP POLICY IF EXISTS "Only service role can update cron audit logs" ON public.cron_audit_log;
DROP POLICY IF EXISTS "Admins can read cron audit log" ON public.cron_audit_log;

-- Create heartbeat table for guaranteed signal (no RLS)
CREATE TABLE IF NOT EXISTS public.cron_heartbeat (
  cron_name text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_ok boolean NOT NULL DEFAULT true,
  note text
);

-- No RLS on heartbeat - internal only
COMMENT ON TABLE public.cron_heartbeat IS 'Internal table for cron job health monitoring - no RLS';