-- Add anchor sale context columns to matched_opportunities_v1
ALTER TABLE public.matched_opportunities_v1
  ADD COLUMN IF NOT EXISTS anchor_buy_price integer,
  ADD COLUMN IF NOT EXISTS anchor_sell_price integer,
  ADD COLUMN IF NOT EXISTS anchor_profit integer,
  ADD COLUMN IF NOT EXISTS anchor_days_to_sell integer,
  ADD COLUMN IF NOT EXISTS median_sell_price integer;