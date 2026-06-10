SELECT cron.schedule(
  'operator-telegram-alerts-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/operator-opportunity-telegram-alerts',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmNoeHNidXduZ2Ztd3ZzdmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzY4NzIsImV4cCI6MjA4MjY1Mjg3Mn0.EAtZMU4QRmk00Gomr7R25LR0OyJqZtMQA9ZK-7M19hM"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);