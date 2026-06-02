ALTER TABLE public.dealer_daily_snapshots
  ADD COLUMN IF NOT EXISTS total_stock integer,
  ADD COLUMN IF NOT EXISTS new_arrivals integer,
  ADD COLUMN IF NOT EXISTS sold_removed integer,
  ADD COLUMN IF NOT EXISTS stale_30d integer,
  ADD COLUMN IF NOT EXISTS stale_60d integer,
  ADD COLUMN IF NOT EXISTS stale_90d integer,
  ADD COLUMN IF NOT EXISTS avg_days_on_lot numeric,
  ADD COLUMN IF NOT EXISTS avg_days_to_sell numeric,
  ADD COLUMN IF NOT EXISTS quick_turns integer,
  ADD COLUMN IF NOT EXISTS stock_list jsonb;