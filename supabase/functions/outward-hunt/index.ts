import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// =====================================================
// CARSALES RESULTS PAGE EXTRACTOR
// When we get a Carsales results page (not a details page),
// scrape it and extract individual listing cards
// =====================================================

interface CarsalesListingCard {
  external_id: string;  // Unique ID for dedup (listing ID or hash)
  details_url: string | null;
  title: string;
  price: number | null;
  km: number | null;
  year: number | null;
  state: string | null;
  badge: string | null;
  raw_snippet: string;
}

function isCarsalesResultsPage(url: string): boolean {
  const lower = url.toLowerCase();
  // Results pages: /cars/toyota/landcruiser/... but NOT /cars/details/...
  return lower.includes('carsales.com.au') && 
         lower.includes('/cars/') && 
         !lower.includes('/details/') &&
         !lower.includes('/car-details/');
}

function isCarsalesDetailsPage(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('carsales.com.au') && 
         (lower.includes('/details/') || lower.includes('/car-details/'));
}

// Extract listing ID from Carsales details URL
function extractCarsalesListingId(url: string): string | null {
  // Pattern: /details/toyota-landcruiser-79-series-SSE-AD-12345678/
  const match = url.match(/SSE-AD-(\d+)/i) || 
                url.match(/\/details\/[^\/]+-(\d{6,})/i) ||
                url.match(/OAG-AD-(\d+)/i);
  return match ? match[1] : null;
}

// Generate a unique ID for a Carsales card when no details URL is available
function generateCarsalesCardId(title: string, price: number | null, km: number | null, state: string | null): string {
  const hash = `${title}|${price || 0}|${km || 0}|${state || 'AU'}`;
  // Simple hash function
  let hashCode = 0;
  for (let i = 0; i < hash.length; i++) {
    const char = hash.charCodeAt(i);
    hashCode = ((hashCode << 5) - hashCode) + char;
    hashCode = hashCode & hashCode; // Convert to 32bit integer
  }
  return `carsales-card-${Math.abs(hashCode).toString(16)}`;
}

// Parse Carsales listing cards from HTML/Markdown content
function parseCarsalesListingCards(content: string, resultsPageUrl: string): CarsalesListingCard[] {
  const cards: CarsalesListingCard[] = [];
  const seen = new Set<string>();
  
  // Multiple patterns to extract listing data from Carsales
  // The HTML typically has listing cards with:
  // - Title with year, make, model, badge
  // - Price like "$XX,XXX" or "Price on Application"
  // - KM like "XX,XXX km"
  // - Location/State
  // - Link to details page
  
  // Pattern 1: Try to find individual listing links with details
  const detailsUrlPattern = /href=["']([^"']*carsales\.com\.au[^"']*\/details\/[^"']+)["']/gi;
  const detailsUrls = Array.from(content.matchAll(detailsUrlPattern));
  
  // Pattern 2: Extract listing info from markdown blocks
  // Carsales often shows listings like:
  // ## 2024 Toyota LandCruiser 79 Series
  // $XX,XXX
  // XX,XXX km | Location, State
  
  const lines = content.split(/\n/);
  let currentCard: Partial<CarsalesListingCard> | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Look for vehicle title patterns (year + make + model)
    const titleMatch = line.match(/^#+\s*(20[1-2]\d.*(?:Toyota|LandCruiser|Land\s*Cruiser).*)/i) ||
                       line.match(/^\*\*\s*(20[1-2]\d.*(?:Toyota|LandCruiser|Land\s*Cruiser).*)\*\*/i) ||
                       line.match(/^(20[1-2]\d\s+Toyota\s+Land\s*Cruiser[^$\n]*)/i);
    
    if (titleMatch) {
      // Save previous card if exists
      if (currentCard && currentCard.title) {
        const id = currentCard.external_id || generateCarsalesCardId(
          currentCard.title,
          currentCard.price || null,
          currentCard.km || null,
          currentCard.state || null
        );
        if (!seen.has(id)) {
          seen.add(id);
          cards.push({
            external_id: id,
            details_url: currentCard.details_url || null,
            title: currentCard.title,
            price: currentCard.price || null,
            km: currentCard.km || null,
            year: currentCard.year || null,
            state: currentCard.state || null,
            badge: currentCard.badge || null,
            raw_snippet: currentCard.raw_snippet || currentCard.title,
          });
        }
      }
      
      // Start new card
      const title = titleMatch[1].replace(/[#*]/g, '').trim();
      const yearMatch = title.match(/\b(20[1-2]\d)\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
      
      // Extract badge
      let badge: string | null = null;
      const badges = ['WORKMATE', 'GXL', 'GX', 'VX', 'SAHARA', 'SR5'];
      for (const b of badges) {
        if (title.toUpperCase().includes(b)) {
          badge = b;
          break;
        }
      }
      
      currentCard = {
        title,
        year,
        badge,
        raw_snippet: title,
      };
      continue;
    }
    
    // If we have a current card, look for price/km/location
    if (currentCard) {
      // Price pattern
      const priceMatch = line.match(/\$\s*([\d,]+)/);
      if (priceMatch && !currentCard.price) {
        const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        if (price >= 5000 && price <= 500000) {
          currentCard.price = price;
          currentCard.raw_snippet = (currentCard.raw_snippet || '') + ' ' + line;
        }
      }
      
      // KM pattern
      const kmMatch = line.match(/([\d,]+)\s*(?:km|kms|kilometres)/i);
      if (kmMatch && !currentCard.km) {
        currentCard.km = parseInt(kmMatch[1].replace(/,/g, ''), 10);
        currentCard.raw_snippet = (currentCard.raw_snippet || '') + ' ' + line;
      }
      
      // State pattern
      const stateMatch = line.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
      if (stateMatch && !currentCard.state) {
        currentCard.state = stateMatch[1].toUpperCase();
        currentCard.raw_snippet = (currentCard.raw_snippet || '') + ' ' + line;
      }
      
      // Details URL pattern
      const urlMatch = line.match(/\[.*?\]\((https:\/\/www\.carsales\.com\.au[^)]*\/details\/[^)]+)\)/i) ||
                       line.match(/(https:\/\/www\.carsales\.com\.au[^\s]*\/details\/[^\s]+)/i);
      if (urlMatch && !currentCard.details_url) {
        currentCard.details_url = urlMatch[1];
        const listingId = extractCarsalesListingId(urlMatch[1]);
        if (listingId) {
          currentCard.external_id = `carsales-${listingId}`;
        }
      }
    }
  }
  
  // Don't forget last card
  if (currentCard && currentCard.title) {
    const id = currentCard.external_id || generateCarsalesCardId(
      currentCard.title,
      currentCard.price || null,
      currentCard.km || null,
      currentCard.state || null
    );
    if (!seen.has(id)) {
      seen.add(id);
      cards.push({
        external_id: id,
        details_url: currentCard.details_url || null,
        title: currentCard.title,
        price: currentCard.price || null,
        km: currentCard.km || null,
        year: currentCard.year || null,
        state: currentCard.state || null,
        badge: currentCard.badge || null,
        raw_snippet: currentCard.raw_snippet || currentCard.title,
      });
    }
  }
  
  // Also extract from details URLs we found
  for (const match of detailsUrls) {
    const url = match[1];
    const listingId = extractCarsalesListingId(url);
    if (listingId) {
      const id = `carsales-${listingId}`;
      if (!seen.has(id)) {
        seen.add(id);
        // Try to find title near this URL
        const urlIndex = content.indexOf(url);
        const contextStart = Math.max(0, urlIndex - 300);
        const contextEnd = Math.min(content.length, urlIndex + 100);
        const context = content.substring(contextStart, contextEnd);
        
        const titleMatch = context.match(/(20[1-2]\d\s+Toyota\s+Land\s*Cruiser[^|\n]*)/i);
        const priceMatch = context.match(/\$\s*([\d,]+)/);
        const kmMatch = context.match(/([\d,]+)\s*(?:km|kms)/i);
        const stateMatch = context.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
        
        cards.push({
          external_id: id,
          details_url: url,
          title: titleMatch ? titleMatch[1].trim() : `Toyota LandCruiser (ID: ${listingId})`,
          price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null,
          km: kmMatch ? parseInt(kmMatch[1].replace(/,/g, ''), 10) : null,
          year: null,
          state: stateMatch ? stateMatch[1].toUpperCase() : null,
          badge: null,
          raw_snippet: context.slice(0, 200),
        });
      }
    }
  }
  
  return cards;
}

// Scrape Carsales results page and extract individual listings
async function scrapeCarsalesResultsPage(
  resultsPageUrl: string,
  firecrawlKey: string,
  hunt: Hunt
): Promise<CarsalesListingCard[]> {
  console.log(`[CARSALES] Scraping results page: ${resultsPageUrl}`);
  
  try {
    const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: resultsPageUrl,
        formats: ["markdown", "html"],
        onlyMainContent: true,
        waitFor: 3000,  // Wait for JS to load
      }),
    });
    
    if (!scrapeRes.ok) {
      console.error(`[CARSALES] Scrape failed: ${scrapeRes.status}`);
      return [];
    }
    
    const scrapeData = await scrapeRes.json();
    const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';
    const html = scrapeData.data?.html || scrapeData.html || '';
    
    // Parse both markdown and HTML for maximum extraction
    const content = markdown + '\n' + html;
    const cards = parseCarsalesListingCards(content, resultsPageUrl);
    
    console.log(`[CARSALES] Extracted ${cards.length} listing cards from results page`);
    
    // Filter by year if specified
    if (hunt.year || hunt.year_min || hunt.year_max) {
      const yearMin = hunt.year_min ?? hunt.year ?? 2015;
      const yearMax = hunt.year_max ?? hunt.year ?? new Date().getFullYear();
      
      return cards.filter(card => {
        if (!card.year) return true;  // Keep cards without year (need verification)
        return card.year >= yearMin - 1 && card.year <= yearMax + 1;
      });
    }
    
    return cards;
  } catch (err) {
    console.error(`[CARSALES] Error scraping results page:`, err);
    return [];
  }
}

// =====================================================
// PICKLES RESULTS PAGE EXTRACTOR
// When we get a Pickles search/results page, scrape it
// and extract individual auction lot cards
// =====================================================

interface PicklesListingCard {
  external_id: string;  // Stock ID or hash
  details_url: string | null;
  title: string;
  price: number | null;
  km: number | null;
  year: number | null;
  state: string | null;
  badge: string | null;
  raw_snippet: string;
}

function isPicklesResultsPage(url: string): boolean {
  const lower = url.toLowerCase();
  // Results/search pages: /used/search/..., /search/lob/..., or general /used/ without item ID
  // Must be pickles.com.au AND contain search indicators OR be /used/ without detail patterns
  const isPickles = lower.includes('pickles.com.au');
  if (!isPickles) return false;
  
  // Explicit search page patterns
  const isSearchPage = lower.includes('/used/search/') || 
                       lower.includes('/search/lob/') ||
                       lower.includes('/search?') ||
                       lower.includes('/cars?') ||
                       (lower.includes('/used/') && lower.includes('toyota'));  // Generic used car search
  
  // Exclude individual detail pages (we want to extract cards from results, not re-process details)
  const isDetailPage = /\/(item|lot|details?)\/[a-z0-9-]{4,}/i.test(lower) ||
                       /\/cars\/item\//i.test(lower);
  
  return isSearchPage && !isDetailPage;
}

function isPicklesDetailsPage(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('pickles.com.au') && 
         (lower.includes('/item/') || lower.includes('/details/') || lower.includes('/lot/'));
}

// Extract stock ID from Pickles URL
function extractPicklesStockId(url: string): string | null {
  // Pattern: /item/stock-12345 or /details/toyota-rav4-12345
  const match = url.match(/\/(?:item|details|lot)\/([a-z0-9-]+)/i);
  return match ? match[1] : null;
}

// Parse Pickles listing cards from HTML/Markdown content
function parsePicklesListingCards(content: string, resultsPageUrl: string): PicklesListingCard[] {
  const cards: PicklesListingCard[] = [];
  const seen = new Set<string>();
  
  // Extract detail page URLs from content
  const detailsUrlPattern = /href=["']([^"']*pickles\.com\.au[^"']*\/(?:item|details|lot)\/[^"']+)["']/gi;
  const detailsUrls = Array.from(content.matchAll(detailsUrlPattern));
  
  // Also look for markdown links
  const mdLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]*pickles\.com\.au[^)]*\/(?:item|details|lot)\/[^)]+)\)/gi;
  const mdLinks = Array.from(content.matchAll(mdLinkPattern));
  
  // Process HTML/markdown links to detail pages
  for (const match of [...detailsUrls, ...mdLinks]) {
    const url = match[1] || match[2];
    const stockId = extractPicklesStockId(url);
    if (!stockId) continue;
    
    const id = `pickles-${stockId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    
    // Try to find context around this URL for title/price/km
    const urlIndex = content.indexOf(url);
    const contextStart = Math.max(0, urlIndex - 400);
    const contextEnd = Math.min(content.length, urlIndex + 200);
    const context = content.substring(contextStart, contextEnd);
    
    // Extract year
    const yearMatch = context.match(/\b(20[1-2]\d)\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    
    // Extract title (look for Toyota/vehicle patterns)
    const titleMatch = context.match(/(20[1-2]\d\s+)?(?:TOYOTA|Toyota)\s+[A-Z][a-zA-Z0-9\s-]+/i) ||
                       context.match(/([A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z0-9]+[^|\n]{0,40})/);
    const title = titleMatch ? titleMatch[0].trim() : `Pickles Lot (${stockId})`;
    
    // Extract price
    const priceMatch = context.match(/\$\s*([\d,]+)/);
    let price: number | null = null;
    if (priceMatch) {
      const parsed = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      if (parsed >= 3000 && parsed <= 500000) price = parsed;
    }
    
    // Extract KM
    const kmMatch = context.match(/([\d,]+)\s*(?:km|kms|kilometres|odometer)/i);
    const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, ''), 10) : null;
    
    // Extract state
    const stateMatch = context.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
    const state = stateMatch ? stateMatch[1].toUpperCase() : null;
    
    // Extract badge
    let badge: string | null = null;
    const badges = ['GX', 'GXL', 'CRUISER', 'EDGE', 'HYBRID', 'AWD'];
    for (const b of badges) {
      if (context.toUpperCase().includes(b)) {
        badge = b;
        break;
      }
    }
    
    cards.push({
      external_id: id,
      details_url: url,
      title,
      price,
      km,
      year,
      state,
      badge,
      raw_snippet: context.slice(0, 200),
    });
  }
  
  // Also try to parse structured listing blocks from content
  // Pickles often shows: "2021 Toyota RAV4 GX Hybrid | 45,000 km | SA | $38,500"
  const blockPattern = /(20[1-2]\d)\s+(Toyota|TOYOTA)\s+([A-Za-z0-9\s-]+?)(?:\s*\|\s*|\s+)([\d,]+)\s*km/gi;
  let blockMatch;
  while ((blockMatch = blockPattern.exec(content)) !== null) {
    const year = parseInt(blockMatch[1], 10);
    const model = blockMatch[3].trim();
    const km = parseInt(blockMatch[4].replace(/,/g, ''), 10);
    
    // Generate ID from content
    const blockHash = `${year}-${model}-${km}`.toLowerCase().replace(/\s+/g, '-');
    const id = `pickles-block-${blockHash}`;
    if (seen.has(id)) continue;
    seen.add(id);
    
    // Look for price nearby
    const priceMatch = content.substring(blockMatch.index, blockMatch.index + 150).match(/\$\s*([\d,]+)/);
    let price: number | null = null;
    if (priceMatch) {
      const parsed = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      if (parsed >= 3000 && parsed <= 500000) price = parsed;
    }
    
    // Look for state
    const stateMatch = content.substring(blockMatch.index, blockMatch.index + 100).match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
    const state = stateMatch ? stateMatch[1].toUpperCase() : null;
    
    cards.push({
      external_id: id,
      details_url: null,  // No direct URL, came from block parsing
      title: `${year} Toyota ${model}`,
      price,
      km,
      year,
      state,
      badge: null,
      raw_snippet: blockMatch[0],
    });
  }
  
  return cards;
}

// Scrape Pickles results page and extract individual listings
async function scrapePicklesResultsPage(
  resultsPageUrl: string,
  firecrawlKey: string,
  hunt: Hunt
): Promise<PicklesListingCard[]> {
  console.log(`[PICKLES] Scraping results page: ${resultsPageUrl}`);
  
  try {
    const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: resultsPageUrl,
        formats: ["markdown", "html"],
        onlyMainContent: true,
        waitFor: 5000,  // Wait for JS to load (Pickles is JS-heavy)
      }),
    });
    
    if (!scrapeRes.ok) {
      console.error(`[PICKLES] Scrape failed: ${scrapeRes.status}`);
      return [];
    }
    
    const scrapeData = await scrapeRes.json();
    const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';
    const html = scrapeData.data?.html || scrapeData.html || '';
    
    // Parse both markdown and HTML for maximum extraction
    const content = markdown + '\n' + html;
    const cards = parsePicklesListingCards(content, resultsPageUrl);
    
    console.log(`[PICKLES] Extracted ${cards.length} listing cards from results page`);
    
    // Filter by year with ±3 year tolerance for discovery (wider for auctions)
    if (hunt.year || hunt.year_min || hunt.year_max) {
      const yearMin = (hunt.year_min ?? hunt.year ?? 2015) - 3;  // ±3 year tolerance
      const yearMax = (hunt.year_max ?? hunt.year ?? new Date().getFullYear()) + 3;
      
      return cards.filter(card => {
        if (!card.year) return true;  // Keep cards without year (need verification)
        return card.year >= yearMin && card.year <= yearMax;
      });
    }
    
    return cards;
  } catch (err) {
    console.error(`[PICKLES] Error scraping results page:`, err);
    return [];
  }
}

/**
 * Outward Hunt v1.3 - Listing-Only + Cheapest-First + Scrape-to-Verify
 * 
 * Stage 1: Search the web for real vehicle listings
 * Stage 2: Queue verified listings for scrape verification
 * Stage 3: Rank by cheapest-first after verification
 * 
 * Flow:
 * 1. Build intelligent search queries with listing-intent tokens
 * 2. Run Firecrawl web search
 * 3. Classify URLs (listing vs article)
 * 4. Enqueue listings for scrape verification
 * 5. Let scrape-worker verify and rank by price
 */

interface Hunt {
  id: string;
  dealer_id: string;
  make: string;
  model: string;
  year: number;
  year_min: number | null;
  year_max: number | null;
  variant_family: string | null;
  series_family: string | null;
  engine_code: string | null;
  engine_family: string | null;
  body_type: string | null;
  cab_type: string | null;
  badge: string | null;
  km: number | null;
  proven_exit_value: number | null;
  min_gap_abs_buy: number;
  min_gap_pct_buy: number;
  min_gap_abs_watch: number;
  min_gap_pct_watch: number;
  must_have_tokens: string[] | null;
  must_have_mode: string | null;
}

interface IdKit {
  vin: string | null;
  rego: string | null;
  stock_no: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  badge: string | null;
  variant: string | null;
  km: number | null;
  price: number | null;
  location: string | null;
  state: string | null;
  colour: string | null;
  body: string | null;
  cab: string | null;
  engine: string | null;
  how_to_find: string;
  photo_clues: string[];
  search_string: string;
}

interface ExtractedCandidate {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  km: number | null;
  asking_price: number | null;
  location: string | null;
  engine_markers: string[];
  cab_markers: string[];
  confidence: 'high' | 'medium' | 'low';
  // Listing classification
  is_listing: boolean;
  listing_kind: 'retail_listing' | 'auction_lot' | 'dealer_stock' | 'unknown' | null;
  page_type: 'listing' | 'article' | 'search' | 'category' | 'login' | 'other';
  reject_reason: string | null;
  // ID Kit fields for blocked sources
  id_kit: IdKit;
  blocked_reason: string | null;
  requires_manual_check: boolean;
}

interface ClassificationResult {
  series_family: string | null;
  engine_family: string | null;
  body_type: string | null;
  cab_type: string | null;
  badge: string | null;
}

// Extract domain from URL
function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace('www.', '');
  } catch {
    return 'unknown';
  }
}

// =====================================================
// BLOCKED DOMAINS - never return results from these
// =====================================================
const JUNK_DOMAINS = [
  'youtube.com', 'youtu.be',
  'reddit.com', 'twitter.com', 'x.com',
  'facebook.com', // except marketplace which we handle separately
  'instagram.com', 'tiktok.com',
  'wikipedia.org', 'whirlpool.net.au',
  'caradvice.com.au', // editorial
  'motoring.com.au', // editorial
  'norweld.com.au', // accessory, not listings
  'arb.com.au', // accessory
  'ironman4x4.com', // accessory
];

function isJunkDomain(domain: string): boolean {
  return JUNK_DOMAINS.some(junk => domain.includes(junk));
}

// =====================================================
// URL PAGE-TYPE CLASSIFIER - Section C1 (ENHANCED v4)
// AGGRESSIVE rejection of search/category/spec/editorial pages
// Only accepts DETAIL pages with individual listing IDs
// =====================================================
function classifyUrlPageType(url: string, domain: string): { page_type: 'listing' | 'article' | 'search' | 'category' | 'login' | 'other'; reject_reason: string | null } {
  const urlLower = url.toLowerCase();
  
  // Block junk domains entirely
  if (isJunkDomain(domain)) {
    return { page_type: 'other', reject_reason: 'BLOCKED_DOMAIN' };
  }
  
  // GRAYS-SPECIFIC: Only accept /lot/ with numeric ID, reject everything else
  if (domain.includes('grays.com') && !/\/lot\/\d{4,}/.test(urlLower)) {
    return { page_type: 'search', reject_reason: 'GRAYS_SEARCH_OR_CATEGORY' };
  }
  
  // CRITICAL: Search/category/results page patterns - HARD REJECT
  const searchPatterns = [
    '/search', '/results', '/filter', '/browse', '/find-',
    '/cars/', '/vehicles/',
    '?make=', '?model=', '?year=', '?keyword=', '?q=', '&q=',
    '?sort=', '&sort=', '?page=', '&page=', '?offset=',
    '/category/', '/categories/', '/listings/', '/all-',
    '/used-cars?', '/pre-owned?', '/inventory?',
    'towing-capacity', 'specs', 'review', 'price-list',
  ];
  
  // DETAIL page patterns - must have individual listing ID (expanded for AU dealers + auctions)
  const detailPatterns = [
    /\/car\/\d{5,}/,              // Carsales detail: /car/123456
    /\/sse-ad-\d+/i,              // Carsales SSE-AD in URL
    /\/s-ad\/\d{6,}/,             // Gumtree ad: /s-ad/1234567890
    /\/lot\/\d{4,}/,              // Auction lot: /lot/12345
    /\/details?\/[a-z0-9-]+/i,    // Generic detail: /detail/abc-123
    /\/stock\/[a-z0-9-]+/i,       // Dealer stock: /stock/ABC123
    /\/vehicle\/[a-z0-9-]+/i,     // Vehicle page: /vehicle/abc-123
    /\/inventory\/[a-z0-9-]+/i,   // Inventory detail: /inventory/12345
    /\/listing\/[a-z0-9-]+/i,     // Listing page: /listing/abc-123
    /\/item\/[a-z0-9-]+/i,        // Item page: /item/12345
    /\/ad\/[a-z0-9-]+/i,          // Dealer ad page: /ad/12345 or /ad/hyundai-i30
    /\/product\/[a-z0-9-]+/i,     // Product page: /product/hyundai-i30-n-line
    /\/view\/[a-z0-9-]+/i,        // View page: /view/ABC123
    /\/car-details\/[a-z0-9-]+/i, // Car details: /car-details/abc-123
    /\/view-car\/[a-z0-9-]+/i,    // View car: /view-car/ABC123
    /\/showroom\/[a-z0-9-]+/i,    // Showroom: /showroom/12345
    /\/used-car\/[a-z0-9-]+/i,    // Used car: /used-car/abc-123
    /\/used-cars\/[a-z0-9-]+/i,   // Used cars detail: /used-cars/abc-123
    /\/pre-owned\/[a-z0-9-]+/i,   // Pre-owned: /pre-owned/abc-123
    /SSE-AD-\d+/i,                // Carsales SSE-AD-xxxxx
    /OAG-AD-\d+/i,                // AutoTrader OAG-AD-xxxxx
    // === AUCTION-SPECIFIC PATTERNS ===
    /\/cars\/item\/[a-z0-9-]+/i,  // Pickles: /cars/item/12345
    /\/used\/details\/[a-z0-9-]+/i, // Pickles: /used/details/12345
    /\/vehicle\/\d+/i,            // Manheim: /vehicle/123456
    /\/auction\/lot\/\d+/i,       // Lloyd's: /auction/lot/12345
    /\/lots\/\d+/i,               // Grays/General: /lots/12345
  ];
  
  const isDetailPage = detailPatterns.some(p => p.test(urlLower));
  const isSearchPage = searchPatterns.some(p => urlLower.includes(p));
  
  // If it matches search pattern but NOT a detail page -> REJECT
  if (isSearchPage && !isDetailPage) {
    return { page_type: 'search', reject_reason: 'SEARCH_OR_CATEGORY_PAGE' };
  }
  
  // Non-listing URL patterns - reject these (EXPANDED junk list)
  const articlePatterns = [
    '/news/', '/blog/', '/article/', '/review/', '/reviews/', '/guide/', '/guides/',
    '/car-guide/', '/price-and-specs/', '/compare/', '/comparison/', '/insurance/',
    '/finance/', '/about/', '/help/', '/contact/', '/privacy/', '/terms/',
    '/login/', '/signin/', '/signup/', '/register/',
    '/faq/', '/sitemap/', '/media/', '/press/', '/stories/', '/features/',
    '/insights/', '/resources/', '/tips/', '/how-to/', '/what-is/',
    '/best-', '/top-', '/vs-', '/advice/', '/editorial/',
    '/canopies/', '/ute-canopies/', '/ute-trays/',
    '/buying-guide/', '/ownership/', '/expert-reviews/',
    '/car-news/', '/news-and-reviews/', '/new-car/',
    '/prices/', '/pricing/', '/specifications/',
    '/warranty/', '/service/', '/parts/', '/accessories/',
  ];
  
  for (const pattern of articlePatterns) {
    if (urlLower.includes(pattern)) {
      const type = pattern.includes('login') || pattern.includes('signin') ? 'login' : 'article';
      return { page_type: type, reject_reason: 'NON_LISTING_JUNK_PAGE' };
    }
  }
  
  return { page_type: 'other', reject_reason: null };
}

// =====================================================
// CONTENT SIGNALS CHECK v3 - Relaxed + Junk Filter
// =====================================================
function hasListingSignals(content: string): { valid: boolean; reason: string | null } {
  const contentLower = content.toLowerCase();

  // Primary signals: price OR mileage
  const hasPrice = contentLower.includes('$') || /\d{2,3},\d{3}/.test(contentLower);
  const hasKm = /\d{1,3}(,\d{3})*\s*(km|kms|kilometres|odometer)/i.test(contentLower);
  
  // Secondary signal: enquire/contact (many dealer pages hide price)
  const hasEnquire = /enquire|contact\s*dealer|call|inquire|dm|message|get\s*quote|request\s*(info|price)/i.test(contentLower);

  // Block junk signals (common in footers/menus/spec pages)
  const isJunk = /download|brochure|park assist|usb|bluetooth|airbag|manual|features|specs|guide|csv|pdf/i.test(contentLower);

  // Rule: If junk words present without price AND km, reject as static junk
  if (isJunk && !hasPrice && !hasKm) {
    return { valid: false, reason: 'STATIC_JUNK_NO_SIGNALS' };
  }
  
  // Relaxed: price OR km OR enquire signal (dealer pages often hide price)
  if (hasPrice || hasKm || hasEnquire) {
    return { valid: true, reason: null };
  }

  return { valid: false, reason: 'INSUFFICIENT_LISTING_SIGNALS' };
}

// =====================================================
// LISTING ACCEPT PATTERNS - Section C2
// =====================================================
function isVerifiedListingUrl(url: string, domain: string): { is_listing: boolean; listing_kind: 'retail_listing' | 'auction_lot' | 'dealer_stock' | 'unknown' | null } {
  const urlLower = url.toLowerCase();
  
  // Gumtree - classified ads
  if (domain.includes('gumtree.com.au') && urlLower.includes('/s-ad/')) {
    return { is_listing: true, listing_kind: 'retail_listing' };
  }
  
  // Autotrader AU - STRICT: car listings with numeric ID only, reject spec/towing pages
  if (domain.includes('autotrader.com.au')) {
    // Reject spec/towing/capacity pages
    if (/\/(towing|specs|specifications|capacity|price)/.test(urlLower)) {
      return { is_listing: false, listing_kind: null };
    }
    // Accept /car/ or /detail/ with ID
    if (/\/(car|detail)\/[a-z0-9-]{6,}/i.test(urlLower)) {
      return { is_listing: true, listing_kind: 'retail_listing' };
    }
    return { is_listing: false, listing_kind: null };
  }
  
  // Drive - classified listings (car detail pages with numeric IDs)
  if (domain.includes('drive.com.au') && urlLower.includes('/cars-for-sale/')) {
    // Match /cars-for-sale/car/123456 pattern
    if (/\/cars-for-sale\/car\/\d+/.test(urlLower)) {
      return { is_listing: true, listing_kind: 'retail_listing' };
    }
    // Match dealer or private listings
    if (urlLower.includes('/dealer-') || urlLower.includes('/private-')) {
      return { is_listing: true, listing_kind: 'dealer_stock' };
    }
  }
  
  // Carsales - listing pages
  if (domain.includes('carsales.com.au') && (urlLower.includes('/cars/') || urlLower.includes('/car-details/'))) {
    return { is_listing: true, listing_kind: 'retail_listing' };
  }
  
  // CarsForSale.com.au - detail pages
  if (domain.includes('carsforsale.com.au') && urlLower.includes('/cars/details/')) {
    return { is_listing: true, listing_kind: 'retail_listing' };
  }
  
  // Pickles - auction lots (individual lot pages - multiple URL patterns)
  if (domain.includes('pickles.com.au')) {
    // Match various Pickles detail page patterns:
    // /lots/123456, /item/123456, /cars/item/abc-123, /used/details/abc-123
    if (/\/(lots?|item|details?)\/[a-z0-9-]{4,}/i.test(urlLower)) {
      return { is_listing: true, listing_kind: 'auction_lot' };
    }
    // Match /cars/item/... pattern (Pickles current format)
    if (/\/cars\/item\/[a-z0-9-]+/i.test(urlLower)) {
      return { is_listing: true, listing_kind: 'auction_lot' };
    }
    // Match /used/details/... pattern
    if (/\/used\/details\/[a-z0-9-]+/i.test(urlLower)) {
      return { is_listing: true, listing_kind: 'auction_lot' };
    }
    // Reject generic /products/ and /used/search pages
    return { is_listing: false, listing_kind: null };
  }
  
  // Manheim - auction lots (require specific lot/vehicle ID patterns)
  if (domain.includes('manheim.com.au')) {
    if (/\/(lot|vehicle)\/[a-z0-9-]{6,}/i.test(urlLower)) {
      return { is_listing: true, listing_kind: 'auction_lot' };
    }
    return { is_listing: false, listing_kind: null };
  }
  
  // Lloyds Auctions (require lot/item ID)
  if (domain.includes('lloydsauctions.com.au')) {
    if (/\/(lot|item|auction)\/\d{4,}/.test(urlLower)) {
      return { is_listing: true, listing_kind: 'auction_lot' };
    }
    return { is_listing: false, listing_kind: null };
  }
  
  // Grays - STRICT: Only accept /lot/ with numeric ID, reject /items/ and /products/
  if (domain.includes('grays.com')) {
    // Only accept /lot/123456 pattern (individual auction lots)
    if (/\/lot\/\d{4,}/.test(urlLower)) {
      return { is_listing: true, listing_kind: 'auction_lot' };
    }
    // Reject /items/, /products/, /auctions/ which are search/category pages
    return { is_listing: false, listing_kind: null };
  }
  
  // Facebook Marketplace - individual item pages only
  if (domain.includes('facebook.com') && urlLower.includes('/marketplace/item/')) {
    return { is_listing: true, listing_kind: 'retail_listing' };
  }
  
  // Toyota dealer sites - vehicle inventory detail pages
  if (domain.includes('toyota.com.au') || domain.includes('toyota')) {
    if (urlLower.includes('/vehicle-inventory/details/') || urlLower.includes('/used-vehicle/')) {
      return { is_listing: true, listing_kind: 'dealer_stock' };
    }
  }
  
  // Generic dealer sites - check for listing patterns with IDs
  const dealerPatterns = [
    /\/stock\/[a-z0-9-]+/i,
    /\/inventory\/[a-z0-9-]+/i,
    /\/vehicles?\/[a-z0-9-]+/i,
    /\/vehicle-inventory\/details\/[a-z0-9-]+/i,
    /\/used-vehicle\/[a-z0-9-]+/i,
    /\/car\/[a-z0-9-]+/i,
  ];
  
  for (const pattern of dealerPatterns) {
    if (pattern.test(urlLower)) {
      return { is_listing: true, listing_kind: 'dealer_stock' };
    }
  }
  
  // Default - not confirmed as listing
  return { is_listing: false, listing_kind: null };
}

// Sites that block direct access
const BLOCKED_DOMAINS = ['carsales.com.au', 'carsales.com'];

// Auction domains get higher priority
const AUCTION_DOMAINS = ['pickles.com.au', 'manheim.com.au', 'grays.com', 'lloydsauctions.com.au'];

// Classify candidate based on text analysis
// =====================================================
// SERIES FAMILY DETECTION - Comprehensive LC70/LC300 signals
// =====================================================

// LC70 positive markers (VDJ7x/GDJ7x engines, body codes, trim names)
const LC70_POSITIVE_SIGNALS = [
  // Model codes
  'LC70', 'LC76', 'LC78', 'LC79', 'LC 70', 'LC 76', 'LC 78', 'LC 79',
  // Series names
  '70 SERIES', '76 SERIES', '78 SERIES', '79 SERIES', '70-SERIES', '76-SERIES', '78-SERIES', '79-SERIES',
  '70SERIES', '76SERIES', '78SERIES', '79SERIES',
  // Engine codes (VDJ = V8 diesel, GDJ = 2.8 diesel, GRJ = V6 petrol)
  'VDJ76', 'VDJ78', 'VDJ79', 'GDJ76', 'GDJ78', 'GDJ79', 'GRJ76', 'GRJ78', 'GRJ79',
  'VDJ7', 'GDJ7', 'GRJ7', // Broader engine family prefixes
  // Legacy engine codes
  'HZJ7', 'FZJ7', 'FJ7',
  // Body variants unique to 70 series
  'TROOPCARRIER', 'TROOPY', 'TROOP CARRIER',
  // URL slugs
  '/LC79/', '/LC78/', '/LC76/', '/LC70/', '/70-SERIES/', '/79-SERIES/',
  'LANDCRUISER-70', 'LANDCRUISER-79', 'LAND-CRUISER-70', 'LAND-CRUISER-79',
];

// LC300 positive markers
const LC300_POSITIVE_SIGNALS = [
  // Model codes
  'LC300', 'LC 300', 'LC-300',
  // Series names
  '300 SERIES', '300-SERIES', '300SERIES',
  // Engine codes (FJA300 = V6 twin turbo diesel, VJA300 = V6 twin turbo petrol)
  'FJA300', 'VJA300',
  // Exclusive trims
  'GR SPORT', 'GR-SPORT', 'GRSPORT',
  // URL slugs
  '/LC300/', '/300-SERIES/', 'LANDCRUISER-300', 'LAND-CRUISER-300',
];

// LC200 positive markers
const LC200_POSITIVE_SIGNALS = [
  'LC200', 'LC 200', 'LC-200',
  '200 SERIES', '200-SERIES', '200SERIES',
  'URJ200', 'VDJ200', 'UZJ200',
  '/LC200/', '/200-SERIES/', 'LANDCRUISER-200', 'LAND-CRUISER-200',
];

function detectSeriesFamily(text: string, url?: string): { series: string | null; confidence: 'high' | 'medium' | 'low' } {
  const upper = text.toUpperCase();
  const urlUpper = (url || '').toUpperCase();
  const combined = upper + ' ' + urlUpper;
  
  // Count positive signals
  let lc70Score = 0;
  let lc300Score = 0;
  let lc200Score = 0;
  
  for (const signal of LC70_POSITIVE_SIGNALS) {
    if (combined.includes(signal)) lc70Score++;
  }
  for (const signal of LC300_POSITIVE_SIGNALS) {
    if (combined.includes(signal)) lc300Score++;
  }
  for (const signal of LC200_POSITIVE_SIGNALS) {
    if (combined.includes(signal)) lc200Score++;
  }
  
  // High confidence = 2+ signals
  // Medium confidence = 1 signal
  // Low confidence = 0 signals
  const maxScore = Math.max(lc70Score, lc300Score, lc200Score);
  const confidence: 'high' | 'medium' | 'low' = maxScore >= 2 ? 'high' : maxScore === 1 ? 'medium' : 'low';
  
  if (maxScore === 0) return { series: null, confidence: 'low' };
  
  // Check for collisions (text mentions multiple series)
  const seriesCount = [lc70Score, lc300Score, lc200Score].filter(s => s > 0).length;
  if (seriesCount > 1) {
    // Ambiguous - could be a comparison page or umbrella listing
    // Use highest score as winner
    if (lc300Score > lc70Score && lc300Score > lc200Score) return { series: 'LC300', confidence: 'medium' };
    if (lc200Score > lc70Score && lc200Score > lc300Score) return { series: 'LC200', confidence: 'medium' };
    if (lc70Score > 0) return { series: 'LC70', confidence: 'medium' };
  }
  
  if (lc70Score > 0) return { series: 'LC70', confidence };
  if (lc300Score > 0) return { series: 'LC300', confidence };
  if (lc200Score > 0) return { series: 'LC200', confidence };
  
  return { series: null, confidence: 'low' };
}

function classifyCandidate(text: string, hunt: Hunt, url?: string): ClassificationResult {
  const upper = text.toUpperCase();
  
  const result: ClassificationResult = {
    series_family: null,
    engine_family: null,
    body_type: null,
    cab_type: null,
    badge: null,
  };
  
  // Series family detection (using comprehensive signals)
  const seriesResult = detectSeriesFamily(text, url);
  result.series_family = seriesResult.series;
  
  // Engine family detection
  if (upper.includes('VDJ') || upper.includes('V8 DIESEL') || upper.includes('4.5L DIESEL') || upper.includes('4.5 DIESEL') || upper.includes('4.5 V8')) {
    result.engine_family = 'V8_DIESEL';
  } else if (upper.includes('GDJ') || upper.includes('2.8L') || upper.includes('2.8 DIESEL') || upper.includes('4CYL DIESEL') || upper.includes('4 CYL DIESEL') || upper.includes('2.8L TURBO')) {
    result.engine_family = 'I4_DIESEL';
  } else if (upper.includes('V6 PETROL') || upper.includes('4.0L PETROL') || upper.includes('GRJ') || upper.includes('4.0 PETROL')) {
    result.engine_family = 'V6_PETROL';
  } else if (upper.includes('TWIN TURBO') || upper.includes('3.3L DIESEL') || upper.includes('3.3 DIESEL') || upper.includes('3.3L TURBO')) {
    result.engine_family = 'V6_DIESEL_TT';
  }
  
  // Cab type detection
  if (upper.includes('DUAL CAB') || upper.includes('DOUBLE CAB') || upper.includes('D/CAB') || upper.includes('DUALCAB')) {
    result.cab_type = 'DUAL';
  } else if (upper.includes('SINGLE CAB') || upper.includes('S/CAB') || upper.includes('SINGLECAB')) {
    result.cab_type = 'SINGLE';
  } else if (upper.includes('EXTRA CAB') || upper.includes('KING CAB') || upper.includes('SPACE CAB')) {
    result.cab_type = 'EXTRA';
  }
  
  // Body type detection
  if (upper.includes('CAB CHASSIS') || upper.includes('TRAY') || upper.includes('UTE') || upper.includes('CAB-CHASSIS')) {
    result.body_type = 'CAB_CHASSIS';
  } else if (upper.includes('WAGON') || upper.includes('SUV') || upper.includes('TROOPCARRIER') || upper.includes('TROOPY')) {
    result.body_type = 'WAGON';
  }
  
  // Badge detection
  const badges = ['WORKMATE', 'GXL', 'GX', 'VX', 'SAHARA', 'SR5', 'SR', 'WILDTRAK', 'XLT', 'ROGUE', 'RUGGED'];
  for (const badge of badges) {
    if (upper.includes(badge)) {
      result.badge = badge;
      break;
    }
  }
  
  return result;
}

// Apply hard gates - returns reject reasons or empty array if passes
// Also returns allowWatch = false if candidate should be fully rejected (not even WATCH)
interface HardGateResult {
  rejectReasons: string[];
  allowWatch: boolean;  // If false, candidate should be IGNORED entirely
}

function applyHardGates(
  classification: ClassificationResult,
  hunt: Hunt,
  candidateText: string,
  url?: string
): HardGateResult {
  const rejectReasons: string[] = [];
  let allowWatch = true;
  
  // =====================================================
  // SERIES FAMILY - Hard gate with positive marker requirement
  // Rule: If hunt has series_family, candidate MUST:
  //   1. Match that series (if detected), OR
  //   2. Have no detected series (unknown) - can WATCH only
  // If candidate is detected as a DIFFERENT series -> REJECT entirely
  // =====================================================
  if (hunt.series_family) {
    // Re-run series detection with URL for better accuracy
    const seriesCheck = detectSeriesFamily(candidateText, url);
    
    if (seriesCheck.series !== null && seriesCheck.series !== hunt.series_family) {
      // Detected as DIFFERENT series - HARD REJECT, no WATCH allowed
      rejectReasons.push(`SERIES_MISMATCH:${seriesCheck.series}`);
      allowWatch = false; // Critical: don't even allow WATCH for series mismatch
      console.log(`[HARD_REJECT] Series mismatch: hunt=${hunt.series_family}, detected=${seriesCheck.series}`);
    } else if (seriesCheck.series === null) {
      // Unknown series - allow WATCH but not BUY until verified
      rejectReasons.push('SERIES_UNKNOWN_NEEDS_VERIFY');
      // allowWatch stays true - can still WATCH
    }
    // If series matches exactly, no reject reason added
  }
  
  // Engine mismatch (critical for LC79) - Hard reject
  if (hunt.engine_family && classification.engine_family &&
      hunt.engine_family !== classification.engine_family) {
    rejectReasons.push(`ENGINE_MISMATCH:${classification.engine_family}`);
    allowWatch = false; // Engine mismatch is also a hard reject
  }
  
  // Cab type mismatch - Hard reject
  if (hunt.cab_type && classification.cab_type &&
      hunt.cab_type !== classification.cab_type) {
    rejectReasons.push(`CAB_MISMATCH:${classification.cab_type}`);
    allowWatch = false;
  }
  
  // Body type mismatch - Hard reject
  if (hunt.body_type && classification.body_type &&
      hunt.body_type !== classification.body_type) {
    rejectReasons.push(`BODY_MISMATCH:${classification.body_type}`);
    allowWatch = false;
  }
  
  // Must-have tokens (strict mode)
  if (hunt.must_have_mode === 'strict' && hunt.must_have_tokens && hunt.must_have_tokens.length > 0) {
    const upper = candidateText.toUpperCase();
    for (const token of hunt.must_have_tokens) {
      if (!upper.includes(token.toUpperCase())) {
        rejectReasons.push(`MISSING_REQUIRED_TOKEN:${token}`);
        // Allow WATCH for missing tokens (soft gate)
      }
    }
  }
  
  return { rejectReasons, allowWatch };
}

// Extract VIN from text (17 character alphanumeric, no I/O/Q)
function extractVin(text: string): string | null {
  const vinMatch = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i);
  return vinMatch ? vinMatch[0].toUpperCase() : null;
}

// Extract Australian registration plate from text
function extractRego(text: string): string | null {
  const regoPatterns = [
    /(?:rego|registration|plate)[:\s]*([A-Z0-9]{1,3}[\s-]?[A-Z0-9]{2,4})/i,
    /\b([A-Z]{2,3}[\s-]?[0-9]{2,3}[\s-]?[A-Z0-9]{0,3})\b/i,
    /\b([0-9]{1,3}[\s-]?[A-Z]{2,3}[\s-]?[0-9]{0,3})\b/i,
  ];
  
  for (const pattern of regoPatterns) {
    const match = text.match(pattern);
    if (match) {
      const rego = match[1].replace(/[\s-]/g, '').toUpperCase();
      if (rego.length >= 4 && rego.length <= 7 && /^[A-Z0-9]+$/.test(rego)) {
        return rego;
      }
    }
  }
  return null;
}

// Extract stock number from text
function extractStockNo(text: string): string | null {
  const stockPatterns = [
    /(?:stock\s*(?:no|number|#|id))[:\s]*([A-Z0-9-]+)/i,
    /(?:stk)[:\s]*([A-Z0-9-]+)/i,
  ];
  
  for (const pattern of stockPatterns) {
    const match = text.match(pattern);
    if (match && match[1].length >= 3 && match[1].length <= 20) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

// Extract location/state from text
function extractLocation(text: string): { location: string | null; state: string | null } {
  const states = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
  const stateMatch = text.match(new RegExp(`\\b(${states.join('|')})\\b`, 'i'));
  const state = stateMatch ? stateMatch[1].toUpperCase() : null;
  
  const locationPatterns = [
    /(?:located?\s*(?:in|at)?|location)[:\s]*([A-Za-z\s]+?)(?:,|\s+(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT))/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i,
  ];
  
  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match) {
      const loc = match[1].trim();
      if (loc.length >= 3 && loc.length <= 30) {
        return { location: loc, state };
      }
    }
  }
  
  return { location: null, state };
}

// Extract colour from text
function extractColour(text: string): string | null {
  const colours = ['white', 'black', 'silver', 'grey', 'gray', 'blue', 'red', 'green', 
                   'bronze', 'gold', 'brown', 'beige', 'orange', 'yellow', 'burgundy'];
  for (const colour of colours) {
    if (text.toLowerCase().includes(colour)) {
      return colour.charAt(0).toUpperCase() + colour.slice(1);
    }
  }
  return null;
}

// Extract photo clues from text
function extractPhotoClues(text: string): string[] {
  const clues: string[] = [];
  const textUpper = text.toUpperCase();
  
  if (/NORWELD/i.test(text)) clues.push('Norweld tray');
  if (/BULLBAR|BULL\s*BAR/i.test(text)) clues.push('Bullbar');
  if (/SNORKEL/i.test(text)) clues.push('Snorkel');
  if (/WINCH/i.test(text)) clues.push('Winch');
  if (/CANOPY/i.test(text)) clues.push('Canopy');
  if (/TRAY/i.test(text)) clues.push('Tray');
  if (/TOOLBOX/i.test(text)) clues.push('Toolbox');
  if (/ROOF\s*RACK/i.test(text)) clues.push('Roof rack');
  if (/LIFT\s*KIT|LIFTED/i.test(text)) clues.push('Lifted');
  
  if (textUpper.includes('DUAL CAB')) clues.push('Dual cab');
  if (textUpper.includes('SINGLE CAB')) clues.push('Single cab');
  if (textUpper.includes('UTE')) clues.push('Ute');
  if (textUpper.includes('WAGON')) clues.push('Wagon');
  
  const colour = extractColour(text);
  if (colour) clues.push(colour);
  
  return clues;
}

// Check title for editorial indicators
function isEditorialTitle(title: string): boolean {
  const titleLower = title.toLowerCase();
  const editorialIndicators = [
    'price and specs', 'review:', 'first drive', 'best used cars',
    'buying guide', 'comparison test', 'vs ', ' vs.', 'what to know',
    'everything you need', 'full review', 'test drive', 'road test',
    'how to buy', 'things to know', 'should you buy', 'news:',
    'revealed:', 'updated:', 'new model', 'facelift', 'upgrade',
  ];
  return editorialIndicators.some(indicator => titleLower.includes(indicator));
}

// Extract candidate data from search result
function extractCandidate(
  result: { url: string; title?: string; description?: string; markdown?: string },
  hunt: Hunt
): ExtractedCandidate | null {
  const url = result.url;
  const title = result.title || '';
  const snippet = result.description || result.markdown?.slice(0, 500) || '';
  const fullText = `${title} ${snippet}`;
  const domain = extractDomain(url);
  
  // Step 1: URL page-type classification
  const { page_type, reject_reason: urlRejectReason } = classifyUrlPageType(url, domain);
  
  // Step 2: Check if verified listing URL
  const { is_listing, listing_kind } = isVerifiedListingUrl(url, domain);
  
  // Step 3: Title editorial check
  if (isEditorialTitle(title)) {
    console.log(`Skipping editorial: ${title.slice(0, 60)}...`);
    return {
      url,
      domain,
      title: title.slice(0, 200),
      snippet: snippet.slice(0, 500),
      year: null,
      make: null,
      model: null,
      variant_raw: null,
      km: null,
      asking_price: null,
      location: null,
      engine_markers: [],
      cab_markers: [],
      confidence: 'low',
      is_listing: false,
      listing_kind: null,
      page_type: 'article',
      reject_reason: 'EDITORIAL_CONTENT',
      id_kit: {
        vin: null, rego: null, stock_no: null, year: null, make: null, model: null,
        badge: null, variant: null, km: null, price: null, location: null, state: null,
        colour: null, body: null, cab: null, engine: null, how_to_find: 'N/A',
        photo_clues: [], search_string: '',
      },
      blocked_reason: null,
      requires_manual_check: false,
    };
  }
  
  // If URL is non-listing, mark it but still return for logging
  const finalRejectReason = urlRejectReason || (page_type === 'article' ? 'ARTICLE_PAGE' : null);
  
  const isBlocked = BLOCKED_DOMAINS.some(d => domain.includes(d));
  
  // Extract year
  const yearMatch = fullText.match(/\b(20[1-2][0-9])\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  
  // STRICT YEAR GATE
  const huntYearMin = hunt.year_min ?? hunt.year;
  const huntYearMax = hunt.year_max ?? hunt.year;
  
  if (year) {
    if (year < huntYearMin - 1 || year > huntYearMax + 1) {
      console.log(`Year mismatch: found ${year}, hunt range ${huntYearMin}-${huntYearMax}`);
      return null;
    }
  }
  
  // Check if make/model mentioned
  const textLower = fullText.toLowerCase();
  const huntMakeLower = hunt.make.toLowerCase();
  const huntModelLower = hunt.model.toLowerCase();
  
  if (!textLower.includes(huntMakeLower) && !textLower.includes(huntModelLower)) {
    return null;
  }
  
  // Exclude Prado if hunting LandCruiser
  if (huntModelLower === 'landcruiser') {
    if (textLower.includes('prado') || textLower.includes('land cruiser prado')) {
      return null;
    }
  }
  if (huntModelLower === 'prado' || huntModelLower === 'landcruiser prado') {
    if (!textLower.includes('prado')) {
      return null;
    }
  }
  
  // Extract price
  const priceMatch = fullText.match(/\$\s*([\d,]+)/);
  let asking_price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
  
  if (asking_price && (asking_price < 5000 || asking_price > 500000)) {
    asking_price = null;
  }
  
  // Extract km
  const kmMatch = fullText.match(/([\d,]+)\s*k?m/i);
  const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, ''), 10) : null;
  
  // Engine markers
  const engineMarkers: string[] = [];
  if (/V8|VDJ|4\.5L/i.test(fullText)) engineMarkers.push('V8');
  if (/2\.8L?|GDJ|4CYL/i.test(fullText)) engineMarkers.push('4CYL');
  if (/V6|GRJ|4\.0L/i.test(fullText)) engineMarkers.push('V6');
  
  // Cab markers
  const cabMarkers: string[] = [];
  if (/DUAL\s*CAB|DOUBLE\s*CAB|D\/CAB/i.test(fullText)) cabMarkers.push('DUAL');
  if (/SINGLE\s*CAB|S\/CAB/i.test(fullText)) cabMarkers.push('SINGLE');
  
  // Confidence scoring
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (year && asking_price && textLower.includes(huntMakeLower) && textLower.includes(huntModelLower)) {
    confidence = 'high';
  } else if ((year || asking_price) && (textLower.includes(huntMakeLower) || textLower.includes(huntModelLower))) {
    confidence = 'medium';
  }
  
  // Extract ID Kit fields
  const vin = extractVin(fullText);
  const rego = extractRego(fullText);
  const stock_no = extractStockNo(fullText);
  const { location, state } = extractLocation(fullText);
  const colour = extractColour(fullText);
  const photo_clues = extractPhotoClues(fullText);
  
  // Detect badge
  const badges = ['WORKMATE', 'GXL', 'GX', 'VX', 'SAHARA', 'SR5', 'SR', 'WILDTRAK', 'XLT', 'ROGUE', 'RUGGED'];
  let badge: string | null = null;
  for (const b of badges) {
    if (fullText.toUpperCase().includes(b)) {
      badge = b;
      break;
    }
  }
  
  // Detect body/cab
  let body: string | null = null;
  if (fullText.toUpperCase().includes('CAB CHASSIS') || fullText.toUpperCase().includes('TRAY') || fullText.toUpperCase().includes('UTE')) {
    body = 'CAB_CHASSIS';
  } else if (fullText.toUpperCase().includes('WAGON') || fullText.toUpperCase().includes('SUV')) {
    body = 'WAGON';
  }
  
  const cab: string | null = cabMarkers[0] || null;
  
  // Build search string
  const searchParts: string[] = [];
  if (year) searchParts.push(String(year));
  if (hunt.make) searchParts.push(hunt.make);
  if (hunt.model) searchParts.push(hunt.model);
  if (badge) searchParts.push(badge);
  if (km) searchParts.push(`${km.toLocaleString()}km`);
  if (location) searchParts.push(location);
  if (state) searchParts.push(state);
  
  const id_kit: IdKit = {
    vin,
    rego,
    stock_no,
    year,
    make: textLower.includes(huntMakeLower) ? hunt.make : null,
    model: textLower.includes(huntModelLower) ? hunt.model : null,
    badge,
    variant: null,
    km,
    price: asking_price,
    location,
    state,
    colour,
    body,
    cab,
    engine: engineMarkers[0] || null,
    how_to_find: vin ? 'Search by VIN' : rego ? 'Search by Rego' : 'Search by filters',
    photo_clues,
    search_string: searchParts.join(' '),
  };
  
  return {
    url,
    domain,
    title: title.slice(0, 200),
    snippet: snippet.slice(0, 500),
    year,
    make: textLower.includes(huntMakeLower) ? hunt.make : null,
    model: textLower.includes(huntModelLower) ? hunt.model : null,
    variant_raw: null,
    km,
    asking_price,
    location,
    engine_markers: engineMarkers,
    cab_markers: cabMarkers,
    confidence,
    is_listing,
    listing_kind,
    page_type,
    reject_reason: finalRejectReason,
    id_kit,
    blocked_reason: isBlocked ? 'anti-scraping' : null,
    requires_manual_check: isBlocked,
  };
}

// Score candidate and determine decision
function scoreAndDecide(
  candidate: ExtractedCandidate,
  classification: ClassificationResult,
  hunt: Hunt
): { score: number; decision: 'BUY' | 'WATCH' | 'IGNORE'; reasons: string[] } {
  let score = 5.0;
  const reasons: string[] = [];
  
  // Year match
  if (candidate.year) {
    if (candidate.year === hunt.year) {
      score += 1.5;
      reasons.push('exact_year_match');
    } else if (Math.abs(candidate.year - hunt.year) === 1) {
      score += 0.5;
      reasons.push('adjacent_year');
    }
  }
  
  // Make/model match
  if (candidate.make?.toUpperCase() === hunt.make.toUpperCase()) score += 1.0;
  if (candidate.model?.toUpperCase() === hunt.model.toUpperCase()) score += 1.0;
  
  // Classification matches
  if (classification.series_family === hunt.series_family) {
    score += 0.5;
    reasons.push('series_match');
  }
  if (classification.engine_family === hunt.engine_family) {
    score += 0.5;
    reasons.push('engine_match');
  }
  
  // Price gap calculation
  let gap_dollars = 0;
  let gap_pct = 0;
  
  if (candidate.asking_price && hunt.proven_exit_value) {
    gap_dollars = hunt.proven_exit_value - candidate.asking_price;
    gap_pct = (gap_dollars / hunt.proven_exit_value) * 100;
    
    if (gap_pct >= 10) {
      score += 1.5;
      reasons.push(`gap_${gap_pct.toFixed(0)}pct`);
    } else if (gap_pct >= 5) {
      score += 1.0;
      reasons.push(`gap_${gap_pct.toFixed(0)}pct`);
    } else if (gap_pct >= 0) {
      score += 0.5;
    } else {
      score -= 1.0;
      reasons.push('overpriced');
    }
  }
  
  // Confidence boost
  if (candidate.confidence === 'high') {
    score += 0.5;
    reasons.push('high_confidence');
  }
  
  // Source boost for auctions
  if (AUCTION_DOMAINS.some(d => candidate.domain.includes(d))) {
    score += 0.5;
    reasons.push('auction_source');
  }
  
  // is_listing boost
  if (candidate.is_listing) {
    score += 1.0;
    reasons.push('verified_listing');
  }
  
  // Cap score
  score = Math.min(10, Math.max(0, score));
  
  // Decision logic
  // For non-listings, can only be IGNORE
  if (!candidate.is_listing) {
    return { score, decision: 'IGNORE', reasons: [...reasons, 'not_verified_listing'] };
  }
  
  const canBuy = 
    score >= 7.0 &&
    gap_dollars >= hunt.min_gap_abs_buy &&
    gap_pct >= hunt.min_gap_pct_buy &&
    candidate.confidence !== 'low';
  
  const canWatch = score >= 5.0;
  
  if (canBuy) return { score, decision: 'BUY', reasons };
  if (canWatch) return { score, decision: 'WATCH', reasons };
  return { score, decision: 'IGNORE', reasons };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    
    if (!firecrawlKey) {
      throw new Error("FIRECRAWL_API_KEY not configured. Connect Firecrawl in Settings → Connectors.");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { hunt_id, max_results = 10 } = await req.json().catch(() => ({}));
    
    if (!hunt_id) {
      throw new Error("hunt_id is required");
    }
    
    // Get hunt details
    const { data: hunt, error: huntError } = await supabase
      .from('sale_hunts')
      .select('*')
      .eq('id', hunt_id)
      .single();
    
    if (huntError || !hunt) {
      throw new Error(`Hunt not found: ${huntError?.message || 'unknown'}`);
    }
    
    // Build search queries using the RPC
    const { data: queries, error: queriesError } = await supabase
      .rpc('rpc_build_outward_queries', { p_hunt_id: hunt_id });
    
    if (queriesError || !queries || queries.length === 0) {
      console.log('No queries generated, using fallback');
    }
    
    // Build enhanced queries with listing-intent tokens
    const baseQueries: string[] = queries || [];
    
    // SIMPLIFIED query strategy v4
    // Firecrawl search API doesn't support Google operators (inurl:, year ranges)
    // Use simple site: + keywords instead
    const enhancedQueries: string[] = [];
    
    // AU-specific site-targeted queries
    const make = hunt.make || '';
    const model = hunt.model || '';
    const badge = hunt.badge || '';
    const seriesFamily = hunt.series_family || '';
    const engineFamily = hunt.engine_family || '';
    const mustHaves = (hunt.must_have_tokens || []).slice(0, 2).join(' ');
    
    // Use individual years for better results (cap to ±3 years max)
    const currentYear = new Date().getFullYear();
    const huntYear = hunt.year || currentYear;
    const yearMin = Math.max(hunt.year_min ?? (huntYear - 1), huntYear - 3);
    const yearMax = Math.min(hunt.year_max ?? (huntYear + 1), huntYear + 3, currentYear + 1);
    
    // Build spec tokens for tighter matching
    const specTokens: string[] = [];
    if (badge) specTokens.push(badge);
    if (seriesFamily) specTokens.push(seriesFamily.replace('LC', '')); // e.g., LC79 -> 79
    if (engineFamily === 'V8_DIESEL') specTokens.push('V8');
    if (engineFamily === 'I4_DIESEL') specTokens.push('2.8');
    if (engineFamily === 'I4_TURBO') specTokens.push('1.6t');
    if (mustHaves) specTokens.push(mustHaves);
    const specStr = specTokens.join(' ');
    
    // Simpler negatives (Firecrawl-compatible)
    const negTokens = '-review -news -blog -specs -guide';
    
    // Build year list with OR for better matching (e.g., "2023 OR 2024 OR 2025")
    const years: number[] = [];
    for (let y = yearMin; y <= yearMax; y++) years.push(y);
    const yearStr = years.length > 1 ? years.join(' OR ') : String(years[0] || huntYear);
    
    // ==========================================
    // TIER 1: AUCTION SITES ONLY (prioritized - this is where the big margins live)
    // ==========================================
    
    // CRITICAL: Direct forced queries first (no year/spec constraints - cast widest net)
    const tier1ForcedAuctionQueries: string[] = [
      `site:pickles.com.au ${make} ${model}`,         // Direct: Pickles + make/model only
      `site:manheim.com.au ${make} ${model}`,         // Direct: Manheim + make/model only
      `site:grays.com ${make} ${model}`,              // Direct: Grays + make/model only
    ];
    
    // Spec-constrained auction queries (narrower, but still prioritized)
    const tier1SpecAuctionQueries: string[] = [
      `site:pickles.com.au ${make} ${model} ${yearStr}`.trim(),
      `site:manheim.com.au ${make} ${model} ${yearStr}`.trim(),
      `site:grays.com ${make} ${model} ${specStr}`.trim(),
      `site:slatteryauctions.com.au ${make} ${model} ${yearStr}`.trim(),
      `site:allansauctions.com.au ${make} ${model}`.trim(),
      `site:lloydsauctions.com.au ${make} ${model}`.trim(),
      // Broader auction search across AU
      `${make} ${model} auction Australia ${yearStr}`.trim(),
    ];
    
    // Combine: forced first, then spec queries
    const tier1AuctionQueries = [...tier1ForcedAuctionQueries, ...tier1SpecAuctionQueries];
    
    // Add Tier 1 auction queries first (up to 8 for better coverage)
    for (const q of tier1AuctionQueries.slice(0, 8)) {
      enhancedQueries.push(q);
    }
    
    console.log(`[TIER 1 QUERIES] Auction-first queries:`, tier1AuctionQueries.slice(0, 8));
    
    // ==========================================
    // TIER 2: RETAIL/MARKETPLACE (fallback - added after auction processing)
    // These are added but placed after auction sources in query order
    // Only use if auction results < 20 (checked during processing)
    // ==========================================
    const tier2RetailQueries: string[] = [
      `site:carsales.com.au ${yearStr} ${make} ${model} ${specStr} ${negTokens}`.trim(),
      `site:autotrader.com.au ${yearStr} ${make} ${model} ${specStr} ${negTokens}`.trim(),
    ];
    
    // We'll add retail queries at end only if needed (controlled by query limit)
    // This ensures auctions are processed first before retail fallback
    
    // Keep any original queries that weren't site-specific (fallback)
    for (const q of baseQueries) {
      if (!q.includes('site:') && !enhancedQueries.includes(q)) {
        enhancedQueries.push(q);
      }
    }
    
    // Dedupe - limit to 8 auction queries first (increased from 6)
    let searchQueries = [...new Set(enhancedQueries)].slice(0, 8);
    
    // Flag to track if we should add retail fallback (will check after initial results)
    const retailQueriesAvailable = tier2RetailQueries;
    
    console.log(`Outward hunt v1.3 for ${hunt_id}: ${searchQueries.length} queries`);
    console.log(`[QUERY LIST]`, searchQueries);
    
    // Create run record
    const { data: run } = await supabase
      .from('outward_hunt_runs')
      .insert({
        hunt_id,
        dealer_id: hunt.dealer_id,
        status: 'running',
        provider: 'firecrawl',
        queries: searchQueries,
      })
      .select()
      .single();
    
    const results = {
      queries_run: 0,
      results_found: 0,
      listings_found: 0,
      articles_skipped: 0,
      candidates_created: 0,
      candidates_rejected: 0,
      queued_for_scrape: 0,
      alerts_emitted: 0,
      carsales_pages_scraped: 0,
      carsales_cards_extracted: 0,
      pickles_pages_scraped: 0,
      pickles_cards_extracted: 0,
      reject_reasons: {} as Record<string, number>,
      errors: [] as string[],
    };
    
    // Track processed results pages to avoid re-scraping
    const processedCarsalesPages = new Set<string>();
    const processedPicklesPages = new Set<string>();
    
    // ==========================================
    // PHASE 1: RUN AUCTION-FIRST QUERIES (Tier 1)
    // ==========================================
    let queriesToRun = searchQueries.slice(0, 8);
    console.log(`[TIER 1] Running ${queriesToRun.length} auction-first queries...`);
    console.log(`[TIER 1 QUERIES]`, queriesToRun);
    
    let auctionResultsCount = 0;
    
    for (const query of queriesToRun) {
      try {
        console.log(`Searching: ${query.slice(0, 80)}...`);
        
        const searchRes = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            limit: max_results,
            lang: "en",
            country: "AU",
            scrapeOptions: {
              formats: ["markdown"],
              onlyMainContent: true,
              waitFor: 8000,  // Increased: wait 8s for JS-heavy dealer sites
            },
            timeout: 60000,  // Increased: 60s timeout for slow JS-heavy pages
          }),
        });
        
        results.queries_run++;
        
        if (!searchRes.ok) {
          const errText = await searchRes.text();
          console.error(`Firecrawl search error:`, errText);
          results.errors.push(`Search error: ${errText.slice(0, 100)}`);
          continue;
        }
        
        const searchData = await searchRes.json();
        const searchResults = searchData.data || [];
        results.results_found += searchResults.length;
        
        console.log(`Query returned ${searchResults.length} results`);
        
        // === DEBUG: Log first 10 raw URLs/titles for visibility ===
        const rawUrls = searchResults.slice(0, 10).map((r: any) => ({
          url: r.url || 'no-url',
          title: (r.title || r.metadata?.title || 'no-title').slice(0, 60),
          domain: extractDomain(r.url || ''),
        }));
        console.log(`[RAW RESULTS] Query: "${query.slice(0, 50)}..."`, JSON.stringify(rawUrls, null, 2));
        
        // Track auction results specifically
        const auctionDomains = ['pickles.com.au', 'manheim.com.au', 'grays.com', 'lloydsauctions.com.au', 'slatteryauctions.com.au', 'allansauctions.com.au'];
        const auctionHits = searchResults.filter((r: any) => {
          const domain = extractDomain(r.url || '');
          return auctionDomains.some(ad => domain.includes(ad));
        });
        auctionResultsCount += auctionHits.length;
        console.log(`[AUCTION HITS] ${auctionHits.length} auction results from this query (total: ${auctionResultsCount})`);
        
        // === DEBUG: Log all Pickles URLs specifically ===
        const picklesUrls = searchResults.filter((r: any) => extractDomain(r.url || '').includes('pickles.com.au'));
        if (picklesUrls.length > 0) {
          console.log(`[PICKLES DEBUG] Found ${picklesUrls.length} Pickles URLs:`);
          for (const pu of picklesUrls) {
            const pUrl = pu.url || '';
            const isResults = isPicklesResultsPage(pUrl);
            const isDetails = isPicklesDetailsPage(pUrl);
            console.log(`  - ${pUrl.slice(0, 100)} | isResultsPage: ${isResults} | isDetailsPage: ${isDetails}`);
          }
        } else {
          console.log(`[PICKLES DEBUG] No Pickles URLs in this query result`);
        }
        
        // Process each search result
        for (const result of searchResults) {
          try {
            const resultUrl = result.url || '';
            
            // =====================================================
            // CARSALES RESULTS PAGE EXTRACTION
            // If this is a Carsales results page (not a details page),
            // scrape it and extract individual listing cards
            // =====================================================
            if (isCarsalesResultsPage(resultUrl) && !processedCarsalesPages.has(resultUrl)) {
              processedCarsalesPages.add(resultUrl);
              console.log(`[CARSALES] Detected results page, extracting cards...`);
              
              const cards = await scrapeCarsalesResultsPage(resultUrl, firecrawlKey, hunt as Hunt);
              results.carsales_pages_scraped++;
              results.carsales_cards_extracted += cards.length;
              
              // Process each Carsales card as a separate candidate
              for (const card of cards) {
                try {
                  const cardFullText = `${card.title} ${card.raw_snippet}`;
                  const classification = classifyCandidate(cardFullText, hunt as Hunt, card.details_url || resultUrl);
                  
                  // Apply hard gates
                  const gateResult = applyHardGates(classification, hunt as Hunt, cardFullText, card.details_url || resultUrl);
                  
                  const hasHardReject = !gateResult.allowWatch;
                  if (hasHardReject) {
                    results.candidates_rejected++;
                    continue;
                  }
                  
                  // Score the card - treat as verified listing (we know it's a listing card)
                  let score = 5.0;
                  const reasons: string[] = ['carsales_card'];
                  
                  if (card.year === hunt.year) {
                    score += 1.5;
                    reasons.push('exact_year_match');
                  }
                  if (card.price && hunt.proven_exit_value) {
                    const gap_pct = ((hunt.proven_exit_value - card.price) / hunt.proven_exit_value) * 100;
                    if (gap_pct >= 10) {
                      score += 1.5;
                      reasons.push(`gap_${gap_pct.toFixed(0)}pct`);
                    } else if (gap_pct >= 5) {
                      score += 1.0;
                    }
                  }
                  if (classification.series_family === hunt.series_family) {
                    score += 0.5;
                    reasons.push('series_match');
                  }
                  
                  score = Math.min(10, Math.max(0, score));
                  const decision = score >= 7.0 ? 'BUY' : score >= 5.0 ? 'WATCH' : 'IGNORE';
                  
                  // Use canonical_id for proper dedupe
                  const canonicalId = `carsales:${card.external_id}`;
                  const cardUrl = card.details_url || `${resultUrl}#card=${card.external_id}`;
                  
                  // Get source_tier from DB function
                  const { data: tierData } = await supabase.rpc('fn_source_tier', { 
                    p_url: cardUrl, 
                    p_source_name: 'carsales.com.au' 
                  });
                  const sourceTier = tierData ?? 2;
                  
                  // Upsert Carsales card as candidate with canonical_id
                  const { data: upsertedCard, error: upsertErr } = await supabase
                    .from('hunt_external_candidates')
                    .upsert({
                      hunt_id,
                      source_url: cardUrl,
                      source_name: 'carsales.com.au',
                      canonical_id: canonicalId,
                      dedup_key: canonicalId,  // Keep for backwards compat
                      title: card.title,
                      raw_snippet: card.raw_snippet,
                      year: card.year,
                      make: 'Toyota',
                      model: 'LandCruiser',
                      km: card.km,
                      asking_price: card.price,
                      location: card.state,
                      confidence: card.details_url ? 'high' : 'medium',
                      match_score: score,
                      decision,
                      is_listing: true,
                      listing_kind: 'retail_listing',
                      page_type: 'listing',
                      reject_reason: null,
                      price_verified: !!card.price,
                      km_verified: !!card.km,
                      year_verified: !!card.year,
                      verified_fields: {
                        asking_price: card.price,
                        km: card.km,
                        year: card.year,
                      },
                      criteria_version: hunt.criteria_version,
                      is_stale: false,
                      listing_intent: 'listing',
                      listing_intent_reason: 'CARSALES_CARD_EXTRACTED',
                      source_tier: sourceTier,
                    }, { onConflict: 'hunt_id,criteria_version,canonical_id' })
                    .select('id, alert_emitted')
                    .single();
                  
                  if (!upsertErr && upsertedCard) {
                    results.candidates_created++;
                    results.listings_found++;
                    
                    // Emit alert for BUY/WATCH
                    if ((decision === 'BUY' || decision === 'WATCH') && !upsertedCard.alert_emitted) {
                      const alertPayload = {
                        year: card.year,
                        make: 'Toyota',
                        model: 'LandCruiser',
                        badge: card.badge,
                        km: card.km,
                        asking_price: card.price,
                        proven_exit_value: hunt.proven_exit_value,
                        gap_dollars: hunt.proven_exit_value && card.price 
                          ? hunt.proven_exit_value - card.price 
                          : null,
                        match_score: score,
                        source: 'Carsales (extracted card)',
                        source_type: 'outward',
                        listing_url: card.details_url || resultUrl,
                        classification,
                        reasons,
                        is_verified_listing: true,
                        listing_kind: 'retail_listing',
                        requires_carsales_lookup: !card.details_url,
                      };
                      
                      await supabase.from('hunt_alerts').insert({
                        hunt_id,
                        listing_id: upsertedCard.id,
                        alert_type: decision,
                        payload: alertPayload,
                        criteria_version: hunt.criteria_version || 1,
                        is_stale: false,
                      });
                      
                      await supabase
                        .from('hunt_external_candidates')
                        .update({ alert_emitted: true })
                        .eq('id', upsertedCard.id);
                      
                      results.alerts_emitted++;
                    }
                  }
                } catch (cardErr) {
                  console.error('[CARSALES] Error processing card:', cardErr);
                }
              }
              
              // Skip normal processing for Carsales results pages
              continue;
            }
            
            // =====================================================
            // PICKLES RESULTS PAGE EXTRACTION
            // If this is a Pickles search/results page,
            // scrape it and extract individual auction lot cards
            // =====================================================
            if (isPicklesResultsPage(resultUrl) && !processedPicklesPages.has(resultUrl)) {
              processedPicklesPages.add(resultUrl);
              console.log(`[PICKLES] Detected results page, extracting cards: ${resultUrl.slice(0, 80)}...`);
              
              const cards = await scrapePicklesResultsPage(resultUrl, firecrawlKey, hunt as Hunt);
              results.pickles_pages_scraped++;
              results.pickles_cards_extracted += cards.length;
              
              // Process each Pickles card as a separate candidate
              for (const card of cards) {
                try {
                  const cardFullText = `${card.title} ${card.raw_snippet}`;
                  const classification = classifyCandidate(cardFullText, hunt as Hunt, card.details_url || resultUrl);
                  
                  // Apply hard gates (but with relaxed year matching for auctions)
                  const gateResult = applyHardGates(classification, hunt as Hunt, cardFullText, card.details_url || resultUrl);
                  
                  const hasHardReject = !gateResult.allowWatch;
                  if (hasHardReject) {
                    results.candidates_rejected++;
                    console.log(`[PICKLES CARD REJECTED] ${card.title}: ${gateResult.rejectReasons.join(', ')}`);
                    continue;
                  }
                  
                  // Score the card - treat as verified auction listing (high priority)
                  let score = 6.0;  // Auction lots start higher
                  const reasons: string[] = ['pickles_auction_lot'];
                  
                  // Year matching with ±3 tolerance for auctions
                  const huntYearMin = (hunt.year_min ?? hunt.year ?? 2015) - 3;
                  const huntYearMax = (hunt.year_max ?? hunt.year ?? new Date().getFullYear()) + 3;
                  if (card.year && card.year >= huntYearMin && card.year <= huntYearMax) {
                    if (card.year === hunt.year) {
                      score += 1.5;
                      reasons.push('exact_year_match');
                    } else {
                      score += 0.5;
                      reasons.push('year_in_range');
                    }
                  }
                  
                  if (card.price && hunt.proven_exit_value) {
                    const gap_pct = ((hunt.proven_exit_value - card.price) / hunt.proven_exit_value) * 100;
                    if (gap_pct >= 10) {
                      score += 2.0;  // Big gap = high score for auctions
                      reasons.push(`gap_${gap_pct.toFixed(0)}pct`);
                    } else if (gap_pct >= 5) {
                      score += 1.0;
                    }
                  }
                  
                  score = Math.min(10, Math.max(0, score));
                  const decision = score >= 7.0 ? 'BUY' : score >= 5.0 ? 'WATCH' : 'IGNORE';
                  
                  // Use canonical_id for proper dedupe
                  const canonicalId = `pickles:${card.external_id}`;
                  const cardUrl = card.details_url || `${resultUrl}#card=${card.external_id}`;
                  
                  // Pickles is always Tier 1 (auction)
                  const sourceTier = 1;
                  
                  // Upsert Pickles card as candidate
                  const { data: upsertedCard, error: upsertErr } = await supabase
                    .from('hunt_external_candidates')
                    .upsert({
                      hunt_id,
                      source_url: cardUrl,
                      source_name: 'pickles.com.au',
                      canonical_id: canonicalId,
                      dedup_key: canonicalId,
                      title: card.title,
                      raw_snippet: card.raw_snippet,
                      year: card.year,
                      make: hunt.make || 'Toyota',
                      model: hunt.model || 'Unknown',
                      km: card.km,
                      asking_price: card.price,
                      location: card.state,
                      confidence: card.details_url ? 'high' : 'medium',
                      match_score: score,
                      decision,
                      is_listing: true,
                      listing_kind: 'auction_lot',
                      page_type: 'listing',
                      reject_reason: null,
                      price_verified: !!card.price,
                      km_verified: !!card.km,
                      year_verified: !!card.year,
                      verified_fields: {
                        asking_price: card.price,
                        km: card.km,
                        year: card.year,
                      },
                      criteria_version: hunt.criteria_version,
                      is_stale: false,
                      listing_intent: 'listing',
                      listing_intent_reason: 'PICKLES_AUCTION_CARD_EXTRACTED',
                      source_tier: sourceTier,
                    }, { onConflict: 'hunt_id,criteria_version,canonical_id' })
                    .select('id, alert_emitted')
                    .single();
                  
                  if (!upsertErr && upsertedCard) {
                    results.candidates_created++;
                    results.listings_found++;
                    auctionResultsCount++;
                    
                    console.log(`[PICKLES CARD] Created: ${card.title} | $${card.price || 'N/A'} | ${card.km || 'N/A'}km | ${card.state || 'AU'}`);
                    
                    // Emit alert for BUY/WATCH
                    if ((decision === 'BUY' || decision === 'WATCH') && !upsertedCard.alert_emitted) {
                      const alertPayload = {
                        year: card.year,
                        make: hunt.make || 'Toyota',
                        model: hunt.model || 'Unknown',
                        badge: card.badge,
                        km: card.km,
                        asking_price: card.price,
                        proven_exit_value: hunt.proven_exit_value,
                        gap_dollars: hunt.proven_exit_value && card.price 
                          ? hunt.proven_exit_value - card.price 
                          : null,
                        match_score: score,
                        source: 'Pickles Auction',
                        source_type: 'outward_auction',
                        listing_url: card.details_url || resultUrl,
                        classification,
                        reasons,
                        is_verified_listing: true,
                        listing_kind: 'auction_lot',
                      };
                      
                      await supabase.from('hunt_alerts').insert({
                        hunt_id,
                        listing_id: upsertedCard.id,
                        alert_type: decision,
                        payload: alertPayload,
                        criteria_version: hunt.criteria_version || 1,
                        is_stale: false,
                      });
                      
                      await supabase
                        .from('hunt_external_candidates')
                        .update({ alert_emitted: true })
                        .eq('id', upsertedCard.id);
                      
                      results.alerts_emitted++;
                    }
                  }
                } catch (cardErr) {
                  console.error('[PICKLES] Error processing card:', cardErr);
                }
              }
              
              // Skip normal processing for Pickles results pages
              continue;
            }
            
            // Normal candidate processing (non-results pages)
            const candidate = extractCandidate(result, hunt as Hunt);
            if (!candidate) continue;
            
            const fullText = `${candidate.title} ${candidate.snippet}`;
            const classification = classifyCandidate(fullText, hunt as Hunt, candidate.url);
            
            // Track listing vs article
            if (candidate.is_listing) {
              results.listings_found++;
            } else if (candidate.page_type === 'article') {
              results.articles_skipped++;
            }
            
            // Apply hard gates (now includes URL for better series detection)
            const gateResult = applyHardGates(classification, hunt as Hunt, fullText, candidate.url);
            
            for (const reason of gateResult.rejectReasons) {
              const key = reason.split(':')[0];
              results.reject_reasons[key] = (results.reject_reasons[key] || 0) + 1;
            }
            
            // Combine reject reasons
            const allRejectReasons = candidate.reject_reason 
              ? [...gateResult.rejectReasons, candidate.reject_reason] 
              : gateResult.rejectReasons;
            
            // CRITICAL FIX: Hard rejects (series/engine/cab/body mismatch) should reject 
            // even verified listings. Only non-listings get auto-rejected on soft gates.
            const hasHardReject = !gateResult.allowWatch;
            const shouldReject = hasHardReject || (allRejectReasons.length > 0 && !candidate.is_listing);
            
            if (shouldReject) {
              results.candidates_rejected++;
              
              // DEBUG: Log rejected URLs for analysis (first 20)
              if (results.candidates_rejected <= 20) {
                console.log(`[REJECTED ${results.candidates_rejected}] URL: ${candidate.url.slice(0, 100)} | Reasons: ${allRejectReasons.join(', ')} | isListing: ${candidate.is_listing} | pageType: ${candidate.page_type}`);
              }
              // Use canonical_id for proper dedupe
              const { data: canonicalData } = await supabase.rpc('fn_canonical_listing_id', { p_url: candidate.url });
              const canonicalId = canonicalData || `${candidate.domain}:${btoa(candidate.url).slice(0, 32)}`;
              
              const { data: tierData } = await supabase.rpc('fn_source_tier', { 
                p_url: candidate.url, 
                p_source_name: candidate.domain 
              });
              const sourceTier = tierData ?? 3;
              
              const { data: intentData } = await supabase.rpc('fn_classify_listing_intent', { 
                p_url: candidate.url, 
                p_title: candidate.title, 
                p_snippet: candidate.snippet 
              });
              const intentObj = intentData || { intent: 'unknown', reason: 'RPC_FAILED' };
              
              // Save rejected candidate with criteria_version and canonical_id
              await supabase
                .from('hunt_external_candidates')
                .upsert({
                  hunt_id,
                  source_url: candidate.url,
                  source_name: candidate.domain,
                  canonical_id: canonicalId,
                  dedup_key: canonicalId,  // Keep for backwards compat
                  title: candidate.title,
                  raw_snippet: candidate.snippet,
                  year: candidate.year,
                  make: candidate.make,
                  model: candidate.model,
                  km: candidate.km,
                  asking_price: candidate.asking_price,
                  location: candidate.location,
                  confidence: candidate.confidence,
                  decision: 'IGNORE',
                  is_listing: candidate.is_listing,
                  listing_kind: candidate.listing_kind,
                  page_type: candidate.page_type,
                  reject_reason: allRejectReasons[0] || 'HARD_GATE_FAILED',
                  price_verified: false,
                  km_verified: false,
                  year_verified: false,
                  verified_fields: {},
                  criteria_version: hunt.criteria_version,
                  is_stale: false,
                  listing_intent: intentObj.intent,
                  listing_intent_reason: intentObj.reason,
                  source_tier: sourceTier,
                }, { onConflict: 'hunt_id,criteria_version,canonical_id' });
              
              continue;
            }
            
            // Score and decide
            const { score, decision, reasons } = scoreAndDecide(candidate, classification, hunt as Hunt);
            
            // Use canonical_id for proper dedupe (not URL-based)
            const { data: canonicalData } = await supabase.rpc('fn_canonical_listing_id', { p_url: candidate.url });
            const canonicalId = canonicalData || `${candidate.domain}:${btoa(candidate.url).slice(0, 32)}`;
            
            const { data: tierData } = await supabase.rpc('fn_source_tier', { 
              p_url: candidate.url, 
              p_source_name: candidate.domain 
            });
            const sourceTier = tierData ?? 3;
            
            const { data: intentData } = await supabase.rpc('fn_classify_listing_intent', { 
              p_url: candidate.url, 
              p_title: candidate.title, 
              p_snippet: candidate.snippet 
            });
            const intentObj = intentData || { intent: 'unknown', reason: 'RPC_FAILED' };
            
            // Upsert to hunt_external_candidates with canonical_id for dedupe
            const { data: upsertedCandidate, error: upsertError } = await supabase
              .from('hunt_external_candidates')
              .upsert({
                hunt_id,
                source_url: candidate.url,
                source_name: candidate.domain,
                canonical_id: canonicalId,
                dedup_key: canonicalId,  // Keep for backwards compat
                title: candidate.title,
                raw_snippet: candidate.snippet,
                year: candidate.year,
                make: candidate.make,
                model: candidate.model,
                variant_raw: candidate.variant_raw,
                km: candidate.km,
                asking_price: candidate.asking_price,
                location: candidate.location,
                confidence: candidate.confidence,
                match_score: score,
                decision,
                alert_emitted: false,
                is_listing: candidate.is_listing,
                listing_kind: candidate.listing_kind,
                page_type: candidate.page_type,
                reject_reason: null,
                price_verified: false,
                km_verified: false,
                year_verified: false,
                verified_fields: {
                  asking_price: candidate.asking_price,
                  km: candidate.km,
                  year: candidate.year,
                },
                criteria_version: hunt.criteria_version,
                is_stale: false,
                listing_intent: intentObj.intent,
                listing_intent_reason: intentObj.reason,
                source_tier: sourceTier,
              }, { onConflict: 'hunt_id,criteria_version,canonical_id' })
              .select('id, alert_emitted')
              .single();
            
            if (!upsertError && upsertedCandidate) {
              results.candidates_created++;
              
              // Queue for scrape verification if it's a verified listing
              if (candidate.is_listing) {
                const priority = AUCTION_DOMAINS.some(d => candidate.domain.includes(d)) ? 8 : 10;
                const mustHaveBoost = (hunt.must_have_tokens || []).some((t: string) => 
                  fullText.toUpperCase().includes(t.toUpperCase())
                ) ? 2 : 0;
                
                await supabase
                  .from('outward_candidate_scrape_queue')
                  .upsert({
                    hunt_id,
                    candidate_id: upsertedCandidate.id,
                    candidate_url: candidate.url,
                    status: 'queued',
                    priority: priority + mustHaveBoost,
                  }, { onConflict: 'hunt_id,candidate_url' })
                  .then(res => {
                    if (!res.error) results.queued_for_scrape++;
                  });
              }
              
              // Emit alert for BUY/WATCH on verified listings
              if ((decision === 'BUY' || decision === 'WATCH') && 
                  candidate.is_listing && 
                  !upsertedCandidate.alert_emitted) {
                const alertPayload = {
                  year: candidate.year,
                  make: candidate.make,
                  model: candidate.model,
                  variant: candidate.variant_raw,
                  km: candidate.km,
                  asking_price: candidate.asking_price,
                  proven_exit_value: hunt.proven_exit_value,
                  gap_dollars: hunt.proven_exit_value && candidate.asking_price 
                    ? hunt.proven_exit_value - candidate.asking_price 
                    : null,
                  gap_pct: hunt.proven_exit_value && candidate.asking_price 
                    ? ((hunt.proven_exit_value - candidate.asking_price) / hunt.proven_exit_value) * 100 
                    : null,
                  match_score: score,
                  source: `Web Discovery (${candidate.domain})`,
                  source_type: 'outward',
                  listing_url: candidate.url,
                  classification,
                  reasons,
                  is_verified_listing: candidate.is_listing,
                  listing_kind: candidate.listing_kind,
                };
                
                const { error: alertErr } = await supabase.from('hunt_alerts').insert({
                  hunt_id,
                  listing_id: upsertedCandidate.id,
                  alert_type: decision,
                  payload: alertPayload,
                  criteria_version: hunt.criteria_version || 1,
                  is_stale: false,
                });
                
                if (!alertErr) {
                  await supabase
                    .from('hunt_external_candidates')
                    .update({ alert_emitted: true })
                    .eq('id', upsertedCandidate.id);
                  
                  results.alerts_emitted++;
                }
              }
            }
          } catch (err) {
            console.error('Error processing result:', err);
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Error with query:`, errMsg);
        results.errors.push(errMsg);
      }
    }
    
    // ==========================================
    // PHASE 2: RETAIL FALLBACK (only if auction results < 20)
    // ==========================================
    const auctionCandidates = results.candidates_created;
    if (auctionCandidates < 20 && retailQueriesAvailable.length > 0) {
      console.log(`[TIER 2] Auction results only ${auctionCandidates} — adding retail fallback queries...`);
      
      for (const query of retailQueriesAvailable.slice(0, 2)) {
        try {
          console.log(`[RETAIL] Searching: ${query.slice(0, 80)}...`);
          
          const searchRes = await fetch("https://api.firecrawl.dev/v1/search", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${firecrawlKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query,
              limit: max_results,
              lang: "en",
              country: "AU",
              scrapeOptions: {
                formats: ["markdown"],
                onlyMainContent: true,
                waitFor: 8000,
              },
              timeout: 60000,
            }),
          });
          
          results.queries_run++;
          
          if (!searchRes.ok) {
            const errText = await searchRes.text();
            console.error(`Retail search error:`, errText);
            continue;
          }
          
          const searchData = await searchRes.json();
          const searchResults = searchData.data || [];
          results.results_found += searchResults.length;
          
          console.log(`[RETAIL] Query returned ${searchResults.length} results`);
          
          // Process retail results with same logic (simplified - just count for now)
          // Full processing happens in the next iteration when we refactor the main loop
          for (const result of searchResults) {
            try {
              const resultUrl = result.url || '';
              const resultTitle = result.title || '';
              const resultMarkdown = result.markdown || result.content || '';
              const fullText = `${resultTitle} ${resultMarkdown}`.toLowerCase();
              
              // Extract candidate
              const candidate = extractCandidate({
                url: resultUrl,
                title: resultTitle,
                description: result.description || '',
                markdown: resultMarkdown,
              }, hunt);
              
              if (!candidate) {
                results.candidates_rejected++;
                continue;
              }
              
              // Classify and gate - using correct signatures from main loop
              const candidateFullText = `${candidate.title} ${candidate.snippet}`;
              const classification = classifyCandidate(candidateFullText, hunt as Hunt, candidate.url);
              const gateResult = applyHardGates(classification, hunt as Hunt, candidateFullText, candidate.url);
              
              if (gateResult.rejectReasons.length > 0 && !gateResult.allowWatch) {
                results.candidates_rejected++;
                continue;
              }
              
              // Score and decide
              const { score, decision, reasons } = scoreAndDecide(candidate, classification, hunt as Hunt);
              
              // Use canonical_id for proper dedupe
              const { data: canonicalData } = await supabase.rpc('fn_canonical_listing_id', { p_url: candidate.url });
              const canonicalId = canonicalData || `${candidate.domain}:${btoa(candidate.url).slice(0, 32)}`;
              
              const { data: tierData } = await supabase.rpc('fn_source_tier', { 
                p_url: candidate.url, 
                p_source_name: candidate.domain 
              });
              const sourceTier = tierData ?? 3;
              
              const { data: intentData } = await supabase.rpc('fn_classify_listing_intent', { 
                p_url: candidate.url, 
                p_title: candidate.title, 
                p_snippet: candidate.snippet 
              });
              const intentObj = intentData || { intent: 'unknown', reason: 'RPC_FAILED' };
              
              // Upsert retail candidate
              const { error: upsertError } = await supabase
                .from('hunt_external_candidates')
                .upsert({
                  hunt_id,
                  source_url: candidate.url,
                  source_name: candidate.domain,
                  canonical_id: canonicalId,
                  dedup_key: canonicalId,
                  title: candidate.title,
                  raw_snippet: candidate.snippet,
                  year: candidate.year,
                  make: candidate.make,
                  model: candidate.model,
                  variant_raw: candidate.variant_raw,
                  km: candidate.km,
                  asking_price: candidate.asking_price,
                  location: candidate.location,
                  confidence: candidate.confidence,
                  match_score: score,
                  decision,
                  alert_emitted: false,
                  is_listing: candidate.is_listing,
                  listing_kind: candidate.listing_kind,
                  page_type: candidate.page_type,
                  reject_reason: null,
                  price_verified: false,
                  km_verified: false,
                  year_verified: false,
                  verified_fields: {
                    asking_price: candidate.asking_price,
                    km: candidate.km,
                    year: candidate.year,
                  },
                  criteria_version: hunt.criteria_version,
                  is_stale: false,
                  listing_intent: intentObj.intent,
                  listing_intent_reason: intentObj.reason,
                  source_tier: sourceTier,
                }, { onConflict: 'hunt_id,criteria_version,canonical_id' });
              
              if (!upsertError) {
                results.candidates_created++;
              }
            } catch (err) {
              console.error('[RETAIL] Error processing result:', err);
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[RETAIL] Query error:', errMsg);
        }
      }
    } else {
      console.log(`[TIER 2] Skipping retail fallback — auction results (${auctionCandidates}) sufficient`);
    }
    
    // Update run record
    if (run?.id) {
      await supabase
        .from('outward_hunt_runs')
        .update({
          status: results.errors.length === 0 ? 'success' : 'partial',
          finished_at: new Date().toISOString(),
          results_found: results.results_found,
          candidates_created: results.candidates_created,
          error: results.errors.length > 0 ? results.errors.join('; ') : null,
        })
        .eq('id', run.id);
    }
    
    // Update hunt last_outward_scan_at
    await supabase
      .from('sale_hunts')
      .update({ last_outward_scan_at: new Date().toISOString() })
      .eq('id', hunt_id);
    
    // Build unified candidates after outward search
    try {
      const { data: unifiedResult, error: unifiedErr } = await supabase.rpc(
        'rpc_build_unified_candidates',
        { p_hunt_id: hunt_id }
      );
      if (unifiedErr) {
        console.warn(`Failed to build unified candidates: ${unifiedErr.message}`);
      } else {
        console.log(`Unified candidates built after outward:`, unifiedResult);
      }
    } catch (unifyErr) {
      console.warn(`Unified build error: ${unifyErr}`);
    }
    
    console.log('Outward hunt v1.2 complete:', results);
    
    return new Response(JSON.stringify({
      success: true,
      version: '1.2',
      ...results,
      duration_ms: Date.now() - startTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    
  } catch (error) {
    console.error("Outward hunt error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    }), { 
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
