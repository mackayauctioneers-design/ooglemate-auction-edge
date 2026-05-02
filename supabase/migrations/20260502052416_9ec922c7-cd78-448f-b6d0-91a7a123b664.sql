-- vehicle_listings
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_upper_make_model
  ON public.vehicle_listings (upper(btrim(make)), upper(btrim(model)));

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_upper_make_model_first_seen
  ON public.vehicle_listings (upper(btrim(make)), upper(btrim(model)), first_seen_at DESC)
  WHERE LOWER(COALESCE(status,'')) IN
        ('active','listed','inprep','catalogue','relisted','prepcompleted');

-- retail_listings
CREATE INDEX IF NOT EXISTS idx_retail_listings_upper_make_model
  ON public.retail_listings (upper(btrim(make)), upper(btrim(model)));

CREATE INDEX IF NOT EXISTS idx_retail_listings_upper_make_model_first_seen
  ON public.retail_listings (upper(btrim(make)), upper(btrim(model)), first_seen_at DESC)
  WHERE LOWER(COALESCE(lifecycle_status,'')) IN
        ('active','listed','inprep','catalogue','relisted','prepcompleted');

ANALYZE public.vehicle_listings;
ANALYZE public.retail_listings;