-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Service role can insert cron audit logs" ON public.cron_audit_log;
DROP POLICY IF EXISTS "Service role can update cron audit logs" ON public.cron_audit_log;

-- Create properly restricted policies for service_role only
-- These use auth.role() which returns 'service_role' for service key calls
CREATE POLICY "Only service role can insert cron audit logs"
ON public.cron_audit_log
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Only service role can update cron audit logs"
ON public.cron_audit_log
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);