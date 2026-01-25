-- Drop and recreate the status check constraint with new values
ALTER TABLE dealer_url_queue DROP CONSTRAINT dealer_url_queue_status_check;

ALTER TABLE dealer_url_queue ADD CONSTRAINT dealer_url_queue_status_check 
  CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'validating'::text, 'validated'::text, 'invalid'::text, 'needs_review'::text, 'success'::text, 'failed'::text, 'ignored'::text]));