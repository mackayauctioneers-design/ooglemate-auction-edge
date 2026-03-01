
ALTER TABLE public.manus_search_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access" ON public.manus_search_tasks;
DROP POLICY IF EXISTS "Allow authenticated read" ON public.manus_search_tasks;
DROP POLICY IF EXISTS "Allow anon read" ON public.manus_search_tasks;

CREATE POLICY "Allow service role full access"
  ON public.manus_search_tasks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated read"
  ON public.manus_search_tasks FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Allow anon read"
  ON public.manus_search_tasks FOR SELECT TO anon
  USING (true);

ALTER TABLE public.retail_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access" ON public.retail_listings;
DROP POLICY IF EXISTS "Allow authenticated read" ON public.retail_listings;
DROP POLICY IF EXISTS "Allow anon read" ON public.retail_listings;

CREATE POLICY "Allow service role full access"
  ON public.retail_listings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated read"
  ON public.retail_listings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Allow anon read"
  ON public.retail_listings FOR SELECT TO anon
  USING (true);

ALTER TABLE public.search_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access" ON public.search_cache;
DROP POLICY IF EXISTS "Allow authenticated read" ON public.search_cache;
DROP POLICY IF EXISTS "Allow anon read" ON public.search_cache;

CREATE POLICY "Allow service role full access"
  ON public.search_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated read"
  ON public.search_cache FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Allow anon read"
  ON public.search_cache FOR SELECT TO anon
  USING (true);
