-- Drop the existing unique constraint on url_canonical alone
ALTER TABLE public.dealer_url_queue
  DROP CONSTRAINT IF EXISTS dealer_url_queue_url_canonical_unique;

-- Create per-account dedupe constraint
CREATE UNIQUE INDEX IF NOT EXISTS dealer_url_queue_account_url_uniq
  ON public.dealer_url_queue(account_id, url_canonical);
