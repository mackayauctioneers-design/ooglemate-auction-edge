-- Normalize region_id values in dealer_profiles to uppercase state codes
UPDATE dealer_profiles SET region_id = 'NSW' WHERE lower(region_id) IN ('nsw', 'new south wales');
UPDATE dealer_profiles SET region_id = 'VIC' WHERE lower(region_id) IN ('vic', 'victoria');
UPDATE dealer_profiles SET region_id = 'QLD' WHERE lower(region_id) IN ('qld', 'queensland');
UPDATE dealer_profiles SET region_id = 'WA' WHERE lower(region_id) IN ('wa', 'western australia');
UPDATE dealer_profiles SET region_id = 'SA' WHERE lower(region_id) IN ('sa', 'south australia');
UPDATE dealer_profiles SET region_id = 'TAS' WHERE lower(region_id) IN ('tas', 'tasmania');
UPDATE dealer_profiles SET region_id = 'ACT' WHERE lower(region_id) IN ('act', 'australian capital territory');
UPDATE dealer_profiles SET region_id = 'NT' WHERE lower(region_id) IN ('nt', 'northern territory');
UPDATE dealer_profiles SET region_id = 'UNKNOWN' WHERE region_id IS NULL OR region_id = '';
