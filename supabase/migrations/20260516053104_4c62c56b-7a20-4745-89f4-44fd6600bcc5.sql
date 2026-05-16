INSERT INTO public.workers (worker_name, worker_category, concurrency_limit, status, capabilities, config)
VALUES
  ('worker-gmail-invoice-watcher', 'watcher', 5, 'idle', '["gmail_invoice_detected"]'::jsonb, '{}'::jsonb),
  ('worker-autograb-health', 'watcher', 5, 'idle', '["autograb_health_check"]'::jsonb, '{}'::jsonb),
  ('worker-carbitrage-ingestion', 'watcher', 5, 'idle', '["carbitrage_ingestion_check"]'::jsonb, '{}'::jsonb)
ON CONFLICT (worker_name) DO UPDATE SET
  worker_category = EXCLUDED.worker_category,
  concurrency_limit = EXCLUDED.concurrency_limit,
  capabilities = EXCLUDED.capabilities;