-- Add asp_search_results as a valid parser_profile
ALTER TABLE public.auction_sources DROP CONSTRAINT IF EXISTS auction_sources_parser_profile_check;
ALTER TABLE public.auction_sources ADD CONSTRAINT auction_sources_parser_profile_check 
  CHECK (parser_profile IN ('bidsonline_default', 'bidsonline_grid', 'bidsonline_table', 'asp_search_results', 'custom'));

-- Now insert the new auction source
INSERT INTO public.auction_sources (
  source_key, 
  display_name, 
  platform, 
  list_url, 
  region_hint, 
  enabled, 
  parser_profile,
  validation_status,
  preflight_status,
  notes
) VALUES (
  'auto_auctions_aav',
  'Auto Auctions (AAV)',
  'custom',
  'https://www.autoauctionsonline.com.au/search_results.aspx?sitekey=AAV&make=All+Makes&model=All+Models&fromyear=2016',
  'NSW_SYDNEY_METRO',
  false,
  'asp_search_results',
  'candidate',
  'pending',
  'ASP search_results platform (same structure as F3). Sydney metro focus.'
) ON CONFLICT (source_key) DO UPDATE SET
  list_url = EXCLUDED.list_url,
  parser_profile = EXCLUDED.parser_profile,
  notes = EXCLUDED.notes;