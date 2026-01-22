import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Known dealer platforms that we can scrape directly
const SCRAPEABLE_DOMAINS = [
  'carsales.com.au',
  'autotrader.com.au',
  'drive.com.au',
  'gumtree.com.au',
  'facebook.com/marketplace',
  'dealersolutions.com.au',
  'auto-it.com.au',
  'gforces.com.au',
  'dealerify.com.au',
  'motoring.com.au',
  'redbook.com.au',
];

// URL patterns that indicate inventory pages
const INVENTORY_PATTERNS = [
  /\/used-cars/i,
  /\/new-cars/i,
  /\/inventory/i,
  /\/stock/i,
  /\/vehicles/i,
  /\/search/i,
  /\/cars-for-sale/i,
  /\/our-range/i,
  /\/showroom/i,
];

// URL patterns that indicate detail pages
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
    for (const pattern of INVENTORY_PATTERNS) {
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
  // Check if domain matches known scrapeable platforms
  const isScrapeable = SCRAPEABLE_DOMAINS.some(d => domain.includes(d));
  
  if (isScrapeable) {
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
  
  return {
    raw: rawUrl,
    canonical,
    domain,
    dealerSlug,
    intent,
    method,
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

    const result = {
      submission_id: submission.id,
      urls_processed: parsedUrls.length,
      urls_accepted: newUrls.length,
      urls_duplicate: duplicateCount,
      urls_queued_scrape: newUrls.filter(u => u.method === 'scrape').length,
      urls_queued_firecrawl: newUrls.filter(u => u.method === 'firecrawl').length,
      urls_manual_review: newUrls.filter(u => u.method === 'manual_review').length,
      classified_urls: newUrls.map(u => ({
        url: u.canonical,
        dealer_slug: u.dealerSlug,
        intent: u.intent,
        method: u.method,
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
