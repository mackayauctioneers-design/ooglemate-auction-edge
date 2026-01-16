-- ============================================
-- Kiting Match Prioritisation Schema
-- ============================================

-- 1) Source lane mapping table
CREATE TABLE IF NOT EXISTS public.source_lane_map (
  source text PRIMARY KEY,
  lane text NOT NULL CHECK (lane IN ('AUCTION', 'RETAIL', 'DEALER_SITE', 'CLASSIFIED')),
  lane_bonus int NOT NULL DEFAULT 0,
  notes text NULL
);

-- Seed default mappings
INSERT INTO public.source_lane_map (source, lane, lane_bonus, notes) VALUES
  ('pickles', 'AUCTION', 40, 'Primary auction house'),
  ('manheim', 'AUCTION', 40, 'Major auction house'),
  ('grays', 'AUCTION', 35, 'Auction house'),
  ('lloyds', 'AUCTION', 30, 'Auction house'),
  ('autotrader', 'RETAIL', 15, 'Premium retail marketplace'),
  ('drive', 'DEALER_SITE', 25, 'Dealer aggregator'),
  ('gumtree_dealer', 'CLASSIFIED', 10, 'Dealer classifieds'),
  ('gumtree_private', 'CLASSIFIED', 5, 'Private classifieds')
ON CONFLICT (source) DO NOTHING;

-- 2) Add lane and priority_score to hunt_matches
ALTER TABLE public.hunt_matches 
  ADD COLUMN IF NOT EXISTS lane text NULL,
  ADD COLUMN IF NOT EXISTS priority_score numeric(8,2) NULL;

-- 3) Create index for efficient ordering
CREATE INDEX IF NOT EXISTS idx_hunt_matches_priority 
  ON public.hunt_matches (hunt_id, decision, priority_score DESC, matched_at DESC);

-- 4) Enable RLS on source_lane_map (read-only for all)
ALTER TABLE public.source_lane_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "source_lane_map_select_all" ON public.source_lane_map
  FOR SELECT USING (true);

-- 5) Create a view for ranked matches (optional helper)
CREATE OR REPLACE VIEW public.hunt_matches_ranked AS
SELECT 
  hm.*,
  CASE 
    WHEN hm.decision = 'buy' THEN 1
    WHEN hm.decision = 'watch' THEN 2
    WHEN hm.decision = 'ignore' THEN 3
    ELSE 4
  END as decision_rank
FROM public.hunt_matches hm
ORDER BY 
  hm.hunt_id,
  decision_rank,
  hm.priority_score DESC NULLS LAST,
  hm.matched_at DESC;