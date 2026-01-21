-- Create dealer_site → postcode mapping for dealers with incomplete location data
CREATE TABLE IF NOT EXISTS dealer_site_postcode_xref (
  dealer_slug text PRIMARY KEY,
  postcode text NOT NULL,
  suburb text,
  state text NOT NULL
);

-- Seed known dealer sites with their postcodes
INSERT INTO dealer_site_postcode_xref (dealer_slug, postcode, suburb, state) VALUES
  ('parramatta-motor-group', '2150', 'Parramatta', 'NSW'),
  ('parramatta-hyundai', '2150', 'Parramatta', 'NSW'),
  ('parramatta-kia', '2150', 'Parramatta', 'NSW'),
  ('hornsby-toyota', '2077', 'Hornsby', 'NSW'),
  ('dubbo-automotive', '2830', 'Dubbo', 'NSW'),
  ('maughan-thiem-hyundai', '5000', 'Adelaide', 'SA'),
  ('cessnock-kia', '2325', 'Cessnock', 'NSW'),
  ('newcastle-toyota', '2300', 'Newcastle', 'NSW'),
  ('lansvale-motor-group', '2166', 'Lansvale', 'NSW'),
  ('alexandria-mazda', '2015', 'Alexandria', 'NSW'),
  ('blacktown-mazda', '2148', 'Blacktown', 'NSW'),
  ('bankstown-mg', '2200', 'Bankstown', 'NSW'),
  ('ccmg', '2250', 'Gosford', 'NSW'),
  ('gosford-mazda', '2250', 'Gosford', 'NSW'),
  ('central-coast-vw', '2250', 'Gosford', 'NSW'),
  ('central-coast-isuzu', '2250', 'Gosford', 'NSW'),
  ('chery-gosford', '2250', 'Gosford', 'NSW')
ON CONFLICT (dealer_slug) DO NOTHING;

-- Function to extract dealer_slug from source
CREATE OR REPLACE FUNCTION fn_extract_dealer_slug(p_source text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE 
    WHEN p_source LIKE 'dealer_site:%' THEN substring(p_source from 13)
    ELSE NULL
  END;
$$;

-- Backfill postcode from dealer_slug for listings missing postcode
UPDATE vehicle_listings vl
SET 
  postcode = dx.postcode,
  suburb = COALESCE(vl.suburb, dx.suburb),
  state = COALESCE(vl.state, dx.state)
FROM dealer_site_postcode_xref dx
WHERE fn_extract_dealer_slug(vl.source) = dx.dealer_slug
  AND vl.postcode IS NULL;