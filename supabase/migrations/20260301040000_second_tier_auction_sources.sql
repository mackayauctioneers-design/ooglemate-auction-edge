-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Second-tier and regional Australian auction house sources
-- Adds ~30 second-tier, regional, dealer-only, and public auction rooms
-- to dealer_outbound_sources for OogleBot and outward search coverage.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── NSW ─────────────────────────────────────────────────────────────────────

INSERT INTO public.dealer_outbound_sources
  (name, url, state, category, adapter_type, is_active, notes)
VALUES
  (
    'F3 Motor Auctions',
    'https://www.f3motorauctions.com.au',
    'NSW',
    'auction',
    'generic_scrape',
    true,
    'Newcastle. Dealer + public. Auctions every Friday 10am. Simulcast available. Lower price range to prestige.'
  ),
  (
    'Auto Auctions Fairfield',
    'https://www.auto-auctions.com.au',
    'NSW',
    'auction',
    'generic_scrape',
    true,
    'Fairfield East NSW. Public auction Wed 10:30am. All makes, all models, all budgets. Est. 1946.'
  ),
  (
    'Suttons Auto Auctions',
    'https://www.suttons.com.au/auto-auctions',
    'NSW',
    'auction',
    'generic_scrape',
    true,
    'Sydney. Public + dealer. Tue/Wed/Thu 10:30am. Wholesale prices. Established 1946.'
  ),
  (
    'Carlins Sydney',
    'https://www.carlins.com.au',
    'NSW',
    'auction',
    'generic_scrape',
    true,
    'Girraween NSW. Dealer only. Weekly online auction. Corporate, fleet and price-range vehicles.'
  ),
  (
    'Carbids / AllBids Car Auctions',
    'https://www.carbids.com.au',
    'NSW',
    'auction',
    'generic_scrape',
    true,
    'ACT/national. Public online. Police-seized, ex-government, dealer consignment. Daily auctions.'
  ),
  (
    'AllBids Car Auctions',
    'https://www.allbids.com.au/b/allbids-car-auctions',
    'NSW',
    'auction',
    'generic_scrape',
    true,
    'Fyshwick ACT. Public online. Police, government, estate vehicles. Thousands of auctions per year.'
  ),
  (
    'Lloyds Auctions - Used Cars',
    'https://www.lloydsauctions.com.au/used-cars-auto/',
    'NSW',
    'auction',
    'generic_scrape',
    true,
    'National. Public online. Weekly car auctions — sedans, 4WDs, utes, hatchbacks. Also classic/collectible.'
  ),
  (
    'Slattery Auctions',
    'https://slatteryauctions.com.au',
    'NSW',
    'auction',
    'generic_scrape',
    true,
    'National. Public. Cars, trucks, machinery. Regular vehicle auctions including prestige and commercial.'
  ),
  (
    'IAAI Australia',
    'https://iaai.com.au',
    'NSW',
    'auction',
    'generic_scrape',
    true,
    'National. 14 locations. Salvage and used vehicles. Live + online. Largest salvage auction in Australia.'
  ),

-- ─── QLD ─────────────────────────────────────────────────────────────────────

  (
    'Central Auto Auctions Brisbane',
    'https://www.centralautoauctions.com.au',
    'QLD',
    'auction',
    'generic_scrape',
    true,
    'Eagle Farm QLD. Dealer only. Est. 1977. QLD''s oldest and largest privately owned dealer-only auction. Wed noon + Fri 10am.'
  ),
  (
    'City Motor Auction Brisbane',
    'https://www.citymotorauction.com.au',
    'QLD',
    'auction',
    'generic_scrape',
    true,
    'Eagle Farm QLD. Dealer only. Wed 10am + Fri 11am. Late model and price range vehicles.'
  ),
  (
    'Carlins Brisbane',
    'https://www.carlins.com.au/auctions',
    'QLD',
    'auction',
    'generic_scrape',
    true,
    'Brisbane. Dealer only. Weekly auctions. Part of Carlins national network (VIC, NSW, QLD, WA).'
  ),
  (
    'Car Auctions Pacific',
    'https://www.carauctions.com.au',
    'QLD',
    'auction',
    'generic_scrape',
    true,
    'QLD. Public and dealer. Regular vehicle auctions across South East Queensland.'
  ),
  (
    'Southside Auto Auctions',
    'https://www.southsideautoauctions.com.au',
    'QLD',
    'auction',
    'generic_scrape',
    true,
    'Brisbane Southside. Public. Regular weekly auctions. Price range and fleet vehicles.'
  ),

-- ─── VIC ─────────────────────────────────────────────────────────────────────

  (
    'Central Motor Auctions Melbourne',
    'https://www.centralmotorauctions.com.au',
    'VIC',
    'auction',
    'generic_scrape',
    true,
    'Melbourne. Est. 1988. One of Melbourne''s oldest and most respected vehicle wholesalers. Dealer and public.'
  ),
  (
    'Carlins Melbourne',
    'https://www.carlins.com.au',
    'VIC',
    'auction',
    'generic_scrape',
    true,
    'Melbourne. Dealer only. Weekly auctions. Founded 1960. Part of Carlins national network.'
  ),
  (
    'Fowles Auction & Sales',
    'https://www.fowles.com.au',
    'VIC',
    'auction',
    'generic_scrape',
    true,
    'Doreen VIC. Public. Mon–Sat viewing. Weekly vehicle auctions. Wide price range.'
  ),
  (
    'Manheim Fowles Melbourne',
    'https://www.manheimfowles.com.au',
    'VIC',
    'auction',
    'generic_scrape',
    true,
    'Melbourne. Dealer and fleet. Weekly car auctions. Government, fleet, damaged, prestige vehicles.'
  ),
  (
    'Lloyds Auctions Victoria',
    'https://www.lloydsauctions.com.au/used-cars-auto/',
    'VIC',
    'auction',
    'generic_scrape',
    true,
    'VIC operations. National online platform. Weekly vehicle auctions including classic and collectible.'
  ),

-- ─── WA ──────────────────────────────────────────────────────────────────────

  (
    'Carlins Perth',
    'https://www.carlins.com.au',
    'WA',
    'auction',
    'generic_scrape',
    true,
    'Perth WA. Dealer only. Weekly auctions. Part of Carlins national network.'
  ),
  (
    'Westside Auto Wholesale',
    'https://www.westsideautowholesale.com.au',
    'WA',
    'dealer',
    'generic_scrape',
    true,
    'Perth WA. Large independent wholesale dealer. ~3,000 vehicle inventory. Key Fleet Enterprise prospect.'
  ),
  (
    'Pickles Perth',
    'https://www.pickles.com.au/locations/perth',
    'WA',
    'auction',
    'pickles',
    true,
    'Perth WA. Pickles branch. Government, fleet, damaged, general vehicles.'
  ),

-- ─── SA ──────────────────────────────────────────────────────────────────────

  (
    'Slattery Auctions Adelaide',
    'https://slatteryauctions.com.au',
    'SA',
    'auction',
    'generic_scrape',
    true,
    'Adelaide SA operations. Cars, trucks, machinery. Regular vehicle auctions.'
  ),
  (
    'Pickles Adelaide',
    'https://www.pickles.com.au/locations/adelaide',
    'SA',
    'auction',
    'pickles',
    true,
    'Adelaide SA. Pickles branch. Government, fleet, damaged, general vehicles.'
  ),
  (
    'Lloyds Auctions Adelaide',
    'https://www.lloydsauctions.com.au/used-cars-auto/',
    'SA',
    'auction',
    'generic_scrape',
    true,
    'SA operations. National online platform. Weekly vehicle auctions.'
  ),

-- ─── ACT ─────────────────────────────────────────────────────────────────────

  (
    'Carbids Auctionplace Fyshwick',
    'https://www.carbids.com.au',
    'ACT',
    'auction',
    'generic_scrape',
    true,
    'Fyshwick ACT. Public. Enthusiast and collector vehicles, police-seized, government fleet. Online and in-room.'
  ),

-- ─── National / Online-only ───────────────────────────────────────────────────

  (
    'Turners Auctions Australia',
    'https://www.turners.co.nz/au',
    'National',
    'auction',
    'generic_scrape',
    true,
    'NZ-origin, expanding AU presence. Online car auctions. Fleet, damaged, finance repossessions.'
  ),
  (
    'GraysOnline Cars',
    'https://www.grays.com/cars',
    'National',
    'auction',
    'grays',
    true,
    'National online. Grays cars category. Fleet, government, damaged, general. Already partially integrated.'
  ),
  (
    'Pickles Online',
    'https://www.pickles.com.au',
    'National',
    'auction',
    'pickles',
    true,
    'National. Already primary integrated source. Included here for completeness in outbound search.'
  ),
  (
    'Manheim Online',
    'https://www.manheim.com.au',
    'National',
    'auction',
    'manheim',
    true,
    'National. Already partially integrated. Fleet, government, damaged, prestige. Weekly auctions.'
  )
ON CONFLICT (url) DO UPDATE SET
  notes = EXCLUDED.notes,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- ─── Summary comment ─────────────────────────────────────────────────────────
-- Total second-tier sources added: ~30
-- Covers: NSW (9), QLD (5), VIC (5), WA (3), SA (3), ACT (1), National (4)
-- Categories: dealer-only auction, public auction, online-only, wholesale dealer
-- Key sources: F3 Motor Auctions, Central Auto Auctions (Brisbane + Melbourne),
--   City Motor Auction, Carlins (national), Auto Auctions Fairfield, Suttons,
--   Fowles, Carbids/AllBids, Lloyds, Slattery, IAAI, Turners
