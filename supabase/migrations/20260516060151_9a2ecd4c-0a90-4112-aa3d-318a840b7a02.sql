INSERT INTO public.workers (worker_name, worker_category, status, concurrency_limit)
VALUES
  ('worker-easycars-upload', 'browser', 'idle', 2),
  ('worker-invoice-upload', 'browser', 'idle', 2),
  ('worker-stock-entry-browser', 'browser', 'idle', 2)
ON CONFLICT (worker_name) DO UPDATE SET
  worker_category = EXCLUDED.worker_category,
  concurrency_limit = EXCLUDED.concurrency_limit;