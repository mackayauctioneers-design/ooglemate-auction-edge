-- ============================================================================
-- CARBITRAGE: Josh + Grok + Watchlists + Multi-Account Build (Part 1)
-- ============================================================================

-- 1) ACCOUNTS TABLE (multi-account foundation)
-- ============================================================================
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed initial accounts
INSERT INTO public.accounts (slug, display_name) VALUES
  ('mackay_traders', 'Mackay Traders'),
  ('hardy_traders', 'Hardy Traders');

-- Enable RLS
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read accounts
CREATE POLICY "Authenticated users can view accounts"
  ON public.accounts FOR SELECT
  USING (auth.role() = 'authenticated');

-- 2) URL WATCHLIST TABLE (near-miss URLs)
-- ============================================================================
CREATE TABLE public.url_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  created_by text NOT NULL DEFAULT 'josh',
  assigned_to text NOT NULL DEFAULT 'josh',
  watch_type text NOT NULL CHECK (watch_type IN ('single_listing', 'inventory_list')),
  source text NOT NULL CHECK (source IN ('autograb', 'carsales', 'gumtree', 'carsguide', 'dealer_site', 'pickles', 'manheim', 'grays', 'other')),
  url text NOT NULL,
  domain text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  reason_close text,
  trigger_type text NOT NULL CHECK (trigger_type IN ('price_under', 'price_drop_amount', 'price_drop_percent', 'days_listed_over', 'status_change')),
  trigger_value text NOT NULL,
  last_scan_at timestamptz,
  last_snapshot jsonb,
  last_hash text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_url_watchlist_account ON public.url_watchlist(account_id);
CREATE INDEX idx_url_watchlist_status ON public.url_watchlist(status);

ALTER TABLE public.url_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage watchlist"
  ON public.url_watchlist FOR ALL
  USING (auth.role() = 'authenticated');

-- 3) WATCH EVENTS TABLE (change detection log)
-- ============================================================================
CREATE TABLE public.watch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid NOT NULL REFERENCES public.url_watchlist(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  event_type text NOT NULL CHECK (event_type IN ('price_drop', 'new_item', 'removed', 'status_change', 'blocked', 'error', 'trigger_hit', 'scan_complete')),
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_watch_events_watch ON public.watch_events(watch_id);
CREATE INDEX idx_watch_events_account ON public.watch_events(account_id);
CREATE INDEX idx_watch_events_created ON public.watch_events(created_at DESC);

ALTER TABLE public.watch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view watch events"
  ON public.watch_events FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert watch events"
  ON public.watch_events FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- 4) JOSH_ALERTS TABLE (Send to Dave - renamed to avoid conflict)
-- ============================================================================
CREATE TABLE public.josh_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  created_by text NOT NULL DEFAULT 'josh',
  candidate_queue_id uuid,
  url text,
  title text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'handled', 'dismissed')),
  handled_by text,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_josh_alerts_account ON public.josh_alerts(account_id);
CREATE INDEX idx_josh_alerts_status ON public.josh_alerts(status);

ALTER TABLE public.josh_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage josh alerts"
  ON public.josh_alerts FOR ALL
  USING (auth.role() = 'authenticated');

-- 5) ADD FIELDS TO pickles_detail_queue
-- ============================================================================
ALTER TABLE public.pickles_detail_queue 
ADD COLUMN IF NOT EXISTS account_id uuid,
ADD COLUMN IF NOT EXISTS va_notes text,
ADD COLUMN IF NOT EXISTS reject_reason text,
ADD COLUMN IF NOT EXISTS validated_at timestamptz,
ADD COLUMN IF NOT EXISTS validated_by text;

-- Add FK constraint separately to avoid issues
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'pickles_detail_queue_account_id_fkey'
  ) THEN
    ALTER TABLE public.pickles_detail_queue 
    ADD CONSTRAINT pickles_detail_queue_account_id_fkey 
    FOREIGN KEY (account_id) REFERENCES public.accounts(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pickles_detail_queue_account ON public.pickles_detail_queue(account_id);

-- 6) ADD FIELDS TO dealer_url_queue
-- ============================================================================
ALTER TABLE public.dealer_url_queue
ADD COLUMN IF NOT EXISTS account_id uuid;

-- 7) UPLOAD BATCHES TABLE (sales log upload)
-- ============================================================================
CREATE TABLE public.upload_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  upload_type text NOT NULL CHECK (upload_type IN ('sales_log', 'manual_candidates')),
  filename text,
  uploaded_by text NOT NULL DEFAULT 'josh',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validating', 'validated', 'promoted', 'error')),
  row_count integer DEFAULT 0,
  error_count integer DEFAULT 0,
  error_report jsonb,
  promoted_at timestamptz,
  promoted_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_upload_batches_account ON public.upload_batches(account_id);

ALTER TABLE public.upload_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage upload batches"
  ON public.upload_batches FOR ALL
  USING (auth.role() = 'authenticated');

-- 8) UPLOAD ROWS RAW TABLE (staging for validation)
-- ============================================================================
CREATE TABLE public.upload_rows_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.upload_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw_data jsonb NOT NULL,
  is_valid boolean DEFAULT true,
  validation_errors jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_upload_rows_batch ON public.upload_rows_raw(batch_id);

ALTER TABLE public.upload_rows_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage upload rows"
  ON public.upload_rows_raw FOR ALL
  USING (auth.role() = 'authenticated');

-- 9) SALES LOG STAGE TABLE (validated before promotion)
-- ============================================================================
CREATE TABLE public.sales_log_stage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.upload_batches(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  dealer_name text NOT NULL,
  sale_date date NOT NULL,
  year integer NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  variant text,
  km integer,
  sale_price numeric,
  buy_price numeric,
  location text,
  notes text,
  is_promoted boolean DEFAULT false,
  promoted_to_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_log_stage_batch ON public.sales_log_stage(batch_id);
CREATE INDEX idx_sales_log_stage_account ON public.sales_log_stage(account_id);

ALTER TABLE public.sales_log_stage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage sales log stage"
  ON public.sales_log_stage FOR ALL
  USING (auth.role() = 'authenticated');

-- 10) GROK MISSIONS TABLE
-- ============================================================================
CREATE TABLE public.grok_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  created_by text NOT NULL DEFAULT 'josh',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  criteria jsonb NOT NULL,
  target_urls uuid[] NOT NULL,
  results_count integer DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_grok_missions_account ON public.grok_missions(account_id);
CREATE INDEX idx_grok_missions_status ON public.grok_missions(status);

ALTER TABLE public.grok_missions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage grok missions"
  ON public.grok_missions FOR ALL
  USING (auth.role() = 'authenticated');