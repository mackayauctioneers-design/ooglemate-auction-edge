-- Add unique constraint for idempotent opportunity upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_stock_source 
ON public.opportunities (stock_id, source_type)
WHERE stock_id IS NOT NULL;