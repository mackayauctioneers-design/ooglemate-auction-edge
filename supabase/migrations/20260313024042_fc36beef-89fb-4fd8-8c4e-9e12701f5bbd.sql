CREATE TABLE IF NOT EXISTS public.dealer_sales_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  make text,
  model text,
  variant_raw text,
  year integer,
  sold_date date,
  buy_price numeric,
  sell_price numeric,
  km integer,
  data_source text,
  region_id text,
  state text,
  dealer_sales_id uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE(dealer_sales_id)
);