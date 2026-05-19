
ALTER TABLE public.dealer_notification_settings
  ADD COLUMN IF NOT EXISTS telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS telegram_link_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS telegram_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_star boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS preferred_channels text[] NOT NULL DEFAULT ARRAY['email']::text[];

CREATE INDEX IF NOT EXISTS dns_telegram_chat_idx
  ON public.dealer_notification_settings (telegram_chat_id);

CREATE TABLE IF NOT EXISTS public.dealer_alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL,
  event_type text NOT NULL,
  channel text NOT NULL,
  recipient text,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'sent',
  error text,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dealer_alert_log_dealer_idx
  ON public.dealer_alert_log (dealer_id, created_at DESC);

ALTER TABLE public.dealer_alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dealers can read their own alert log"
  ON public.dealer_alert_log FOR SELECT
  USING (auth.uid() = dealer_id);

CREATE POLICY "Operators can read all alert logs"
  ON public.dealer_alert_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
