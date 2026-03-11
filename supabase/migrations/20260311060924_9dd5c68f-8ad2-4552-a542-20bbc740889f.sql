
ALTER TABLE public.operator_opportunities 
  ADD COLUMN IF NOT EXISTS dismissed_anchor_ids uuid[] DEFAULT '{}';
