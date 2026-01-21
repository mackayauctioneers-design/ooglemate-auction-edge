-- Enable RLS on new tables
ALTER TABLE geo_sa2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_postcode_sa2_xref ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail_listing_sightings ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail_geo_heat_sa2_daily ENABLE ROW LEVEL SECURITY;

-- geo_sa2: Public read (reference data)
CREATE POLICY "geo_sa2_public_read" ON geo_sa2
  FOR SELECT USING (true);

-- geo_postcode_sa2_xref: Public read (reference data)
CREATE POLICY "geo_postcode_sa2_xref_public_read" ON geo_postcode_sa2_xref
  FOR SELECT USING (true);

-- retail_listing_sightings: Public read (analytics data)
CREATE POLICY "retail_listing_sightings_public_read" ON retail_listing_sightings
  FOR SELECT USING (true);

-- retail_geo_heat_sa2_daily: Public read (dashboard data)
CREATE POLICY "retail_geo_heat_sa2_daily_public_read" ON retail_geo_heat_sa2_daily
  FOR SELECT USING (true);