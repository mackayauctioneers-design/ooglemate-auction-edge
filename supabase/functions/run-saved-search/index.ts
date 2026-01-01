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

interface RunResult {
  success: boolean;
  searchId: string;
  label: string;
  listings: ParsedListing[];
  added: number;
  updated: number;
  error?: string;
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

// Parse Pickles-style listings
function parsePicklesListings(html: string, baseUrl: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  
  // Look for listing cards - Pickles uses various patterns
  // Pattern 1: href containing /item/ or /lot/
  const linkPattern = /href="([^"]*(?:\/item\/|\/lot\/|\/cars\/|\/trucks\/)[^"]*)"/gi;
  const links = [...html.matchAll(linkPattern)];
  
  const seenUrls = new Set<string>();
  
  for (const linkMatch of links) {
    let url = linkMatch[1];
    
    // Make absolute URL
    if (url.startsWith('/')) {
      try {
        const base = new URL(baseUrl);
        url = `${base.protocol}//${base.host}${url}`;
      } catch {
        continue;
      }
    }
    
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    
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
    
    // Extract lot ID from URL
    let lotId: string | undefined;
    const lotIdMatch = url.match(/(?:\/item\/|\/lot\/|id=)(\d+)/i);
    if (lotIdMatch) {
      lotId = lotIdMatch[1];
    }
    
    const fullText = stripHtml(context);
    
    listings.push({
      listing_url: url,
      title: title || 'Unknown Vehicle',
      year: extractYear(fullText),
      km: extractKm(fullText),
      price: extractPrice(fullText),
      lot_id: lotId,
    });
  }
  
  return listings;
}

// Parse Manheim-style listings
function parseManheimListings(html: string, baseUrl: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  
  // Manheim patterns - look for vehicle cards
  const linkPattern = /href="([^"]*(?:\/vehicle\/|\/lot\/|\/stock\/)[^"]*)"/gi;
  const links = [...html.matchAll(linkPattern)];
  
  const seenUrls = new Set<string>();
  
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
    
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    
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
    
    let lotId: string | undefined;
    const lotIdMatch = url.match(/(?:\/vehicle\/|\/lot\/|\/stock\/|id=)(\w+)/i);
    if (lotIdMatch) {
      lotId = lotIdMatch[1];
    }
    
    const fullText = stripHtml(context);
    
    listings.push({
      listing_url: url,
      title: title || 'Unknown Vehicle',
      year: extractYear(fullText),
      km: extractKm(fullText),
      price: extractPrice(fullText),
      lot_id: lotId,
    });
  }
  
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
  
  return listings;
}

// Fetch a page with timeout
async function fetchPage(url: string, timeoutMs = 10000): Promise<string | null> {
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
    
    if (!response.ok) {
      console.log(`Fetch failed with status: ${response.status}`);
      return null;
    }
    
    const text = await response.text();
    console.log(`Fetched ${text.length} bytes`);
    return text;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`Fetch error: ${error}`);
    return null;
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
        JSON.stringify({ success: false, error: 'No search URL provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const allListings: ParsedListing[] = [];
    let currentUrl = searchUrl;
    let pagesProcessed = 0;
    const maxPagesToFetch = maxPages || 2;
    
    while (pagesProcessed < maxPagesToFetch) {
      const html = await fetchPage(currentUrl);
      
      if (!html) {
        console.log(`Failed to fetch page ${pagesProcessed + 1}, stopping`);
        break;
      }
      
      // Parse based on source site
      let pageListings: ParsedListing[];
      if (sourceSite === 'Pickles') {
        pageListings = parsePicklesListings(html, currentUrl);
      } else if (sourceSite === 'Manheim') {
        pageListings = parseManheimListings(html, currentUrl);
      } else {
        pageListings = parseGenericListings(html, currentUrl);
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
        const nextPageMatch = html.match(/href="([^"]*(?:page=|p=|offset=)[^"]*)"/i) ||
                              html.match(/<a[^>]*class="[^"]*next[^"]*"[^>]*href="([^"]*)"/i);
        
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
    
    const result: RunResult = {
      success: true,
      searchId,
      label,
      listings: allListings,
      added: 0,
      updated: 0,
    };
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error running saved search:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        listings: [],
        added: 0,
        updated: 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
