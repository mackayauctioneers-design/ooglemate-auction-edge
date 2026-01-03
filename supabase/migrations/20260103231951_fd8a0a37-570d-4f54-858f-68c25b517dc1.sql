-- Create valo_requests table for OANCA logging
-- Stores every valuation request with OANCA object + comps used

CREATE TABLE public.valo_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Request input
  dealer_name TEXT,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  variant_family TEXT,
  km INTEGER,
  transmission TEXT,
  engine TEXT,
  location TEXT,
  raw_transcript TEXT,
  
  -- OANCA output (the full price object)
  oanca_object JSONB NOT NULL,
  
  -- Key OANCA fields denormalized for querying
  allow_price BOOLEAN NOT NULL,
  verdict TEXT NOT NULL,  -- 'BUY' | 'HIT_IT' | 'HARD_WORK' | 'NEED_PICS' | 'WALK'
  demand_class TEXT,  -- 'fast' | 'average' | 'hard_work' | 'poison'
  confidence TEXT,  -- 'HIGH' | 'MED' | 'LOW'
  n_comps INTEGER NOT NULL DEFAULT 0,
  anchor_owe NUMERIC,
  buy_low NUMERIC,
  buy_high NUMERIC,
  
  -- Comps used (array of record_ids from dealer_sales_history)
  comps_used TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  
  -- Audit
  bob_response TEXT,
  processing_time_ms INTEGER
);

-- Enable RLS
ALTER TABLE public.valo_requests ENABLE ROW LEVEL SECURITY;

-- Admins can view all requests
CREATE POLICY "Admins can view all valo requests"
ON public.valo_requests
FOR SELECT
USING (true);

-- Anyone can insert (edge function uses service role)
CREATE POLICY "Service can insert valo requests"
ON public.valo_requests
FOR INSERT
WITH CHECK (true);

-- Create index for common queries
CREATE INDEX idx_valo_requests_created_at ON public.valo_requests(created_at DESC);
CREATE INDEX idx_valo_requests_dealer ON public.valo_requests(dealer_name);
CREATE INDEX idx_valo_requests_vehicle ON public.valo_requests(make, model, year);
CREATE INDEX idx_valo_requests_verdict ON public.valo_requests(verdict);

-- Add comment
COMMENT ON TABLE public.valo_requests IS 'OANCA engine valuation request log - stores every request with computed price object and comps used for audit';