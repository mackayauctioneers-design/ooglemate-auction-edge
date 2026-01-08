-- Add parser_confidence column to track extraction method reliability
ALTER TABLE public.dealer_rooftops 
ADD COLUMN IF NOT EXISTS parser_confidence TEXT DEFAULT 'unknown'
CHECK (parser_confidence IN ('high', 'medium', 'low', 'unknown'));

-- Add comment for documentation
COMMENT ON COLUMN public.dealer_rooftops.parser_confidence IS 'Extraction confidence: high=json-ld, medium=stock-card, low=generic-link';