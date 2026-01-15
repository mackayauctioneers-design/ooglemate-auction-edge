-- Create table for raw AutoTrader API payloads
CREATE TABLE IF NOT EXISTS public.autotrader_raw_payloads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_listing_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  price_at_first_seen INTEGER,
  price_at_last_seen INTEGER,
  times_seen INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_listing_id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_autotrader_raw_source_id ON public.autotrader_raw_payloads(source_listing_id);
CREATE INDEX IF NOT EXISTS idx_autotrader_raw_last_seen ON public.autotrader_raw_payloads(last_seen_at);

-- Enable RLS
ALTER TABLE public.autotrader_raw_payloads ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role)
CREATE POLICY "Service role full access" ON public.autotrader_raw_payloads
  FOR ALL USING (true) WITH CHECK (true);

-- Add comment
COMMENT ON TABLE public.autotrader_raw_payloads IS 'Raw JSON payloads from AutoTrader API for lifecycle tracking';