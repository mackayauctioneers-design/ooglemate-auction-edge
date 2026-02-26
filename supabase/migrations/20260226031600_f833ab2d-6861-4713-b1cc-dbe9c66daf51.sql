-- Fix all existing Pickles direct lot URLs to search URLs
UPDATE matched_opportunities_v1
SET url_canonical = 'https://www.pickles.com.au/used/search?q=' || year || '+' || REPLACE(make, ' ', '+') || '+' || REPLACE(model, ' ', '+')
WHERE url_canonical ILIKE '%pickles.com.au/used/details%'
  AND year IS NOT NULL
  AND make IS NOT NULL
  AND model IS NOT NULL;