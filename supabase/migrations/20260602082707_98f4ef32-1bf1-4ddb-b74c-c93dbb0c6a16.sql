CREATE TABLE public.wholesale_opportunities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  dealer_id UUID NULL,
  make TEXT NULL,
  model TEXT NULL,
  variant TEXT NULL,
  year INTEGER NULL,
  km INTEGER NULL,
  colour TEXT NULL,
  wholesale_price NUMERIC NULL,
  estimated_retail NUMERIC NULL,
  estimated_margin NUMERIC NULL,
  freight_cost NUMERIC NULL,
  auction_date TIMESTAMPTZ NULL,
  auction_house TEXT NULL,
  lot_number TEXT NULL,
  location TEXT NULL,
  fingerprint_id TEXT NULL,
  fingerprint_match_score NUMERIC NULL,
  confidence NUMERIC NULL,
  listing_url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  why_json JSONB NULL,
  raw_payload JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wholesale_opportunities_source_listing_uk UNIQUE (source, listing_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wholesale_opportunities TO authenticated;
GRANT ALL ON public.wholesale_opportunities TO service_role;

ALTER TABLE public.wholesale_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view wholesale opportunities"
ON public.wholesale_opportunities
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage wholesale opportunities"
ON public.wholesale_opportunities
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_wholesale_opportunities_created_at ON public.wholesale_opportunities (created_at DESC);
CREATE INDEX idx_wholesale_opportunities_auction_date ON public.wholesale_opportunities (auction_date);
CREATE INDEX idx_wholesale_opportunities_status ON public.wholesale_opportunities (status);

CREATE TRIGGER update_wholesale_opportunities_updated_at
BEFORE UPDATE ON public.wholesale_opportunities
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();