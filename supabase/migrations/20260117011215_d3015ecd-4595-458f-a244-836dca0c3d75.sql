-- Add foreign key from hunt_matches.listing_id to retail_listings.id
ALTER TABLE public.hunt_matches
ADD CONSTRAINT hunt_matches_listing_id_fkey 
FOREIGN KEY (listing_id) REFERENCES public.retail_listings(id) ON DELETE CASCADE;