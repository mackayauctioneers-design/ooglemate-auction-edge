
-- Expand intent check to include 'discover' for auction discovery
ALTER TABLE public.dealer_url_queue DROP CONSTRAINT IF EXISTS dealer_url_queue_intent_check;
ALTER TABLE public.dealer_url_queue ADD CONSTRAINT dealer_url_queue_intent_check
  CHECK (intent = ANY (ARRAY['dealer_home','inventory_search','inventory_detail','unknown','discover']));

-- Expand method check to include 'csv_seed' for bulk seeding
ALTER TABLE public.dealer_url_queue DROP CONSTRAINT IF EXISTS dealer_url_queue_method_check;
ALTER TABLE public.dealer_url_queue ADD CONSTRAINT dealer_url_queue_method_check
  CHECK (method = ANY (ARRAY['scrape','firecrawl','manual_review','csv_seed']));

-- Expand status check to include 'pending' and 'hold' for seeder throttling
ALTER TABLE public.dealer_url_queue DROP CONSTRAINT IF EXISTS dealer_url_queue_status_check;
ALTER TABLE public.dealer_url_queue ADD CONSTRAINT dealer_url_queue_status_check
  CHECK (status = ANY (ARRAY['queued','running','validating','validated','invalid','needs_review','success','failed','ignored','pending','hold']));
