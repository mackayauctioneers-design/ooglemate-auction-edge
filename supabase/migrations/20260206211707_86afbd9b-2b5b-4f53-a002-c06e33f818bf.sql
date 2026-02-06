
-- Add 'watch' and 'rejected' to status constraint (used by Josh Inbox actions)
ALTER TABLE public.dealer_url_queue DROP CONSTRAINT IF EXISTS dealer_url_queue_status_check;
ALTER TABLE public.dealer_url_queue ADD CONSTRAINT dealer_url_queue_status_check
  CHECK (status = ANY (ARRAY['queued','running','validating','validated','invalid','needs_review','success','failed','ignored','pending','hold','watch','rejected']));
