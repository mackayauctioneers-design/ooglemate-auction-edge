-- Add dealer_profile_id to alert_logs for proper dealer isolation
ALTER TABLE public.alert_logs 
ADD COLUMN IF NOT EXISTS dealer_profile_id uuid REFERENCES public.dealer_profiles(id);

-- Create index for efficient dealer-scoped queries
CREATE INDEX IF NOT EXISTS idx_alert_logs_dealer_profile_id 
ON public.alert_logs(dealer_profile_id);

-- Add composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_alert_logs_dealer_status 
ON public.alert_logs(dealer_profile_id, status, match_type);