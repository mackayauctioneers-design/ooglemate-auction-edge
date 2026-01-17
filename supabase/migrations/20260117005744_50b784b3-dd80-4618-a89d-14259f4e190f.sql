-- Add title column to retail_listings (used by rpc_classify_listing)
ALTER TABLE public.retail_listings 
ADD COLUMN IF NOT EXISTS title text;

-- Also add description column for must-have token matching
ALTER TABLE public.retail_listings 
ADD COLUMN IF NOT EXISTS description text;

-- Create index for text search
CREATE INDEX IF NOT EXISTS idx_retail_listings_title ON public.retail_listings(title) WHERE title IS NOT NULL;