ALTER TABLE public.matched_opportunities_v1 
ADD COLUMN IF NOT EXISTS dealer_action text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS dealer_action_at timestamptz DEFAULT NULL,
ADD COLUMN IF NOT EXISTS dealer_action_note text DEFAULT NULL;