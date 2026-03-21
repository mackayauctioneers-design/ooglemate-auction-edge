-- Seed dealer_notification_settings for Mackay Traders and Dave
-- Quiet hours: 10pm-6am AEST (alerts suppressed overnight)

INSERT INTO public.dealer_notification_settings (dealer_id, notify_buy, notify_watch, quiet_hours_start, quiet_hours_end)
VALUES 
  ('ffdbbf25-1d9c-4402-ba49-fc4da4b77cb6', true, true, 22, 6),
  ('1fb22da9-37b9-4d95-a3a6-c50e07a4877e', true, true, 22, 6)
ON CONFLICT (dealer_id) DO UPDATE SET
  notify_buy = EXCLUDED.notify_buy,
  notify_watch = EXCLUDED.notify_watch,
  quiet_hours_start = EXCLUDED.quiet_hours_start,
  quiet_hours_end = EXCLUDED.quiet_hours_end,
  updated_at = now();
