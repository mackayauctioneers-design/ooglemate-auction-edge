
-- Add pg_cron job for hunt-scan-cron (every 15 minutes)
SELECT cron.schedule(
  'hunt-scan-cron-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/hunt-scan-cron',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
