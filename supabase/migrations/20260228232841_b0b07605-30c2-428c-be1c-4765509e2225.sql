
-- ============================================================
-- Fleet Enterprise Tables
-- ============================================================

-- 1. fleet_clients — one row per enterprise client
CREATE TABLE IF NOT EXISTS public.fleet_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  slug text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'WA',
  dms_type text NOT NULL DEFAULT 'csv',
  is_active boolean NOT NULL DEFAULT true,
  contact_name text,
  contact_email text,
  contact_phone text,
  ingest_api_key text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fleet_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage fleet clients" ON public.fleet_clients
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid())
  );

-- 2. fleet_client_users — maps auth users to fleet clients
CREATE TABLE IF NOT EXISTS public.fleet_client_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'manager', 'admin')),
  display_name text NOT NULL DEFAULT '',
  speciality_makes text[] DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fleet_client_id, user_id)
);

ALTER TABLE public.fleet_client_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet users can read own records" ON public.fleet_client_users
  FOR SELECT USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid()));

CREATE POLICY "Admins can manage fleet users" ON public.fleet_client_users
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid())
  );

-- 3. dms_sales_feed — sold vehicle records from the client's DMS
CREATE TABLE IF NOT EXISTS public.dms_sales_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  stock_number text,
  vin text,
  make text NOT NULL,
  model text NOT NULL,
  year int NOT NULL,
  trim text,
  engine_type text,
  transmission text,
  drivetrain text,
  odometer int,
  colour text,
  acquisition_date date,
  acquisition_cost numeric,
  reconditioning_cost numeric DEFAULT 0,
  sale_date date NOT NULL,
  sale_price numeric NOT NULL,
  source_channel text,
  fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dms_sales_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet users can read own client sales" ON public.dms_sales_feed
  FOR SELECT USING (
    fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid())
  );

CREATE POLICY "Service role can insert sales" ON public.dms_sales_feed
  FOR INSERT WITH CHECK (true);

-- 4. fleet_inventory_feed — current inventory snapshot
CREATE TABLE IF NOT EXISTS public.fleet_inventory_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  stock_number text,
  make text NOT NULL,
  model text NOT NULL,
  year int NOT NULL,
  trim text,
  odometer int,
  asking_price numeric,
  acquisition_cost numeric,
  days_on_lot int DEFAULT 0,
  status text DEFAULT 'available',
  fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fleet_inventory_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet users can read own inventory" ON public.fleet_inventory_feed
  FOR SELECT USING (
    fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid())
  );

CREATE POLICY "Service role can manage inventory" ON public.fleet_inventory_feed
  FOR ALL WITH CHECK (true);

-- 5. fleet_velocity_metrics — pre-computed analytics per vehicle fingerprint
CREATE TABLE IF NOT EXISTS public.fleet_velocity_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  year_min int,
  year_max int,
  trim text,
  engine_type text,
  sold_30d int DEFAULT 0,
  sold_90d int DEFAULT 0,
  avg_days_to_sell numeric,
  avg_gross_profit numeric,
  avg_acquisition_cost numeric,
  in_stock int DEFAULT 0,
  stock_gap int DEFAULT 0,
  monthly_opportunity_value numeric DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fleet_client_id, fingerprint)
);

ALTER TABLE public.fleet_velocity_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet users can read own metrics" ON public.fleet_velocity_metrics
  FOR SELECT USING (
    fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid())
  );

CREATE POLICY "Service role can manage metrics" ON public.fleet_velocity_metrics
  FOR ALL WITH CHECK (true);

-- 6. fleet_opportunity_scores — every market vehicle scored against stock gaps
CREATE TABLE IF NOT EXISTS public.fleet_opportunity_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  listing_id uuid,
  make text,
  model text,
  year int,
  trim text,
  km int,
  asking_price numeric,
  source text,
  auction_house text,
  listing_url text,
  score numeric DEFAULT 0,
  target_acquisition_price numeric,
  expected_gross numeric,
  expected_days_to_sell numeric,
  matched_fingerprint text,
  no_reserve boolean DEFAULT false,
  has_damage boolean DEFAULT false,
  sale_close_at timestamptz,
  scored_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fleet_opportunity_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet users can read own scores" ON public.fleet_opportunity_scores
  FOR SELECT USING (
    fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid())
  );

CREATE POLICY "Service role can manage scores" ON public.fleet_opportunity_scores
  FOR ALL WITH CHECK (true);

-- 7. fleet_buyer_instructions — buying instructions delivered to buyers
CREATE TABLE IF NOT EXISTS public.fleet_buyer_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.fleet_opportunity_scores(id),
  listing_id uuid,
  assigned_buyer_id uuid,
  make text,
  model text,
  year int,
  trim text,
  km int,
  source text,
  auction_house text,
  listing_url text,
  sale_close_at timestamptz,
  target_acquisition_price numeric,
  expected_gross numeric,
  expected_days_to_sell numeric,
  score numeric DEFAULT 0,
  priority text DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal')),
  no_reserve boolean DEFAULT false,
  has_damage boolean DEFAULT false,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'bid_placed', 'won', 'lost', 'passed', 'expired')),
  bid_amount numeric,
  acknowledged_at timestamptz,
  bid_placed_at timestamptz,
  outcome_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fleet_buyer_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can read own instructions" ON public.fleet_buyer_instructions
  FOR SELECT USING (
    assigned_buyer_id = auth.uid()
    OR fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid() AND role IN ('manager', 'admin'))
    OR EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid())
  );

CREATE POLICY "Buyers can update own instructions" ON public.fleet_buyer_instructions
  FOR UPDATE USING (
    assigned_buyer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid())
  );

CREATE POLICY "Service role can insert instructions" ON public.fleet_buyer_instructions
  FOR INSERT WITH CHECK (true);

-- 8. fleet_buyer_activity — immutable audit trail of buyer actions
CREATE TABLE IF NOT EXISTS public.fleet_buyer_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instruction_id uuid NOT NULL REFERENCES public.fleet_buyer_instructions(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  action_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fleet_buyer_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet users can read activity" ON public.fleet_buyer_activity
  FOR SELECT USING (
    instruction_id IN (SELECT id FROM public.fleet_buyer_instructions WHERE assigned_buyer_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.dealer_profiles dp WHERE dp.user_id = auth.uid())
  );

CREATE POLICY "Anyone can insert activity" ON public.fleet_buyer_activity
  FOR INSERT WITH CHECK (true);

-- Enable realtime for buyer instructions
ALTER PUBLICATION supabase_realtime ADD TABLE public.fleet_buyer_instructions;
