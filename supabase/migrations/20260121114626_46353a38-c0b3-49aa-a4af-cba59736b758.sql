-- Create geo_suburb_postcode_xref table for suburb+state → postcode lookup
CREATE TABLE IF NOT EXISTS geo_suburb_postcode_xref (
  state text NOT NULL,
  suburb text NOT NULL,
  postcode text NOT NULL,
  confidence text DEFAULT 'HIGH' CHECK (confidence IN ('HIGH','MED','LOW')),
  PRIMARY KEY (state, suburb)
);

CREATE INDEX IF NOT EXISTS idx_suburb_postcode_xref_lookup ON geo_suburb_postcode_xref(state, upper(suburb));

-- Resolver function: suburb+state → postcode
CREATE OR REPLACE FUNCTION fn_resolve_postcode_from_suburb_state(p_state text, p_suburb text)
RETURNS TABLE (
  postcode text,
  confidence text
)
LANGUAGE sql
STABLE
AS $$
  SELECT x.postcode, x.confidence
  FROM geo_suburb_postcode_xref x
  WHERE x.state = upper(p_state)
    AND upper(x.suburb) = upper(p_suburb)
  LIMIT 1;
$$;

-- Seed some common NSW suburbs for immediate use
INSERT INTO geo_suburb_postcode_xref (state, suburb, postcode, confidence) VALUES
  ('NSW', 'Parramatta', '2150', 'HIGH'),
  ('NSW', 'Hornsby', '2077', 'HIGH'),
  ('NSW', 'Blacktown', '2148', 'HIGH'),
  ('NSW', 'Penrith', '2750', 'HIGH'),
  ('NSW', 'Liverpool', '2170', 'HIGH'),
  ('NSW', 'Bankstown', '2200', 'HIGH'),
  ('NSW', 'Campbelltown', '2560', 'HIGH'),
  ('NSW', 'Chatswood', '2067', 'HIGH'),
  ('NSW', 'Ryde', '2112', 'HIGH'),
  ('NSW', 'Hurstville', '2220', 'HIGH'),
  ('NSW', 'Sutherland', '2232', 'HIGH'),
  ('NSW', 'Gosford', '2250', 'HIGH'),
  ('NSW', 'Newcastle', '2300', 'HIGH'),
  ('NSW', 'Wollongong', '2500', 'HIGH'),
  ('NSW', 'Dubbo', '2830', 'HIGH'),
  ('NSW', 'Tamworth', '2340', 'HIGH'),
  ('NSW', 'Orange', '2800', 'HIGH'),
  ('NSW', 'Wagga Wagga', '2650', 'HIGH'),
  ('NSW', 'Albury', '2640', 'HIGH'),
  ('NSW', 'Alexandria', '2015', 'HIGH'),
  ('NSW', 'Lansvale', '2166', 'HIGH'),
  ('NSW', 'Cessnock', '2325', 'HIGH'),
  ('QLD', 'Brisbane', '4000', 'HIGH'),
  ('QLD', 'Gold Coast', '4217', 'HIGH'),
  ('QLD', 'Sunshine Coast', '4558', 'HIGH'),
  ('QLD', 'Cairns', '4870', 'HIGH'),
  ('QLD', 'Townsville', '4810', 'HIGH'),
  ('VIC', 'Melbourne', '3000', 'HIGH'),
  ('VIC', 'Geelong', '3220', 'HIGH'),
  ('VIC', 'Ballarat', '3350', 'HIGH'),
  ('VIC', 'Bendigo', '3550', 'HIGH'),
  ('SA', 'Adelaide', '5000', 'HIGH'),
  ('WA', 'Perth', '6000', 'HIGH'),
  ('TAS', 'Hobart', '7000', 'HIGH'),
  ('NT', 'Darwin', '0800', 'HIGH'),
  ('ACT', 'Canberra', '2600', 'HIGH')
ON CONFLICT (state, suburb) DO NOTHING;