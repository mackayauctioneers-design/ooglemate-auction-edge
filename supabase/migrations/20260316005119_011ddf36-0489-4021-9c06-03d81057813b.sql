
-- market_listing_history: RLS on but NO policies - add public read
CREATE POLICY "Anyone can view market listing history"
  ON public.market_listing_history
  FOR SELECT
  USING (true);

-- cheap_car_queue: add anon read
CREATE POLICY "Anon can read cheap_car_queue"
  ON public.cheap_car_queue
  FOR SELECT TO anon
  USING (true);

-- listing_events: open to all instead of admin-only
DROP POLICY IF EXISTS "Admins can view listing events" ON public.listing_events;
CREATE POLICY "Anyone can view listing events"
  ON public.listing_events
  FOR SELECT
  USING (true);

-- demand_opportunities: add authenticated read
CREATE POLICY "Authenticated can view demand opportunities"
  ON public.demand_opportunities
  FOR SELECT TO authenticated
  USING (true);

-- matched_opportunities_v1: add admin/internal read across all accounts
CREATE POLICY "Admins can view all matched opportunities"
  ON public.matched_opportunities_v1
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'internal'::app_role));
