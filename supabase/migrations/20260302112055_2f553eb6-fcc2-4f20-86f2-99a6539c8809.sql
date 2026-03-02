-- Add listing_id column for source-native ad IDs (e.g. "OAG-AD-21234567")
ALTER TABLE public.outward_search_results
  ADD COLUMN IF NOT EXISTS listing_id text;

-- Add unique constraint on source_key + listing_id to prevent duplicate
-- listings across pages from double-scoring
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_listing_id
  ON public.outward_search_results (source_key, listing_id)
  WHERE listing_id IS NOT NULL;