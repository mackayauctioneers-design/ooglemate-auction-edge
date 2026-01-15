-- Allow service role and internal processes to insert into cron_audit_log
CREATE POLICY "Service role can insert cron audit logs"
ON public.cron_audit_log
FOR INSERT
WITH CHECK (true);

-- Also allow service role to update if needed
CREATE POLICY "Service role can update cron audit logs"
ON public.cron_audit_log
FOR UPDATE
USING (true)
WITH CHECK (true);