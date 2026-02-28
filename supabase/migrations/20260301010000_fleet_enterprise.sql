-- ============================================================================
-- CARBITRAGE FLEET ENTERPRISE: DATABASE SCHEMA
-- ============================================================================
-- Tables: fleet_clients, dms_sales_feed, fleet_inventory_feed,
--         fleet_velocity_metrics, fleet_stock_gaps, fleet_opportunity_scores,
--         fleet_buyer_instructions, fleet_buyer_activity
-- ============================================================================

-- 1. FLEET CLIENTS
-- One row per enterprise client (e.g. Westside Auto Wholesale)
CREATE TABLE IF NOT EXISTS public.fleet_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,                         -- e.g. 'westside-auto-wholesale'
  display_name text NOT NULL,                        -- e.g. 'Westside Auto Wholesale'
  state text NOT NULL DEFAULT 'WA',
  dms_type text,                                     -- 'pentana', 'titan', 'reynolds', 'csv', 'api'
  ingest_api_key text NOT NULL DEFAULT gen_random_uuid()::text,  -- secret key for their DMS push
  contact_name text,
  contact_email text,
  contact_phone text,
  account_manager_id uuid REFERENCES auth.users(id),
  is_active boolean NOT NULL DEFAULT true,
  plan_id text NOT NULL DEFAULT 'fleet' REFERENCES public.plans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fleet_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage fleet_clients" ON public.fleet_clients FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Fleet users can read own client" ON public.fleet_clients FOR SELECT TO authenticated
  USING (id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid()));

-- 2. FLEET CLIENT USERS
-- Maps auth users to fleet clients with a role (buyer, manager, admin)
CREATE TABLE IF NOT EXISTS public.fleet_client_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'manager', 'admin')),
  display_name text,
  speciality_makes text[],                           -- e.g. ['TOYOTA', 'MAZDA'] — routes instructions to this buyer
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fleet_client_id, user_id)
);

ALTER TABLE public.fleet_client_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage fleet_client_users" ON public.fleet_client_users FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Fleet users can read own memberships" ON public.fleet_client_users FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 3. DMS SALES FEED
-- Raw sold vehicle records pushed from the client's DMS
CREATE TABLE IF NOT EXISTS public.dms_sales_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  stock_number text,
  vin text,
  make text NOT NULL,
  model text NOT NULL,
  year integer,
  trim text,                                         -- e.g. 'GX', 'Cruiser', 'SR5'
  engine_type text,                                  -- e.g. 'petrol', 'diesel', 'hybrid'
  transmission text,                                 -- e.g. 'auto', 'manual'
  drivetrain text,                                   -- e.g. '4WD', 'AWD', 'FWD'
  odometer integer,
  colour text,
  acquisition_date date,
  acquisition_cost numeric,
  reconditioning_cost numeric DEFAULT 0,
  sale_date date NOT NULL,
  sale_price numeric NOT NULL,
  gross_profit numeric GENERATED ALWAYS AS (sale_price - COALESCE(acquisition_cost, 0) - COALESCE(reconditioning_cost, 0)) STORED,
  days_to_sell integer GENERATED ALWAYS AS (EXTRACT(DAY FROM (sale_date - COALESCE(acquisition_date, sale_date)))::integer) STORED,
  source_channel text,                               -- 'auction', 'trade-in', 'private', 'wholesale'
  raw_payload jsonb,                                 -- full original DMS record for audit
  ingest_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fleet_client_id, stock_number, sale_date)
);

CREATE INDEX IF NOT EXISTS idx_dms_sales_client ON public.dms_sales_feed(fleet_client_id);
CREATE INDEX IF NOT EXISTS idx_dms_sales_make_model ON public.dms_sales_feed(fleet_client_id, make, model, year);
CREATE INDEX IF NOT EXISTS idx_dms_sales_date ON public.dms_sales_feed(fleet_client_id, sale_date DESC);

ALTER TABLE public.dms_sales_feed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage dms_sales_feed" ON public.dms_sales_feed FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Fleet users can read own sales" ON public.dms_sales_feed FOR SELECT TO authenticated
  USING (fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid()));

-- 4. FLEET INVENTORY FEED
-- Current live inventory snapshot from the client's DMS
CREATE TABLE IF NOT EXISTS public.fleet_inventory_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  stock_number text NOT NULL,
  vin text,
  make text NOT NULL,
  model text NOT NULL,
  year integer,
  trim text,
  engine_type text,
  transmission text,
  drivetrain text,
  odometer integer,
  colour text,
  asking_price numeric,
  acquisition_cost numeric,
  days_on_lot integer,
  location text,
  status text DEFAULT 'available' CHECK (status IN ('available', 'sold', 'pending', 'wholesale')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fleet_client_id, stock_number)
);

CREATE INDEX IF NOT EXISTS idx_fleet_inv_client ON public.fleet_inventory_feed(fleet_client_id);
CREATE INDEX IF NOT EXISTS idx_fleet_inv_make_model ON public.fleet_inventory_feed(fleet_client_id, make, model);
CREATE INDEX IF NOT EXISTS idx_fleet_inv_aged ON public.fleet_inventory_feed(fleet_client_id, days_on_lot DESC) WHERE status = 'available';

ALTER TABLE public.fleet_inventory_feed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage fleet_inventory_feed" ON public.fleet_inventory_feed FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Fleet users can read own inventory" ON public.fleet_inventory_feed FOR SELECT TO authenticated
  USING (fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid()));

-- 5. FLEET VELOCITY METRICS
-- Pre-computed analytics per vehicle fingerprint, refreshed by the Velocity Engine
CREATE TABLE IF NOT EXISTS public.fleet_velocity_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  -- Vehicle fingerprint
  make text NOT NULL,
  model text NOT NULL,
  year_band text NOT NULL,                           -- e.g. '2019-2021', '2022-2024'
  trim text,
  engine_type text,
  -- 30-day metrics
  units_sold_30d integer NOT NULL DEFAULT 0,
  avg_days_to_sell_30d numeric,
  avg_gross_profit_30d numeric,
  avg_acquisition_cost_30d numeric,
  avg_sale_price_30d numeric,
  -- 90-day metrics
  units_sold_90d integer NOT NULL DEFAULT 0,
  avg_days_to_sell_90d numeric,
  avg_gross_profit_90d numeric,
  avg_acquisition_cost_90d numeric,
  avg_sale_price_90d numeric,
  -- Current stock
  units_in_stock integer NOT NULL DEFAULT 0,
  avg_days_on_lot numeric,
  -- Derived signals
  velocity_score numeric,                            -- composite: units/time weighted by margin
  stock_gap_units integer,                           -- how many more we should have right now
  opportunity_value_monthly numeric,                 -- projected monthly gross if gap filled
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fleet_client_id, make, model, year_band, trim, engine_type)
);

CREATE INDEX IF NOT EXISTS idx_fleet_vel_client ON public.fleet_velocity_metrics(fleet_client_id);
CREATE INDEX IF NOT EXISTS idx_fleet_vel_gap ON public.fleet_velocity_metrics(fleet_client_id, stock_gap_units DESC) WHERE stock_gap_units > 0;
CREATE INDEX IF NOT EXISTS idx_fleet_vel_opportunity ON public.fleet_velocity_metrics(fleet_client_id, opportunity_value_monthly DESC);

ALTER TABLE public.fleet_velocity_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage fleet_velocity_metrics" ON public.fleet_velocity_metrics FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Fleet users can read own metrics" ON public.fleet_velocity_metrics FOR SELECT TO authenticated
  USING (fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid()));

-- 6. FLEET OPPORTUNITY SCORES
-- Every market vehicle scored against a fleet client's stock gaps
CREATE TABLE IF NOT EXISTS public.fleet_opportunity_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  listing_id text NOT NULL,                          -- FK to vehicle_listings.listing_id
  velocity_metric_id uuid REFERENCES public.fleet_velocity_metrics(id),
  -- Scoring breakdown
  gap_fit_score integer DEFAULT 0,                   -- 0-40: how well it fills a stock gap
  margin_score integer DEFAULT 0,                    -- 0-30: based on historical gross profit
  price_score integer DEFAULT 0,                     -- 0-20: guide vs. historical acquisition cost
  condition_score integer DEFAULT 0,                 -- 0-10: condition penalties/bonuses
  composite_score integer DEFAULT 0,                 -- sum of above
  -- Pricing intelligence
  target_acquisition_price numeric,                  -- the defensible max bid price
  expected_gross_profit numeric,                     -- projected gross if bought at target price
  historical_avg_sale_price numeric,
  historical_avg_acquisition_cost numeric,
  historical_avg_gross_profit numeric,
  historical_days_to_sell numeric,
  -- Status
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'won', 'lost', 'passed')),
  instruction_sent boolean NOT NULL DEFAULT false,
  scored_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (fleet_client_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_fleet_opp_client ON public.fleet_opportunity_scores(fleet_client_id, composite_score DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_fleet_opp_listing ON public.fleet_opportunity_scores(listing_id);

ALTER TABLE public.fleet_opportunity_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage fleet_opportunity_scores" ON public.fleet_opportunity_scores FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Fleet users can read own scores" ON public.fleet_opportunity_scores FOR SELECT TO authenticated
  USING (fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid()));

-- 7. FLEET BUYER INSTRUCTIONS
-- The actual buying instructions delivered to buyers
CREATE TABLE IF NOT EXISTS public.fleet_buyer_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  opportunity_score_id uuid REFERENCES public.fleet_opportunity_scores(id),
  assigned_buyer_id uuid REFERENCES auth.users(id),
  -- Vehicle data (denormalized for fast display)
  listing_id text NOT NULL,
  make text,
  model text,
  year integer,
  km integer,
  trim text,
  colour text,
  source text,                                       -- 'pickles', 'manheim', 'grays', etc.
  auction_house text,
  listing_url text,
  sale_close_at timestamptz,
  buy_method text,
  -- Instruction data
  target_acquisition_price numeric NOT NULL,
  expected_gross_profit numeric,
  historical_days_to_sell numeric,
  composite_score integer,
  instruction_text text,                             -- human-readable instruction summary
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal')),
  -- Condition flags
  wovr_indicator boolean DEFAULT false,
  damage_noted boolean DEFAULT false,
  no_reserve boolean DEFAULT false,
  -- Lifecycle
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'bid_placed', 'won', 'lost', 'passed', 'expired')),
  acknowledged_at timestamptz,
  bid_amount numeric,
  bid_placed_at timestamptz,
  outcome_at timestamptz,
  outcome_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_instr_client ON public.fleet_buyer_instructions(fleet_client_id, status, sale_close_at ASC);
CREATE INDEX IF NOT EXISTS idx_fleet_instr_buyer ON public.fleet_buyer_instructions(assigned_buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_fleet_instr_close ON public.fleet_buyer_instructions(fleet_client_id, sale_close_at ASC) WHERE status IN ('pending', 'acknowledged', 'bid_placed');

ALTER TABLE public.fleet_buyer_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage fleet_buyer_instructions" ON public.fleet_buyer_instructions FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Fleet buyers can read own instructions" ON public.fleet_buyer_instructions FOR SELECT TO authenticated
  USING (fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid()));
CREATE POLICY "Fleet buyers can update own instructions" ON public.fleet_buyer_instructions FOR UPDATE TO authenticated
  USING (assigned_buyer_id = auth.uid() OR fleet_client_id IN (
    SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid() AND role IN ('manager', 'admin')
  ));

-- 8. FLEET BUYER ACTIVITY LOG
-- Immutable audit trail of every buyer action
CREATE TABLE IF NOT EXISTS public.fleet_buyer_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_client_id uuid NOT NULL REFERENCES public.fleet_clients(id) ON DELETE CASCADE,
  instruction_id uuid REFERENCES public.fleet_buyer_instructions(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,                              -- 'acknowledged', 'bid_placed', 'won', 'lost', 'passed', 'note_added'
  action_data jsonb,                                 -- e.g. { bid_amount: 31500, notes: "..." }
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_activity_client ON public.fleet_buyer_activity(fleet_client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_activity_user ON public.fleet_buyer_activity(user_id, created_at DESC);

ALTER TABLE public.fleet_buyer_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage fleet_buyer_activity" ON public.fleet_buyer_activity FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Fleet users can read own activity" ON public.fleet_buyer_activity FOR SELECT TO authenticated
  USING (fleet_client_id IN (SELECT fleet_client_id FROM public.fleet_client_users WHERE user_id = auth.uid()));
CREATE POLICY "Fleet users can insert own activity" ON public.fleet_buyer_activity FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 9. ADD 'fleet' PLAN TO PLANS TABLE
INSERT INTO public.plans (id, display_name, price_monthly_aud, max_hunts, alert_speed, features, sort_order)
VALUES ('fleet', 'Fleet Enterprise', 0, 9999, 'realtime',
  '["Unlimited hunts", "DMS sales feed integration", "Velocity Engine", "Stock gap analysis", "Buyer Terminal", "Management Dashboard", "Dedicated account manager"]', 3)
ON CONFLICT (id) DO NOTHING;
