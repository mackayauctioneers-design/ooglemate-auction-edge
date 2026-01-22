-- Add missing SA2 codes referenced in the xref
INSERT INTO geo_sa2 (sa2_code, sa2_name, state) VALUES
  ('801071132','Molonglo Valley','NSW')
ON CONFLICT (sa2_code) DO NOTHING;