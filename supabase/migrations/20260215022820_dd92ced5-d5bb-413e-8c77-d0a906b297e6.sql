
-- Create unified opportunities table
CREATE TABLE public.opportunities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  source_type TEXT NOT NULL CHECK (source_type IN ('buy_now', 'auction', 'fingerprint', 'market_deviation')),

  listing_url TEXT NOT NULL,
  stock_id TEXT,

  year INT,
  make TEXT,
  model TEXT,
  variant TEXT,
  kms INT,
  location TEXT,

  buy_price NUMERIC,

  dealer_median_price NUMERIC,
  retail_median_price NUMERIC,

  liquidity_gap NUMERIC,
  retail_gap NUMERIC,
  deviation NUMERIC,

  grok_wholesale_estimate NUMERIC,
  grok_gap NUMERIC,

  flip_count INT,
  median_profit NUMERIC,
  pattern_strong BOOLEAN,

  confidence_score NUMERIC NOT NULL DEFAULT 0,
  confidence_tier TEXT NOT NULL DEFAULT 'LOW' CHECK (confidence_tier IN ('HIGH', 'MEDIUM', 'LOW')),

  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'ignored', 'purchased', 'expired')),

  account_id UUID REFERENCES public.accounts(id),

  CONSTRAINT unique_listing_url UNIQUE (listing_url)
);

-- Enable RLS
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins have full access to opportunities"
ON public.opportunities FOR ALL
USING (true)
WITH CHECK (true);

-- Indexes
CREATE INDEX idx_opportunities_status ON public.opportunities (status);
CREATE INDEX idx_opportunities_source_type ON public.opportunities (source_type);
CREATE INDEX idx_opportunities_confidence ON public.opportunities (confidence_score DESC);
CREATE INDEX idx_opportunities_created ON public.opportunities (created_at DESC);

-- Updated_at trigger
CREATE TRIGGER update_opportunities_updated_at
BEFORE UPDATE ON public.opportunities
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
