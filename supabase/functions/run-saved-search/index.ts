import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedListing {
  listing_url: string;
  title: string;
  make?: string;
  model?: string;
  year?: number;
  km?: number;
  price?: number;
  lot_id?: string;
}

interface RunLog {
  fetchedUrl: string;
  httpStatus: number;
  responseSize: number;
  htmlPreview: string;
  listingUrlsSample: string[];
}

interface RunResult {
  success: boolean;
  searchId: string;
  label: string;
  listings: ParsedListing[];
  added: number;
  updated: number;
  error?: string;
  // Diagnostics
  httpStatus?: number;
  listingsFound: number;
  runLog: RunLog;
}

// Simple HTML entity decoder
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Extract text content from HTML (strip tags)
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Sanitize HTML for preview (remove scripts, styles, etc)
function sanitizeHtmlPreview(html: string, maxLength: number = 300): string {
  // Remove script and style tags with content
  let clean = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (clean.length > maxLength) {
    clean = clean.substring(0, maxLength) + '...';
  }
  
  return clean || '(empty response)';
}

// Extract year from text (4-digit number between 1990-2030)
function extractYear(text: string): number | undefined {
  const match = text.match(/\b(19[9][0-9]|20[0-3][0-9])\b/);
  return match ? parseInt(match[1]) : undefined;
}

// Extract km from text (number followed by km/kms/kilometres)
function extractKm(text: string): number | undefined {
  const match = text.match(/(\d{1,3}(?:,\d{3})*)\s*(?:km|kms|kilometres?)/i);
  if (match) {
    return parseInt(match[1].replace(/,/g, ''));
  }
  // Also try standalone large numbers that might be km
  const kmMatch = text.match(/\b(\d{2,3},?\d{3})\b/);
  if (kmMatch) {
    const val = parseInt(kmMatch[1].replace(/,/g, ''));
    if (val >= 1000 && val <= 500000) return val;
  }
  return undefined;
}

// Extract price from text (dollar amounts)
function extractPrice(text: string): number | undefined {
  const match = text.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''));
  }
  return undefined;
}

// Validate listing URL - reject placeholders and invalid URLs
function isValidListingUrl(url: string): boolean {
  if (!url || url.length < 10) return false;
  
  // Reject placeholder/test URLs
  const invalidPatterns = [
    'example.com',
    'test.example',
    'placeholder',
    'localhost',
    '127.0.0.1',
    'invalid',
  ];
  
  const urlLower = url.toLowerCase();
  for (const pattern of invalidPatterns) {
    if (urlLower.includes(pattern)) return false;
  }
  
  // Must be a valid absolute URL
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Parse Pickles-style listings
function parsePicklesListings(html: string, baseUrl: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  
  // Pickles URL patterns - look for actual listing detail pages
  // Common patterns: /item/12345, /lot/12345, /cars/detail/12345, /trucks/detail/12345
  // Also look for data-href attributes which Pickles sometimes uses
  const linkPatterns = [
    /href="([^"]*(?:\/item\/|\/lot\/|\/detail\/)[^"]*\d+[^"]*)"/gi,
    /data-href="([^"]*(?:\/item\/|\/lot\/|\/detail\/)[^"]*\d+[^"]*)"/gi,
    /href="(https?:\/\/www\.pickles\.com\.au[^"]*\/\d+[^"]*)"/gi,
  ];
  
  const seenUrls = new Set<string>();
  const seenLotIds = new Set<string>();
  
  for (const pattern of linkPatterns) {
    const links = [...html.matchAll(pattern)];
    
    for (const linkMatch of links) {
      let url = linkMatch[1];
      
      // Skip non-listing URLs
      if (url.includes('javascript:') || url.includes('#') || url.includes('login')) {
        continue;
      }
      
      // Make absolute URL
      if (url.startsWith('/')) {
        try {
          const base = new URL(baseUrl);
          url = `${base.protocol}//${base.host}${url}`;
        } catch {
          console.log(`Failed to create absolute URL from: ${url}`);
          continue;
        }
      }
      
      // Validate URL
      if (!isValidListingUrl(url)) {
        console.log(`Skipping invalid URL: ${url}`);
        continue;
      }
      
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      
      // Extract lot ID from URL - must have numeric ID
      let lotId: string | undefined;
      const lotIdMatch = url.match(/(?:\/item\/|\/lot\/|\/detail\/|\/|id=)(\d{5,})/i);
      if (lotIdMatch) {
        lotId = lotIdMatch[1];
        // Skip if we've already seen this lot ID (dedup)
        if (seenLotIds.has(lotId)) continue;
        seenLotIds.add(lotId);
      } else {
        // No valid lot ID found - skip this URL
        console.log(`Skipping URL without valid lot ID: ${url}`);
        continue;
      }
      
      // Try to find nearby title/description text
      const linkIndex = html.indexOf(linkMatch[0]);
      const contextStart = Math.max(0, linkIndex - 500);
      const contextEnd = Math.min(html.length, linkIndex + 2000);
      const context = html.substring(contextStart, contextEnd);
      
      // Look for title in nearby tags
      let title = '';
      const titleMatch = context.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i) ||
                         context.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</i) ||
                         context.match(/alt="([^"]+)"/i);
      if (titleMatch) {
        title = decodeHtmlEntities(stripHtml(titleMatch[1]));
      }
      
      const fullText = stripHtml(context);
      
      console.log(`Found valid Pickles listing: ${lotId} -> ${url}`);
      
      listings.push({
        listing_url: url,
        title: title || 'Unknown Vehicle',
        year: extractYear(fullText),
        km: extractKm(fullText),
        price: extractPrice(fullText),
        lot_id: lotId,
      });
    }
  }
  
  console.log(`Pickles parser found ${listings.length} valid listings`);
  return listings;
}

// Parse Manheim-style listings
function parseManheimListings(html: string, baseUrl: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  
  // Manheim patterns - look for vehicle cards
  const linkPattern = /href="([^"]*(?:\/vehicle\/|\/lot\/|\/stock\/)[^"]*)"/gi;
  const links = [...html.matchAll(linkPattern)];
  
  const seenUrls = new Set<string>();
  const seenLotIds = new Set<string>();
  
  for (const linkMatch of links) {
    let url = linkMatch[1];
    
    if (url.startsWith('/')) {
      try {
        const base = new URL(baseUrl);
        url = `${base.protocol}//${base.host}${url}`;
      } catch {
        continue;
      }
    }
    
    // Validate URL
    if (!isValidListingUrl(url)) {
      console.log(`Skipping invalid Manheim URL: ${url}`);
      continue;
    }
    
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    
    let lotId: string | undefined;
    const lotIdMatch = url.match(/(?:\/vehicle\/|\/lot\/|\/stock\/|id=)(\w+)/i);
    if (lotIdMatch) {
      lotId = lotIdMatch[1];
      if (seenLotIds.has(lotId)) continue;
      seenLotIds.add(lotId);
    } else {
      // No valid lot ID - skip
      console.log(`Skipping Manheim URL without lot ID: ${url}`);
      continue;
    }
    
    const linkIndex = html.indexOf(linkMatch[0]);
    const contextStart = Math.max(0, linkIndex - 500);
    const contextEnd = Math.min(html.length, linkIndex + 2000);
    const context = html.substring(contextStart, contextEnd);
    
    let title = '';
    const titleMatch = context.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i) ||
                       context.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</i);
    if (titleMatch) {
      title = decodeHtmlEntities(stripHtml(titleMatch[1]));
    }
    
    const fullText = stripHtml(context);
    
    console.log(`Found valid Manheim listing: ${lotId} -> ${url}`);
    
    listings.push({
      listing_url: url,
      title: title || 'Unknown Vehicle',
      year: extractYear(fullText),
      km: extractKm(fullText),
      price: extractPrice(fullText),
      lot_id: lotId,
    });
  }
  
  console.log(`Manheim parser found ${listings.length} valid listings`);
  return listings;
}

// Generic listing parser
function parseGenericListings(html: string, baseUrl: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  
  // Look for any links that might be vehicle listings
  const linkPattern = /href="([^"]+)"/gi;
  const links = [...html.matchAll(linkPattern)];
  
  const seenUrls = new Set<string>();
  
  for (const linkMatch of links) {
    let url = linkMatch[1];
    
    // Skip non-listing links
    if (url.includes('javascript:') || 
        url.includes('mailto:') || 
        url.includes('#') ||
        url.includes('login') ||
        url.includes('register') ||
        url.includes('contact') ||
        url.endsWith('.css') ||
        url.endsWith('.js') ||
        url.endsWith('.png') ||
        url.endsWith('.jpg')) {
      continue;
    }
    
    // Look for patterns suggesting vehicle listings
    if (!url.match(/(?:vehicle|car|truck|lot|item|listing|stock|detail|view)/i)) {
      continue;
    }
    
    if (url.startsWith('/')) {
      try {
        const base = new URL(baseUrl);
        url = `${base.protocol}//${base.host}${url}`;
      } catch {
        continue;
      }
    }
    
    // Validate URL
    if (!isValidListingUrl(url)) {
      continue;
    }
    
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    
    const linkIndex = html.indexOf(linkMatch[0]);
    const contextStart = Math.max(0, linkIndex - 500);
    const contextEnd = Math.min(html.length, linkIndex + 2000);
    const context = html.substring(contextStart, contextEnd);
    
    let title = '';
    const titleMatch = context.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i) ||
                       context.match(/alt="([^"]+)"/i);
    if (titleMatch) {
      title = decodeHtmlEntities(stripHtml(titleMatch[1]));
    }
    
    const fullText = stripHtml(context);
    
    listings.push({
      listing_url: url,
      title: title || 'Unknown Vehicle',
      year: extractYear(fullText),
      km: extractKm(fullText),
      price: extractPrice(fullText),
    });
  }
  
  console.log(`Generic parser found ${listings.length} valid listings`);
  return listings;
}

// Fetch a page with timeout - now returns status and body
async function fetchPage(url: string, timeoutMs = 10000): Promise<{ status: number; body: string | null; redirected: boolean }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    console.log(`Fetching: ${url}`);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
    });
    
    clearTimeout(timeoutId);
    
    const text = await response.text();
    console.log(`Fetched ${text.length} bytes, status: ${response.status}`);
    
    return {
      status: response.status,
      body: response.ok ? text : null,
      redirected: response.redirected,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`Fetch error: ${error}`);
    return { status: 0, body: null, redirected: false };
  }
}

// Parse make/model from title
function parseMakeModel(title: string): { make?: string; model?: string } {
  // Common makes
  const makes = [
    'Toyota', 'Ford', 'Holden', 'Mazda', 'Nissan', 'Hyundai', 'Kia', 'Mitsubishi',
    'Volkswagen', 'BMW', 'Mercedes', 'Audi', 'Honda', 'Subaru', 'Isuzu', 'RAM',
    'Jeep', 'Land Rover', 'Range Rover', 'Lexus', 'Suzuki', 'LDV', 'Great Wall',
    'Chevrolet', 'Dodge', 'Chrysler', 'Peugeot', 'Renault', 'Citroen', 'Fiat',
    'Volvo', 'Skoda', 'Tesla', 'Porsche', 'Jaguar', 'Mini', 'Alfa Romeo'
  ];
  
  const titleLower = title.toLowerCase();
  
  for (const make of makes) {
    if (titleLower.includes(make.toLowerCase())) {
      // Try to extract model (word after make)
      const regex = new RegExp(`${make}\\s+(\\w+)`, 'i');
      const match = title.match(regex);
      return {
        make,
        model: match ? match[1] : undefined,
      };
    }
  }
  
  return {};
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { searchId, label, searchUrl, sourceSite, maxPages } = await req.json();
    
    console.log(`Running saved search: ${label} (${searchId})`);
    console.log(`URL: ${searchUrl}, Source: ${sourceSite}, Max Pages: ${maxPages}`);
    
    if (!searchUrl) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No search URL provided',
          listingsFound: 0,
          runLog: {
            fetchedUrl: '',
            httpStatus: 0,
            responseSize: 0,
            htmlPreview: 'No URL provided',
            listingUrlsSample: [],
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const allListings: ParsedListing[] = [];
    let currentUrl = searchUrl;
    let pagesProcessed = 0;
    const maxPagesToFetch = maxPages || 2;
    
    // Track diagnostics from first page fetch
    let firstFetchStatus = 0;
    let firstFetchSize = 0;
    let firstFetchHtmlPreview = '';
    let wasRedirected = false;
    
    while (pagesProcessed < maxPagesToFetch) {
      const fetchResult = await fetchPage(currentUrl);
      
      // Store first page diagnostics
      if (pagesProcessed === 0) {
        firstFetchStatus = fetchResult.status;
        firstFetchSize = fetchResult.body?.length || 0;
        wasRedirected = fetchResult.redirected;
        
        if (fetchResult.body) {
          firstFetchHtmlPreview = sanitizeHtmlPreview(fetchResult.body);
        } else if (fetchResult.redirected) {
          firstFetchHtmlPreview = 'blocked/redirected';
        } else if (fetchResult.status === 403) {
          firstFetchHtmlPreview = 'blocked (403 Forbidden)';
        } else if (fetchResult.status === 404) {
          firstFetchHtmlPreview = 'not found (404)';
        } else {
          firstFetchHtmlPreview = `fetch failed (status: ${fetchResult.status})`;
        }
      }
      
      if (!fetchResult.body) {
        console.log(`Failed to fetch page ${pagesProcessed + 1}, stopping`);
        break;
      }
      
      // Parse based on source site
      let pageListings: ParsedListing[];
      if (sourceSite === 'Pickles') {
        pageListings = parsePicklesListings(fetchResult.body, currentUrl);
      } else if (sourceSite === 'Manheim') {
        pageListings = parseManheimListings(fetchResult.body, currentUrl);
      } else {
        pageListings = parseGenericListings(fetchResult.body, currentUrl);
      }
      
      console.log(`Page ${pagesProcessed + 1}: Found ${pageListings.length} listings`);
      
      // Enrich with make/model from title
      for (const listing of pageListings) {
        const { make, model } = parseMakeModel(listing.title);
        listing.make = make;
        listing.model = model;
      }
      
      const prevCount = allListings.length;
      
      // Dedupe by URL
      for (const listing of pageListings) {
        if (!allListings.some(l => l.listing_url === listing.listing_url)) {
          allListings.push(listing);
        }
      }
      
      const newCount = allListings.length - prevCount;
      console.log(`Added ${newCount} new unique listings`);
      
      // Stop if no new listings found (reached end or duplicates)
      if (newCount === 0) {
        console.log('No new listings found, stopping pagination');
        break;
      }
      
      pagesProcessed++;
      
      // Try to find next page link
      if (pagesProcessed < maxPagesToFetch) {
        const nextPageMatch = fetchResult.body.match(/href="([^"]*(?:page=|p=|offset=)[^"]*)"/i) ||
                              fetchResult.body.match(/<a[^>]*class="[^"]*next[^"]*"[^>]*href="([^"]*)"/i);
        
        if (nextPageMatch) {
          let nextUrl = nextPageMatch[1];
          if (nextUrl.startsWith('/')) {
            try {
              const base = new URL(currentUrl);
              nextUrl = `${base.protocol}//${base.host}${nextUrl}`;
            } catch {
              break;
            }
          }
          currentUrl = nextUrl;
        } else {
          // Try incrementing page number in URL
          const pageNumMatch = currentUrl.match(/(page=|p=)(\d+)/i);
          if (pageNumMatch) {
            const nextNum = parseInt(pageNumMatch[2]) + 1;
            currentUrl = currentUrl.replace(pageNumMatch[0], `${pageNumMatch[1]}${nextNum}`);
          } else {
            break;
          }
        }
      }
    }
    
    console.log(`Total unique listings found: ${allListings.length}`);
    
    // Build run log
    const runLog: RunLog = {
      fetchedUrl: searchUrl,
      httpStatus: firstFetchStatus,
      responseSize: firstFetchSize,
      htmlPreview: firstFetchHtmlPreview,
      listingUrlsSample: allListings.slice(0, 10).map(l => l.listing_url),
    };
    
    // Determine success based on whether we got any data
    const success = firstFetchStatus === 200 || allListings.length > 0;
    
    const result: RunResult = {
      success,
      searchId,
      label,
      listings: allListings,
      added: 0,
      updated: 0,
      httpStatus: firstFetchStatus,
      listingsFound: allListings.length,
      runLog,
      error: success ? undefined : (wasRedirected ? 'Page redirected (likely blocked)' : `HTTP ${firstFetchStatus}`),
    };
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error running saved search:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        listings: [],
        added: 0,
        updated: 0,
        httpStatus: 0,
        listingsFound: 0,
        runLog: {
          fetchedUrl: '',
          httpStatus: 0,
          responseSize: 0,
          htmlPreview: `Error: ${errorMessage}`,
          listingUrlsSample: [],
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
