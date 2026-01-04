-- Add push_sent_at column for tracking push delivery
ALTER TABLE public.alert_logs 
ADD COLUMN IF NOT EXISTS push_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add queued_until for quiet hours queueing
ALTER TABLE public.alert_logs 
ADD COLUMN IF NOT EXISTS queued_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add previous_status to track state changes for ACTION alerts
ALTER TABLE public.alert_logs 
ADD COLUMN IF NOT EXISTS previous_status TEXT DEFAULT NULL;

-- Create unique constraint for deduplication
-- (dealer_name, listing_id, alert_type, auction_datetime)
-- Using a unique index instead of constraint to handle NULLs properly
DROP INDEX IF EXISTS idx_alert_logs_dedupe;
CREATE UNIQUE INDEX idx_alert_logs_dedupe 
ON public.alert_logs (dealer_name, listing_id, alert_type, COALESCE(auction_datetime, '1970-01-01'::timestamptz));