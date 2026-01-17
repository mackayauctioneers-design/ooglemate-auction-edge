-- Add ID Kit columns to outward_candidates for handling blocked sites
ALTER TABLE public.outward_candidates 
ADD COLUMN IF NOT EXISTS blocked_reason text,
ADD COLUMN IF NOT EXISTS id_kit jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS requires_manual_check boolean DEFAULT false;

-- Add similar columns to hunt_unified_candidates for the merged view
ALTER TABLE public.hunt_unified_candidates
ADD COLUMN IF NOT EXISTS blocked_reason text,
ADD COLUMN IF NOT EXISTS id_kit jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS requires_manual_check boolean DEFAULT false;

-- Add index for quick filtering of manual check items
CREATE INDEX IF NOT EXISTS idx_outward_candidates_manual_check 
ON public.outward_candidates(hunt_id, requires_manual_check) 
WHERE requires_manual_check = true;

COMMENT ON COLUMN public.outward_candidates.id_kit IS 'Identity kit for blocked sources: vin, rego, stockNo, year, make, model, badge, km, price, location, colour, body, cab, engine, how_to_find';
COMMENT ON COLUMN public.outward_candidates.blocked_reason IS 'Reason site is blocked, e.g. anti-scraping, paywall';
COMMENT ON COLUMN public.outward_candidates.requires_manual_check IS 'True if user needs to manually verify in app/site';