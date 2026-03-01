-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Second-tier and regional Australian auction house sources
-- Adds ~30 second-tier, regional, dealer-only, and public auction rooms
-- to dealer_outbound_sources for OogleBot and outward search coverage.
--
-- Uses the EXISTING table schema:
--   dealer_slug, dealer_name, dealer_domain, inventory_path,
--   enabled, priority, state, dealer_type, adapter_type, notes
-- ─────────────────────────────────────────────────────────────────────────────

-- Ensure adapter_type column exists (added by expansion migration, but guard here too)
ALTER TABLE public.dealer_outbound_sources
  ADD COLUMN IF NOT EXISTS adapter_type text NOT NULL DEFAULT 'generic_scrape';

-- ─── NSW ─────────────────────────────────────────────────────────────────────

INSERT INTO public.dealer_outbound_sources
  (dealer_slug, dealer_name, dealer_domain, inventory_path, state, dealer_type, priority, enabled, adapter_type, notes)
VALUES
  ('f3-motor-auctions', 'F3 Motor Auctions', 'www.f3motorauctions.com.au', '/auctions', 'NSW', 'auction', 'high', true, 'generic_scrape',
   'Newcastle. Dealer + public. Auctions every Friday 10am. Simulcast available. Lower price range to prestige.'),
  ('auto-auctions-fairfield', 'Auto Auctions Fairfield', 'www.auto-auctions.com.au', '/Upcoming-Auctions.aspx', 'NSW', 'auction', 'high', true, 'generic_scrape',
   'Fairfield East NSW. Public auction Wed 10:30am. All makes, all models, all budgets. Est. 1946.'),
  ('suttons-auto-auctions', 'Suttons Auto Auctions', 'www.suttons.com.au', '/auto-auctions', 'NSW', 'auction', 'high', true, 'manus',
   'Sydney. Public + dealer. Tue/Wed/Thu 10:30am. Wholesale prices. Established 1946.'),
  ('carlins-sydney', 'Carlins Sydney', 'www.carlins.com.au', '/auctions', 'NSW', 'auction', 'high', true, 'generic_scrape',
   'Girraween NSW. Dealer only. Weekly online auction. Corporate, fleet and price-range vehicles.'),
  ('carbids', 'Carbids / AllBids Car Auctions', 'www.carbids.com.au', '/c/allbids-car-auctions', 'NSW', 'auction', 'high', true, 'generic_scrape',
   'ACT/national. Public online. Police-seized, ex-government, dealer consignment. Daily auctions.'),
  ('allbids-car-auctions', 'AllBids Car Auctions', 'www.allbids.com.au', '/b/allbids-car-auctions', 'ACT', 'auction', 'normal', true, 'generic_scrape',
   'Fyshwick ACT. Public online. Police, government, estate vehicles. Thousands of auctions per year.'),
  ('lloyds-auctions', 'Lloyds Auctions - Used Cars', 'www.lloydsauctions.com.au', '/used-cars-auto/', 'NSW', 'auction', 'high', true, 'generic_scrape',
   'National. Public online. Weekly car auctions — sedans, 4WDs, utes, hatchbacks. Also classic/collectible.'),
  ('slattery-auctions', 'Slattery Auctions', 'slatteryauctions.com.au', '/assets', 'NSW', 'auction', 'normal', true, 'generic_scrape',
   'National. Public. Cars, trucks, machinery. Regular vehicle auctions including prestige and commercial.'),
  ('iaai-australia', 'IAAI Australia', 'iaai.com.au', '/buy/search-vehicles', 'NSW', 'auction', 'normal', true, 'generic_scrape',
   'National. 14 locations. Salvage and used vehicles. Live + online. Largest salvage auction in Australia.'),

-- ─── QLD ─────────────────────────────────────────────────────────────────────

  ('central-auto-auctions-brisbane', 'Central Auto Auctions Brisbane', 'www.centralautoauctions.com.au', '/current-stock', 'QLD', 'auction', 'high', true, 'generic_scrape',
   'Eagle Farm QLD. Dealer only. Est. 1977. QLD oldest and largest privately owned dealer-only auction. Wed noon + Fri 10am.'),
  ('city-motor-auction-brisbane', 'City Motor Auction Brisbane', 'www.citymotorauction.com.au', '/current-stock', 'QLD', 'auction', 'high', true, 'generic_scrape',
   'Eagle Farm QLD. Dealer only. Wed 10am + Fri 11am. Late model and price range vehicles.'),
  ('car-auctions-pacific', 'Car Auctions Pacific', 'www.carauctions.com.au', '/vehicles', 'QLD', 'auction', 'normal', true, 'generic_scrape',
   'QLD. Public and dealer. Regular vehicle auctions across South East Queensland.'),
  ('southside-auto-auctions', 'Southside Auto Auctions', 'www.southsideautoauctions.com.au', '/stock', 'QLD', 'auction', 'normal', true, 'generic_scrape',
   'Brisbane Southside. Public. Regular weekly auctions. Price range and fleet vehicles.'),

-- ─── VIC ─────────────────────────────────────────────────────────────────────

  ('central-motor-auctions-melbourne', 'Central Motor Auctions Melbourne', 'www.centralmotorauctions.com.au', '/stock', 'VIC', 'auction', 'high', true, 'generic_scrape',
   'Melbourne. Est. 1988. One of Melbourne oldest and most respected vehicle wholesalers. Dealer and public.'),
  ('fowles-auction', 'Fowles Auction & Sales', 'www.fowles.com.au', '/latest-auction/', 'VIC', 'auction', 'high', true, 'generic_scrape',
   'Doreen VIC. Public. Mon-Sat viewing. Weekly vehicle auctions. Wide price range.'),
  ('manheim-fowles-melbourne', 'Manheim Fowles Melbourne', 'www.manheimfowles.com.au', '/passenger-vehicles', 'VIC', 'auction', 'normal', true, 'generic_scrape',
   'Melbourne. Dealer and fleet. Weekly car auctions. Government, fleet, damaged, prestige vehicles.'),

-- ─── WA ──────────────────────────────────────────────────────────────────────

  ('westside-auto-wholesale', 'Westside Auto Wholesale', 'www.westsideautowholesale.com.au', '/stock', 'WA', 'independent', 'high', true, 'manus',
   'Perth WA. Large independent wholesale dealer. ~3,000 vehicle inventory. Key Fleet Enterprise prospect.'),

-- ─── National / Online-only ───────────────────────────────────────────────────

  ('turners-auctions-au', 'Turners Auctions Australia', 'www.turners.co.nz', '/au/cars', 'National', 'auction', 'normal', true, 'generic_scrape',
   'NZ-origin, expanding AU presence. Online car auctions. Fleet, damaged, finance repossessions.'),
  ('lloyds-classic-cars', 'Lloyds Classic & Collectible Cars', 'www.lloydsauctions.com.au', '/classiccars/', 'National', 'auction', 'low', true, 'generic_scrape',
   'National online. Classic, muscle, vintage, project cars. Collector market.')

ON CONFLICT (dealer_slug) DO UPDATE SET
  dealer_name = EXCLUDED.dealer_name,
  dealer_domain = EXCLUDED.dealer_domain,
  inventory_path = EXCLUDED.inventory_path,
  state = EXCLUDED.state,
  dealer_type = EXCLUDED.dealer_type,
  priority = EXCLUDED.priority,
  enabled = EXCLUDED.enabled,
  adapter_type = EXCLUDED.adapter_type,
  notes = EXCLUDED.notes,
  updated_at = now();

-- ─── Summary ─────────────────────────────────────────────────────────────────
-- Sources added/updated: ~20 second-tier auction houses
-- NSW: F3 Motor Auctions, Auto Auctions Fairfield, Suttons, Carlins Sydney,
--      Carbids/AllBids, Lloyds Auctions, Slattery, IAAI Australia
-- QLD: Central Auto Auctions, City Motor Auction, Car Auctions Pacific,
--      Southside Auto Auctions
-- VIC: Central Motor Auctions, Fowles, Manheim Fowles
-- WA:  Westside Auto Wholesale
-- ACT: AllBids
-- National: Turners, Lloyds Classic
