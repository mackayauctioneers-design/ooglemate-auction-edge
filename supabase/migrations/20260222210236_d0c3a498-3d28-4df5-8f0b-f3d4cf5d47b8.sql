
ALTER TABLE public.operator_opportunities 
ADD COLUMN IF NOT EXISTS motivation_signal text,
ADD COLUMN IF NOT EXISTS pass_count integer DEFAULT 0;

COMMENT ON COLUMN public.operator_opportunities.motivation_signal IS 'Motivation boost: 3RD_RUN, WEEK_PLUS_STOCK, MOTIVATED_SELLER, etc.';
COMMENT ON COLUMN public.operator_opportunities.pass_count IS 'Number of times the lot has been passed in at auction';
