import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// URL classification for Grok vs API routing
type UrlClass = 'grok_safe' | 'api_only' | 'invalid';

// Domains that should ONLY use API/scraper pipelines (not Grok)
const API_ONLY_DOMAINS = [
  'pickles.com.au',
  'manheim.com.au',
  'grays.com',
  'graysonline.com',
  'lloydsauctions.com.au',
  'slattery.com.au',
  'turners.com.au',
];

// Grok-safe marketplace/dealer domains
const GROK_SAFE_DOMAINS = [
  'carsales.com.au',
  'autotrader.com.au',
  'drive.com.au',
  'gumtree.com.au',
  'facebook.com/marketplace',
  'carma.com.au',
  'easyauto123.com.au',  // WA dealer network - confirmed Grok-safe
  'dealersolutions.com.au',
  'auto-it.com.au',
  'gforces.com.au',
  'dealerify.com.au',
  'motoring.com.au',
  'redbook.com.au',
];

// Patterns that indicate a valid inventory/search page (Grok can read)
const VALID_SEARCH_PATTERNS = [
  /\/used-cars/i,
  /\/new-cars/i,
  /\/inventory/i,
  /\/stock/i,
  /\/vehicles/i,
  /\/search/i,
  /\/cars-for-sale/i,
  /\/our-range/i,
  /\/showroom/i,
  /\/used\/search/i,
  /[?&]make=/i,
  /[?&]model=/i,
];

// Patterns that indicate lemon/dead pages
const LEMON_PATTERNS = [
  /\/page-not-found/i,
  /\/404/i,
  /\/error/i,
  /\/expired/i,
  // Pickles fake slug patterns (guessed URLs that don't exist)
  /pickles\.com\.au\/cars\/[a-z]+-[a-z]+-[a-z]+-\d{4}$/i,
  /pickles\.com\.au\/used\/[a-z]+-[a-z]+$/i,
];

// Patterns that indicate HOMEPAGE (not inventory) - should be rejected for Grok
const HOMEPAGE_PATTERNS = [
  /^https?:\/\/[^\/]+\/?$/i,          // Just domain with optional trailing slash
  /^https?:\/\/[^\/]+\/about/i,       // About pages
  /^https?:\/\/[^\/]+\/contact/i,     // Contact pages
  /^https?:\/\/[^\/]+\/service/i,     // Service pages
  /^https?:\/\/[^\/]+\/finance/i,     // Finance pages
  /^https?:\/\/[^\/]+\/blog/i,        // Blog pages
  /^https?:\/\/[^\/]+\/news/i,        // News pages
  /^https?:\/\/[^\/]+\/team/i,        // Team pages
  /^https?:\/\/[^\/]+\/careers/i,     // Careers pages
];

// Auction detail patterns - API only, not Grok
const AUCTION_DETAIL_PATTERNS = [
  /pickles\.com\.au\/used\/details/i,
  /pickles\.com\.au\/lot\//i,
  /manheim\.com\.au\/lot\//i,
  /grays\.com\/lot\//i,
];

// URL patterns that indicate detail pages (for scraping, not Grok search)
const DETAIL_PATTERNS = [
  /\/vehicle\/\d+/i,
  /\/details\//i,
  /\/car\/\d+/i,
  /\/listing\//i,
  /\/item\/\d+/i,
  /[?&]id=\d+/i,
];

interface ParsedUrl {
  raw: string;
  canonical: string;
  domain: string;
  dealerSlug: string;
  intent: 'dealer_home' | 'inventory_search' | 'inventory_detail' | 'unknown';
  method: 'scrape' | 'firecrawl' | 'manual_review';
  grokClass: UrlClass; // grok_safe, api_only, or invalid
}

function normalizeUrl(rawUrl: string): string {
  try {
    let url = rawUrl.trim();
    
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    const parsed = new URL(url);
    
    // Force lowercase host
    parsed.hostname = parsed.hostname.toLowerCase();
    
    // Prefer https
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
    }
    
    // Remove tracking params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source'];
    trackingParams.forEach(param => parsed.searchParams.delete(param));
    
    // Remove trailing slash from pathname
    if (parsed.pathname.endsWith('/') && parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    
    return parsed.toString();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function generateDealerSlug(domain: string, pathname: string): string {
  // Try to extract meaningful dealer name from domain or path
  const cleanDomain = domain.replace(/^www\./, '').replace(/\.com\.au$|\.com$|\.net\.au$|\.net$/, '');
  
  // Convert to slug format
  const slug = cleanDomain
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  
  return slug || 'unknown-dealer';
}

// Classify URL for Grok routing - STRICT: only inventory pages are grok_safe
function classifyUrlForGrok(url: string, domain: string): UrlClass {
  try {
    const fullPath = new URL(url).pathname + new URL(url).search;
    
    // Check for lemon/dead pages first
    for (const pattern of LEMON_PATTERNS) {
      if (pattern.test(url)) {
        console.log(`[classifyUrlForGrok] ${url} -> invalid (lemon pattern)`);
        return 'invalid';
      }
    }
    
    // Check for homepage patterns - NOT grok_safe (must have inventory path)
    for (const pattern of HOMEPAGE_PATTERNS) {
      if (pattern.test(url)) {
        console.log(`[classifyUrlForGrok] ${url} -> invalid (homepage, not inventory)`);
        return 'invalid';
      }
    }
    
    // Check for auction detail pages - API only
    for (const pattern of AUCTION_DETAIL_PATTERNS) {
      if (pattern.test(url)) {
        console.log(`[classifyUrlForGrok] ${url} -> api_only (auction detail)`);
        return 'api_only';
      }
    }
    
    // Check if domain is API-only (auctions)
    const isApiOnly = API_ONLY_DOMAINS.some(d => domain.includes(d));
    if (isApiOnly) {
      // Exception: auction search pages CAN go to Grok for discovery
      const hasValidSearch = VALID_SEARCH_PATTERNS.some(p => p.test(fullPath));
      if (hasValidSearch) {
        console.log(`[classifyUrlForGrok] ${url} -> grok_safe (auction search page)`);
        return 'grok_safe';
      }
      console.log(`[classifyUrlForGrok] ${url} -> api_only (auction domain)`);
      return 'api_only';
    }
    
    // STRICT: Only mark as grok_safe if URL has clear inventory patterns
    // This prevents homepages and guessed slugs from being sent to Grok
    const hasInventory = VALID_SEARCH_PATTERNS.some(p => p.test(fullPath));
    if (hasInventory) {
      console.log(`[classifyUrlForGrok] ${url} -> grok_safe (inventory pattern matched)`);
      return 'grok_safe';
    }
    
    // Check if domain is known Grok-safe marketplace
    const isGrokSafeMarketplace = GROK_SAFE_DOMAINS.some(d => domain.includes(d));
    if (isGrokSafeMarketplace && fullPath.length > 1) {
      // Known marketplace with a path - worth trying
      console.log(`[classifyUrlForGrok] ${url} -> grok_safe (known marketplace with path)`);
      return 'grok_safe';
    }
    
    // DEFAULT: Unknown dealer URLs without inventory patterns -> INVALID for Grok
    // This prevents hallucinations from guessed/homepage URLs
    console.log(`[classifyUrlForGrok] ${url} -> invalid (no inventory pattern, not a known marketplace)`);
    return 'invalid';
  } catch {
    return 'invalid';
  }
}

function classifyIntent(url: string): 'dealer_home' | 'inventory_search' | 'inventory_detail' | 'unknown' {
  try {
    const parsed = new URL(url);
    const fullPath = parsed.pathname + parsed.search;
    
    // Check for detail patterns first (more specific)
    for (const pattern of DETAIL_PATTERNS) {
      if (pattern.test(fullPath)) {
        return 'inventory_detail';
      }
    }
    
    // Check for inventory/search patterns
    for (const pattern of VALID_SEARCH_PATTERNS) {
      if (pattern.test(fullPath)) {
        return 'inventory_search';
      }
    }
    
    // If it's just the root or a simple path, it's likely the home page
    if (parsed.pathname === '/' || parsed.pathname.split('/').filter(Boolean).length <= 1) {
      return 'dealer_home';
    }
    
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function classifyMethod(domain: string, intent: string): 'scrape' | 'firecrawl' | 'manual_review' {
  // Check if domain matches known Grok-safe platforms
  const isGrokSafe = GROK_SAFE_DOMAINS.some(d => domain.includes(d));
  
  if (isGrokSafe) {
    return 'scrape';
  }
  
  // If it's an inventory page on unknown platform, try firecrawl
  if (intent === 'inventory_search' || intent === 'inventory_detail') {
    return 'firecrawl';
  }
  
  // For dealer home pages, use firecrawl to discover inventory URLs
  if (intent === 'dealer_home') {
    return 'firecrawl';
  }
  
  // Unknown intent on unknown platform = manual review
  return 'manual_review';
}

function parseUrl(rawUrl: string): ParsedUrl {
  const canonical = normalizeUrl(rawUrl);
  const domain = extractDomain(canonical);
  const pathname = new URL(canonical).pathname;
  const dealerSlug = generateDealerSlug(domain, pathname);
  const intent = classifyIntent(canonical);
  const method = classifyMethod(domain, intent);
  const grokClass = classifyUrlForGrok(canonical, domain);
  
  return {
    raw: rawUrl,
    canonical,
    domain,
    dealerSlug,
    intent,
    method,
    grokClass,
  };
}

function extractUrlsFromText(text: string): string[] {
  // Split by whitespace and newlines, then filter for URL-like strings
  const parts = text.split(/[\s\n\r]+/);
  const urls: string[] = [];
  const seen = new Set<string>();
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // Check if it looks like a URL
    if (trimmed.includes('.') && (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('www.') ||
      /^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)
    )) {
      const normalized = trimmed.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(trimmed);
      }
    }
  }
  
  console.log(`[extractUrls] Found ${urls.length} URLs from text`);
  return urls;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { urls, raw_text, notes, submitted_by = 'dave' } = body;

    // Extract URLs from raw text or use provided array
    let urlList: string[] = [];
    if (raw_text) {
      urlList = extractUrlsFromText(raw_text);
    } else if (urls && Array.isArray(urls)) {
      urlList = urls;
    } else if (typeof urls === 'string') {
      urlList = extractUrlsFromText(urls);
    }

    if (urlList.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid URLs found in input' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[submit-dealer-urls] Processing ${urlList.length} URLs`);

    // Parse and classify all URLs
    const parsedUrls = urlList.map(parseUrl);

    // Check for existing URLs to avoid duplicates
    const canonicalUrls = parsedUrls.map(p => p.canonical);
    const { data: existing } = await supabase
      .from('dealer_url_queue')
      .select('url_canonical')
      .in('url_canonical', canonicalUrls);

    const existingSet = new Set((existing || []).map(e => e.url_canonical));

    // Filter out duplicates
    const newUrls = parsedUrls.filter(p => !existingSet.has(p.canonical));
    const duplicateCount = parsedUrls.length - newUrls.length;

    // Create submission record
    const { data: submission, error: submissionError } = await supabase
      .from('dealer_url_submissions')
      .insert({
        submitted_by,
        raw_text: raw_text || urls?.join('\n'),
        notes,
        urls_accepted: newUrls.length,
        urls_duplicate: duplicateCount,
        urls_queued_scrape: newUrls.filter(u => u.method === 'scrape').length,
        urls_queued_firecrawl: newUrls.filter(u => u.method === 'firecrawl').length,
        urls_manual_review: newUrls.filter(u => u.method === 'manual_review').length,
      })
      .select()
      .single();

    if (submissionError) {
      console.error('[submit-dealer-urls] Submission error:', submissionError);
      throw submissionError;
    }

    // Insert queue items
    if (newUrls.length > 0) {
      const queueItems = newUrls.map(parsed => ({
        submission_id: submission.id,
        url_raw: parsed.raw,
        url_canonical: parsed.canonical,
        domain: parsed.domain,
        dealer_slug: parsed.dealerSlug,
        intent: parsed.intent,
        method: parsed.method,
        grok_class: parsed.grokClass, // grok_safe, api_only, invalid
        priority: 'normal',
        status: 'queued',
      }));

      const { error: queueError } = await supabase
        .from('dealer_url_queue')
        .insert(queueItems);

      if (queueError) {
        console.error('[submit-dealer-urls] Queue insert error:', queueError);
        throw queueError;
      }
    }

    // Count by Grok class
    const grokSafeCount = newUrls.filter(u => u.grokClass === 'grok_safe').length;
    const apiOnlyCount = newUrls.filter(u => u.grokClass === 'api_only').length;
    const invalidCount = newUrls.filter(u => u.grokClass === 'invalid').length;

    const result = {
      submission_id: submission.id,
      urls_processed: parsedUrls.length,
      urls_accepted: newUrls.length,
      urls_duplicate: duplicateCount,
      urls_queued_scrape: newUrls.filter(u => u.method === 'scrape').length,
      urls_queued_firecrawl: newUrls.filter(u => u.method === 'firecrawl').length,
      urls_manual_review: newUrls.filter(u => u.method === 'manual_review').length,
      urls_grok_safe: grokSafeCount,
      urls_api_only: apiOnlyCount,
      urls_invalid: invalidCount,
      classified_urls: newUrls.map(u => ({
        url: u.canonical,
        dealer_slug: u.dealerSlug,
        intent: u.intent,
        method: u.method,
        grok_class: u.grokClass,
      })),
    };

    console.log(`[submit-dealer-urls] Complete:`, result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[submit-dealer-urls] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
