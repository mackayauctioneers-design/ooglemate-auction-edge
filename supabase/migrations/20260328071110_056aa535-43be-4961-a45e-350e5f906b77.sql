CREATE TABLE public.trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid DEFAULT 'd24da4ea-f500-47fd-9b66-d2c9aa2d3f51',
  source_system text,
  direction text,
  invoice_number text,
  invoice_date date,
  dealer_name text,
  dealer_abn text,
  dealer_email text,
  vin text,
  rego text,
  state text,
  make text,
  model text,
  variant text,
  series text,
  year int,
  odometer_km int,
  colour text,
  body_type text,
  transmission text,
  fuel_type text,
  sell_price_inc_gst numeric,
  sell_price_ex_gst numeric,
  gst_amount numeric,
  fees_total numeric,
  fees_breakdown jsonb,
  trade_in_value numeric,
  hold_deposit numeric,
  stock_number text,
  internal_notes text,
  raw_email_id text,
  fingerprint text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(invoice_number, vin)
);

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on trades"
  ON public.trades FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);