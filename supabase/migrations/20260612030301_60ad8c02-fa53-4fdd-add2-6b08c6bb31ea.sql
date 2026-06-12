-- 1. EXTEND dealer_context with enterprise fields
ALTER TABLE public.dealer_context
  ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS monthly_fee numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_data_imported boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_sales_records integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending_setup';

-- 2. DEALER INVENTORY (current stock per dealer)
CREATE TABLE IF NOT EXISTS public.dealer_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id text NOT NULL REFERENCES public.dealer_context(dealer_id) ON DELETE CASCADE,
  stock_number text,
  vin text,
  make text,
  model text,
  variant text,
  year integer,
  km integer,
  listed_price numeric(12,2),
  status text DEFAULT 'in_stock',
  days_in_stock integer DEFAULT 0,
  first_listed_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  raw jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_inventory TO authenticated;
GRANT ALL ON public.dealer_inventory TO service_role;
ALTER TABLE public.dealer_inventory DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_dealer_inventory_dealer_status ON public.dealer_inventory(dealer_id, status);
CREATE INDEX IF NOT EXISTS idx_dealer_inventory_aging ON public.dealer_inventory(dealer_id, days_in_stock DESC);

-- 3. DEALER EVENTS (partitioned by event_date)
CREATE TABLE IF NOT EXISTS public.dealer_events (
  id bigserial,
  dealer_id text NOT NULL,
  event_type text NOT NULL,
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  payload jsonb,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id, event_date)
) PARTITION BY RANGE (event_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_events TO authenticated;
GRANT ALL ON public.dealer_events TO service_role;
ALTER TABLE public.dealer_events DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.dealer_events_2026_06 PARTITION OF public.dealer_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS public.dealer_events_2026_07 PARTITION OF public.dealer_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS idx_events_dealer ON public.dealer_events(dealer_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON public.dealer_events(event_type, event_date DESC);

-- 4. SYSTEM METRICS
CREATE TABLE IF NOT EXISTS public.system_metrics (
  id bigserial PRIMARY KEY,
  metric_name text NOT NULL,
  metric_value numeric,
  metric_labels jsonb,
  recorded_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_metrics TO authenticated;
GRANT ALL ON public.system_metrics TO service_role;
ALTER TABLE public.system_metrics DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_metrics_name ON public.system_metrics(metric_name, recorded_at DESC);

-- 5. PERFORMANCE VIEW
-- Note: dealer_sales_truth.dealer_id is a UUID FK to dealer_profiles.id, not text key.
-- We expose inventory aggregates here; sales aggregates are placeholders (0) until
-- a text-keyed sales table or mapping exists. Agents read sales truth directly.
CREATE OR REPLACE VIEW public.v_dealer_performance AS
SELECT
  dc.dealer_id,
  dc.dealer_name,
  dc.status,
  0::bigint  AS total_sales,
  0::numeric AS total_gross,
  0::numeric AS avg_gross,
  0::numeric AS avg_days_to_sell,
  COUNT(DISTINCT CASE WHEN di.status = 'in_stock' THEN di.id END) AS current_stock,
  COUNT(DISTINCT CASE WHEN di.status = 'in_stock' AND di.days_in_stock > 45 THEN di.id END) AS aging_stock
FROM public.dealer_context dc
LEFT JOIN public.dealer_inventory di ON dc.dealer_id = di.dealer_id
GROUP BY dc.dealer_id, dc.dealer_name, dc.status;

GRANT SELECT ON public.v_dealer_performance TO authenticated, service_role;

-- 6. SEED PATRICK AUTO (update existing row)
UPDATE public.dealer_context SET
  subscription_tier = 'founding',
  monthly_fee = 2500.00,
  sales_data_imported = true,
  total_sales_records = 333,
  activated_at = NOW(),
  status = 'active',
  updated_at = NOW()
WHERE dealer_id = 'patrick_auto';

-- 7. PREPARE OTHER DEALERS
INSERT INTO public.dealer_context (dealer_id, dealer_name, telegram_chat_id, status, active)
VALUES
  ('acm_cars',   'ACM Cars',   NULL, 'pending_setup', false),
  ('cable_teak', 'Cable Teak', NULL, 'pending_setup', false),
  ('ajh',        'AJH',        NULL, 'pending_setup', false)
ON CONFLICT (dealer_id) DO NOTHING;

-- 8. PARTITION MAINTENANCE FUNCTION
CREATE OR REPLACE FUNCTION public.create_dealer_events_partition()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  partition_date date;
  partition_name text;
  start_date date;
  end_date date;
BEGIN
  partition_date := date_trunc('month', CURRENT_DATE + interval '1 month');
  partition_name := 'dealer_events_' || to_char(partition_date, 'YYYY_MM');
  start_date := partition_date;
  end_date := partition_date + interval '1 month';

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.dealer_events FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );
END;
$$;

-- updated_at trigger for dealer_inventory
CREATE TRIGGER trg_dealer_inventory_updated
  BEFORE UPDATE ON public.dealer_inventory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();