-- Allow Mike (mike.simmons@westsideauto.com.au) read access to his Westside data
CREATE POLICY "Mike can view his westside listings"
ON public.westside_mike_listings FOR SELECT
TO authenticated
USING (lower((auth.jwt() ->> 'email')) = 'mike.simmons@westsideauto.com.au');

CREATE POLICY "Mike can view his westside history"
ON public.westside_mike_listing_history FOR SELECT
TO authenticated
USING (lower((auth.jwt() ->> 'email')) = 'mike.simmons@westsideauto.com.au');

CREATE POLICY "Mike can view his westside snapshots"
ON public.westside_mike_snapshots FOR SELECT
TO authenticated
USING (lower((auth.jwt() ->> 'email')) = 'mike.simmons@westsideauto.com.au');