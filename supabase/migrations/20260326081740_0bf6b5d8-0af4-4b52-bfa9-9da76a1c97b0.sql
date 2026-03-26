
CREATE TABLE public.buyer_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_name TEXT NOT NULL,
  buyer_email TEXT,
  account_id UUID,
  makes_purchased TEXT[] DEFAULT '{}',
  models_purchased TEXT[] DEFAULT '{}',
  price_band_min INTEGER,
  price_band_max INTEGER,
  last_purchase_date DATE,
  total_purchases INTEGER DEFAULT 0,
  avg_purchase_price INTEGER,
  recent_vehicles JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX buyer_fingerprints_name_email_idx ON public.buyer_fingerprints (buyer_name, COALESCE(buyer_email, ''));

ALTER TABLE public.buyer_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on buyer_fingerprints"
  ON public.buyer_fingerprints
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read buyer_fingerprints"
  ON public.buyer_fingerprints
  FOR SELECT
  TO authenticated
  USING (true);
