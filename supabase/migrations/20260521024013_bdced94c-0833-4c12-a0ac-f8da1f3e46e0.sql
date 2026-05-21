
CREATE TABLE public.dealer_replacement_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  dealer_name text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  variant text,
  year_min integer,
  year_max integer,
  max_price integer NOT NULL,
  max_km integer NOT NULL,
  min_margin integer NOT NULL DEFAULT 2000,
  min_margin_pct numeric NOT NULL DEFAULT 12.0,
  expected_sale_price integer,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_drf_account ON public.dealer_replacement_fingerprints(account_id) WHERE active;
CREATE INDEX idx_drf_make_model ON public.dealer_replacement_fingerprints(lower(make), lower(model)) WHERE active;

ALTER TABLE public.dealer_replacement_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators manage replacement fingerprints"
  ON public.dealer_replacement_fingerprints FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_drf_updated_at
  BEFORE UPDATE ON public.dealer_replacement_fingerprints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.dealer_replacement_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_id uuid NOT NULL REFERENCES public.dealer_replacement_fingerprints(id) ON DELETE CASCADE,
  account_id uuid,
  dealer_name text NOT NULL,
  listing_source text NOT NULL,
  listing_id text NOT NULL,
  listing_url text,
  make text,
  model text,
  variant text,
  year integer,
  km integer,
  price integer NOT NULL,
  expected_sale_price integer,
  est_margin integer,
  est_margin_pct numeric,
  match_reason text,
  telegram_sent boolean NOT NULL DEFAULT false,
  telegram_message_id text,
  telegram_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fingerprint_id, listing_source, listing_id)
);

CREATE INDEX idx_dra_account_created ON public.dealer_replacement_alerts(account_id, created_at DESC);
CREATE INDEX idx_dra_pending_send ON public.dealer_replacement_alerts(created_at) WHERE NOT telegram_sent;

ALTER TABLE public.dealer_replacement_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read replacement alerts"
  ON public.dealer_replacement_alerts FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));
