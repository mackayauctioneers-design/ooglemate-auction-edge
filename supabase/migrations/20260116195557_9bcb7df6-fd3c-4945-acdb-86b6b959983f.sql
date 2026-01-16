-- 1) Add notification columns to hunt_alerts
ALTER TABLE public.hunt_alerts 
ADD COLUMN IF NOT EXISTS should_notify boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS notify_reason text,
ADD COLUMN IF NOT EXISTS notification_channel text,
ADD COLUMN IF NOT EXISTS notification_attempts int DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_notification_error text,
ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- 2) Create dealer_notification_settings table
CREATE TABLE IF NOT EXISTS public.dealer_notification_settings (
  dealer_id uuid PRIMARY KEY,
  email text,
  phone text,
  slack_webhook_url text,
  notify_buy boolean DEFAULT true,
  notify_watch boolean DEFAULT false,
  quiet_hours_start int CHECK (quiet_hours_start >= 0 AND quiet_hours_start <= 23),
  quiet_hours_end int CHECK (quiet_hours_end >= 0 AND quiet_hours_end <= 23),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dealer_notification_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies for dealer_notification_settings
CREATE POLICY "Dealers can view their own notification settings"
  ON public.dealer_notification_settings FOR SELECT
  USING (auth.uid() = dealer_id);

CREATE POLICY "Dealers can update their own notification settings"
  ON public.dealer_notification_settings FOR UPDATE
  USING (auth.uid() = dealer_id);

CREATE POLICY "Dealers can insert their own notification settings"
  ON public.dealer_notification_settings FOR INSERT
  WITH CHECK (auth.uid() = dealer_id);

-- Index for efficient notification worker queries
CREATE INDEX IF NOT EXISTS idx_hunt_alerts_pending_notifications 
  ON public.hunt_alerts (created_at)
  WHERE should_notify = true AND sent_at IS NULL AND notification_attempts < 3;

-- Add comment
COMMENT ON TABLE public.dealer_notification_settings IS 'Dealer preferences for Kiting Mode alert notifications';