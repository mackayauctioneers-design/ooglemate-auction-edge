-- Add grok_class column to dealer_url_queue for routing decisions
ALTER TABLE public.dealer_url_queue 
ADD COLUMN IF NOT EXISTS grok_class TEXT DEFAULT 'grok_safe';

-- Add comment explaining the values
COMMENT ON COLUMN public.dealer_url_queue.grok_class IS 'URL classification for Grok routing: grok_safe (send to Grok), api_only (use scraper/API), invalid (lemon page)';

-- Create index for filtering Grok-safe URLs
CREATE INDEX IF NOT EXISTS idx_dealer_url_queue_grok_class 
ON public.dealer_url_queue(grok_class) 
WHERE grok_class = 'grok_safe';