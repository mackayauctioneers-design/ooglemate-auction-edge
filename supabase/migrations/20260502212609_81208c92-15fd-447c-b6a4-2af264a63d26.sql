ALTER TABLE pulse_alerts
  ADD COLUMN IF NOT EXISTS source_class text,
  ADD COLUMN IF NOT EXISTS effective_price numeric,
  ADD COLUMN IF NOT EXISTS auction_close_at timestamptz;