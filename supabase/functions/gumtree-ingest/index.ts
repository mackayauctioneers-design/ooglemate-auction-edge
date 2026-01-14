import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GumtreeListing {
  source_listing_id: string;
  listing_url: string;
  year: number;
  make: string;
  model: string;
  variant_raw?: string;
  km?: number;
  asking_price: number;
  state: string;
  suburb?: string;
}

// Parse Gumtree listings from markdown content
function parseGumtreeMarkdown(markdown: string, yearMin: number): GumtreeListing[] {
  const listings: GumtreeListing[] = [];
  
  // Split by listing blocks - each starts with image link patterns
  // Pattern: [![Title](image_url)...](listing_url)
  const listingBlocks = markdown.split(/\[!\[/g).filter(block => block.includes("gumtree.com.au/s-ad/"));
  
  for (const block of listingBlocks) {
    try {
      // Extract listing URL - pattern: ](https://www.gumtree.com.au/s-ad/.../123456789)
      const urlMatch = block.match(/\]\((https:\/\/www\.gumtree\.com\.au\/s-ad\/[^)]+\/(\d+))\)/);
      if (!urlMatch) continue;
      
      const listingUrl = urlMatch[1];
      const adId = urlMatch[2];
      
      // Extract title - pattern: Top2024 Toyota Corolla or just 2024 Toyota Corolla
      // Title appears after image URLs, before the specs
      const titleMatch = block.match(/(?:Top|Featured|Urgent)?(\d{4})\s+([A-Za-z-]+)\s+([A-Za-z0-9]+)(?:\s+([A-Za-z0-9-]+))?/);
      if (!titleMatch) continue;
      
      const [, yearStr, make, model, variant] = titleMatch;
      const year = parseInt(yearStr, 10);
      
      // Skip if year < yearMin
      if (year < yearMin) continue;
      
      // Extract km - pattern: - 70055 km
      const kmMatch = block.match(/[\-•]\s*([\d,]+)\s*km/i);
      const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, ''), 10) : undefined;
      
      // Extract price - pattern: $18,977 or $28,490
      const priceMatch = block.match(/\$([\d,]+)/);
      if (!priceMatch) continue;
      const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      if (price < 1000 || price > 500000) continue;
      
      // Extract location - pattern: Victoria Park, WA•3m
      const locationMatch = block.match(/([A-Za-z\s]+),\s*([A-Z]{2,3})•/);
      const state = locationMatch ? locationMatch[2].toUpperCase() : 'AU';
      const suburb = locationMatch ? locationMatch[1].trim() : undefined;
      
      listings.push({
        source_listing_id: adId,
        listing_url: listingUrl,
        year,
        make: make.toUpperCase().replace(/-/g, ' '),
        model: model.toUpperCase(),
        variant_raw: variant?.toUpperCase() || undefined,
        km,
        asking_price: price,
        state,
        suburb,
      });
    } catch (err) {
      console.error('Error parsing listing block:', err);
      continue;
    }
  }
  
  return listings;
}

// Alternative parser for HTML structure
function parseGumtreeHtml(html: string, yearMin: number): GumtreeListing[] {
  const listings: GumtreeListing[] = [];
  
  // Look for ad card patterns in React HTML
  // Pattern: href="/s-ad/suburb/category/title/12345678"
  const adPatterns = html.matchAll(/href="(\/s-ad\/[^"]+\/(\d{10,}))"[^>]*>[\s\S]*?(\d{4})\s+([A-Za-z-]+)\s+([A-Za-z0-9]+)/gi);
  
  for (const match of adPatterns) {
    try {
      const [, path, adId, yearStr, make, model] = match;
      const year = parseInt(yearStr, 10);
      
      if (year < yearMin) continue;
      
      // Find price nearby
      const priceMatch = html.slice(match.index || 0, (match.index || 0) + 2000).match(/\$([\d,]+)/);
      if (!priceMatch) continue;
      const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      if (price < 1000) continue;
      
      // Find km nearby
      const kmMatch = html.slice(match.index || 0, (match.index || 0) + 1000).match(/([\d,]+)\s*km/i);
      const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, ''), 10) : undefined;
      
      // Extract state from URL
      const stateMatch = path.match(/\/s-ad\/[^\/]+\/([a-z]{2,3})\//i);
      const state = stateMatch ? stateMatch[1].toUpperCase() : 'AU';
      
      listings.push({
        source_listing_id: adId,
        listing_url: `https://www.gumtree.com.au${path}`,
        year,
        make: make.toUpperCase(),
        model: model.toUpperCase(),
        km,
        asking_price: price,
        state,
      });
    } catch {
      continue;
    }
  }
  
  return listings;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      throw new Error("FIRECRAWL_API_KEY not configured");
    }

    const body = await req.json().catch(() => ({}));
    const { 
      make = null, 
      model = null,
      state = null,
      page = 1,
      year_min = 2016,
      limit = 50 
    } = body;

    // Build Gumtree search URL using cleaner path-based format
    let searchUrl = "https://www.gumtree.com.au/s-cars-vans-utes";
    const pathParts: string[] = [];
    const queryParams = new URLSearchParams();
    
    if (make) pathParts.push(`carmake-${make.toLowerCase().replace(/\s+/g, '')}`);
    if (state) pathParts.push(state.toLowerCase());
    
    if (pathParts.length > 0) {
      searchUrl += `/${pathParts.join('/')}/c18320`;
    } else {
      searchUrl += "/c18320";
    }
    
    queryParams.append("caryearfrom1", year_min.toString());
    if (page > 1) queryParams.append("page", page.toString());
    
    searchUrl += `?${queryParams.toString()}`;

    console.log(`Scraping Gumtree: ${searchUrl}`);

    // Use Firecrawl to scrape search results
    const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ["markdown", "html"],
        waitFor: 5000,
        onlyMainContent: false,
      }),
    });

    if (!scrapeResponse.ok) {
      const errorData = await scrapeResponse.json();
      throw new Error(`Firecrawl error: ${errorData.error || scrapeResponse.status}`);
    }

    const scrapeData = await scrapeResponse.json();
    const html = scrapeData.data?.html || scrapeData.html || "";
    const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";

    console.log(`Received ${markdown.length} chars markdown, ${html.length} chars HTML`);

    // Parse listings from markdown first (more reliable)
    let listings = parseGumtreeMarkdown(markdown, year_min);
    
    // Fallback to HTML parsing if markdown yields nothing
    if (listings.length === 0) {
      console.log("Markdown parsing found 0, trying HTML...");
      listings = parseGumtreeHtml(html, year_min);
    }

    console.log(`Found ${listings.length} listings on page ${page}`);

    // Upsert each listing
    const results = {
      total_found: listings.length,
      new_listings: 0,
      updated_listings: 0,
      price_changes: 0,
      evaluations_triggered: 0,
      errors: 0,
      sample_listings: [] as string[],
    };

    for (const listing of listings.slice(0, limit)) {
      try {
        const { data, error } = await supabase.rpc("upsert_retail_listing", {
          p_source: "gumtree",
          p_source_listing_id: listing.source_listing_id,
          p_listing_url: listing.listing_url,
          p_year: listing.year,
          p_make: listing.make,
          p_model: listing.model,
          p_variant_raw: listing.variant_raw || null,
          p_variant_family: null,
          p_km: listing.km || null,
          p_asking_price: listing.asking_price,
          p_state: listing.state,
          p_suburb: listing.suburb || null,
        });

        if (error) {
          console.error(`Error upserting listing ${listing.source_listing_id}:`, error.message);
          results.errors++;
          continue;
        }

        const result = data?.[0] || data;
        if (result?.is_new) {
          results.new_listings++;
          if (results.sample_listings.length < 5) {
            results.sample_listings.push(`${listing.year} ${listing.make} ${listing.model} @ $${listing.asking_price}`);
          }
        } else {
          results.updated_listings++;
        }
        if (result?.price_changed) results.price_changes++;
        if (result?.evaluation_result) results.evaluations_triggered++;
      } catch (err) {
        console.error(`Error processing listing:`, err);
        results.errors++;
      }
    }

    // Log to cron_audit_log
    await supabase.from("cron_audit_log").insert({
      cron_name: "gumtree-ingest",
      success: true,
      result: results,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("Gumtree ingest complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Gumtree ingest error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "gumtree-ingest",
      success: false,
      error: errorMsg,
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
