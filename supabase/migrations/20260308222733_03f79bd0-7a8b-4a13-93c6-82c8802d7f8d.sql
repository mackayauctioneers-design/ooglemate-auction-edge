
-- Dealer Demands: explicit buy requests from dealers
CREATE TABLE public.dealer_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_name text NOT NULL,
  buyer_name text,
  make text NOT NULL,
  model text NOT NULL,
  engine text,
  colour text,
  year_min int,
  year_max int,
  km_max int,
  price_max int,
  urgency text NOT NULL DEFAULT 'normal',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open',
  matches_found int NOT NULL DEFAULT 0,
  last_searched_at timestamptz
);

CREATE INDEX idx_dealer_demands_status ON public.dealer_demands(status);

-- Demand Opportunities: vehicles found for specific demands
CREATE TABLE public.demand_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id uuid NOT NULL REFERENCES public.dealer_demands(id) ON DELETE CASCADE,
  source text NOT NULL,
  make text,
  model text,
  year int,
  km int,
  price int,
  colour text,
  location text,
  listing_url text,
  listing_id text,
  score numeric DEFAULT 0,
  margin_estimate int,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(demand_id, listing_url)
);

CREATE INDEX idx_demand_opps_demand ON public.demand_opportunities(demand_id);
CREATE INDEX idx_demand_opps_score ON public.demand_opportunities(score DESC);

-- RLS: admin only
ALTER TABLE public.dealer_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on dealer_demands"
  ON public.dealer_demands FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin full access on demand_opportunities"
  ON public.demand_opportunities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
