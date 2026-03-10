
-- cheap_car_queue: verification queue for below-market Carsales listings
CREATE TABLE public.cheap_car_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'carsales',
  listing_id text NOT NULL,
  make text,
  model text,
  variant text,
  year integer,
  km integer,
  price numeric,
  market_price numeric,
  discount_pct numeric,
  deal_tag text,
  location text,
  seller_type text,
  listing_url text,
  image_url text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'NEW',
  josh_verified boolean NOT NULL DEFAULT false,
  josh_score integer,
  condition_notes text,
  flag_damage boolean DEFAULT false,
  flag_wrong_variant boolean DEFAULT false,
  flag_km_issue boolean DEFAULT false,
  flag_sold boolean DEFAULT false,
  verified_at timestamptz,
  engine_type text,
  fuel_type text,
  transmission text,
  price_badge text,
  UNIQUE(listing_id)
);

ALTER TABLE public.cheap_car_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cheap_car_queue"
  ON public.cheap_car_queue FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update cheap_car_queue"
  ON public.cheap_car_queue FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert cheap_car_queue"
  ON public.cheap_car_queue FOR INSERT TO authenticated WITH CHECK (true);

-- verified_deals: deals that pass Josh verification with high score
CREATE TABLE public.verified_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cheap_car_queue_id uuid REFERENCES public.cheap_car_queue(id) ON DELETE CASCADE,
  make text,
  model text,
  variant text,
  year integer,
  km integer,
  price numeric,
  market_price numeric,
  discount_pct numeric,
  listing_url text,
  location text,
  seller_type text,
  josh_score integer,
  condition_notes text,
  engine_type text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'VERIFIED',
  matched_dealer_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verified_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read verified_deals"
  ON public.verified_deals FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert verified_deals"
  ON public.verified_deals FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update verified_deals"
  ON public.verified_deals FOR UPDATE TO authenticated USING (true);

CREATE INDEX idx_cheap_car_queue_status ON public.cheap_car_queue(status);
CREATE INDEX idx_cheap_car_queue_listing_id ON public.cheap_car_queue(listing_id);
