
ALTER TABLE public.operator_opportunities
  ADD COLUMN IF NOT EXISTS anchor_sale_id uuid,
  ADD COLUMN IF NOT EXISTS anchor_sale_buy_price numeric,
  ADD COLUMN IF NOT EXISTS anchor_sale_sell_price numeric,
  ADD COLUMN IF NOT EXISTS anchor_sale_profit numeric,
  ADD COLUMN IF NOT EXISTS anchor_sale_sold_at timestamptz,
  ADD COLUMN IF NOT EXISTS anchor_sale_km integer,
  ADD COLUMN IF NOT EXISTS anchor_sale_trim_class text;
