CREATE TABLE IF NOT EXISTS public.open_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id text NOT NULL,
  account_id uuid REFERENCES public.accounts(id),
  stock_no text,
  queue_id uuid REFERENCES public.wholesale_manager_queue(id) ON DELETE SET NULL,
  make text NOT NULL,
  model text NOT NULL,
  variant text,
  year integer,
  km integer,
  vin text,
  rego text,
  buy_price integer NOT NULL,
  recon_cost integer DEFAULT 0,
  transport_cost integer DEFAULT 0,
  other_costs integer DEFAULT 0,
  total_cost integer GENERATED ALWAYS AS (buy_price + COALESCE(recon_cost,0) + COALESCE(transport_cost,0) + COALESCE(other_costs,0)) STORED,
  list_price integer,
  est_sale_price integer,
  unrealized_gp integer GENERATED ALWAYS AS (COALESCE(est_sale_price, list_price, 0) - (buy_price + COALESCE(recon_cost,0) + COALESCE(transport_cost,0) + COALESCE(other_costs,0))) STORED,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  listed_date date,
  sold_date date,
  median_hold_days integer,
  hold_alarm_threshold integer,
  status text NOT NULL DEFAULT 'prep'
    CHECK (status IN ('prep','recon','photographed','listed','offer_received','sold','wholesale_out','written_off')),
  notes text,
  tags text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_positions TO authenticated;
GRANT ALL ON public.open_positions TO service_role;

ALTER TABLE public.open_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dealers can view their own positions"
  ON public.open_positions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.dealer_profiles dp
      WHERE dp.account_id = open_positions.account_id
        AND dp.user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "Service role can manage positions"
  ON public.open_positions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_open_positions_dealer ON public.open_positions(dealer_id);
CREATE INDEX IF NOT EXISTS idx_open_positions_status ON public.open_positions(status);
CREATE INDEX IF NOT EXISTS idx_open_positions_account ON public.open_positions(account_id);

DROP TRIGGER IF EXISTS trg_open_positions_updated_at ON public.open_positions;
CREATE TRIGGER trg_open_positions_updated_at
  BEFORE UPDATE ON public.open_positions
  FOR EACH ROW EXECUTE FUNCTION public.trg_wmq_updated_at();

CREATE OR REPLACE VIEW public.v_dealer_live_pl AS
SELECT
  op.dealer_id,
  a.display_name as dealer_name,
  COUNT(*) as open_units,
  SUM(op.total_cost) as total_invested,
  SUM(COALESCE(op.est_sale_price, op.list_price, 0)) as total_est_revenue,
  SUM(op.unrealized_gp) as total_unrealized_gp,
  ROUND(AVG(op.unrealized_gp)) as avg_unrealized_gp,
  ROUND(AVG(CURRENT_DATE - op.purchase_date)) as avg_days_held,
  COUNT(*) FILTER (
    WHERE (CURRENT_DATE - op.purchase_date) > COALESCE(op.median_hold_days * 1.5, 60)
  ) as alarm_count,
  SUM(op.unrealized_gp) FILTER (WHERE op.status = 'listed') as listed_unrealized_gp,
  SUM(op.unrealized_gp) FILTER (WHERE op.status = 'prep') as prep_unrealized_gp
FROM public.open_positions op
LEFT JOIN public.accounts a ON a.id = op.account_id
WHERE op.status NOT IN ('sold','wholesale_out','written_off')
GROUP BY op.dealer_id, a.display_name;

GRANT SELECT ON public.v_dealer_live_pl TO authenticated, service_role;