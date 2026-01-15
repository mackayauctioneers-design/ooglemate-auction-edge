-- Remove the broken cron jobs
SELECT cron.unschedule('autotrader-api-cron-5min');
SELECT cron.unschedule('autotrader-stale-sweep-daily');

-- Enable pg_net extension for HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule autotrader-api-cron to run every 5 minutes using direct URL
SELECT cron.schedule(
  'autotrader-api-cron-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/autotrader-api-cron',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Schedule autotrader-stale-sweep daily at 16:00 UTC (02:00 AEST)
SELECT cron.schedule(
  'autotrader-stale-sweep-daily',
  '0 16 * * *',
  $$
  SELECT net.http_post(
    url := 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/autotrader-stale-sweep',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);