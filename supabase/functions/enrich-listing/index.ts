import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Listing Enrichment Worker
 * 
 * Claims queued enrichment jobs and extracts structured data:
 * - badge/trim (e.g. ELITE vs PREMIUM)
 * - body type (hatch/sedan/wagon/cab chassis)
 * - engine family + size (V8/4cyl, 2.0/2.8/4.5)
 * - fuel + transmission
 * 
 * Data sources:
 * 1. Existing listing fields (title, description, variant)
 * 2. Variant extraction rules from DB
 * 3. Optional: Firecrawl scrape for Autotrader/Drive pages
 */

interface VariantRule {
  make: string | null;
  model: string | null;
  pattern: string;
  field_name: string;
  field_value: string;
  priority: number;
}

interface EnrichmentResult {
  badge: string | null;
  body_type: string | null;
  engine_family: string | null;
  engine_size_l: number | null;
  fuel_type: string | null;
  transmission: string | null;
  drivetrain: string | null;
  series_code: string | null;
  enrichment_status: 'ok' | 'partial' | 'failed';
  enrichment_source: string;
  enrichment_errors: string | null;
}

// Time budget for worker (25s to leave buffer)
const TIME_BUDGET_MS = 25000;
const LOCK_DURATION_MS = 30000;
const MAX_RETRIES = 3;

// Apply variant extraction rules to text
function applyRules(
  text: string,
  rules: VariantRule[],
  make: string | null,
  model: string | null
): Record<string, string> {
  const results: Record<string, { value: string; priority: number }> = {};
  const upperText = text.toUpperCase();
  const upperMake = (make || '').toUpperCase();
  const upperModel = (model || '').toUpperCase();
  
  for (const rule of rules) {
    // Check if rule applies to this make/model
    const ruleApplies = 
      !rule.make || rule.make === '*' || 
      rule.make.toUpperCase() === upperMake;
    
    const modelApplies = 
      !rule.model || 
      rule.model.toUpperCase() === upperModel;
    
    if (!ruleApplies || !modelApplies) continue;
    
    try {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(upperText)) {
        // Only update if higher priority or not yet set
        const existing = results[rule.field_name];
        if (!existing || rule.priority > existing.priority) {
          results[rule.field_name] = { value: rule.field_value, priority: rule.priority };
        }
      }
    } catch (e) {
      console.error(`Invalid regex pattern: ${rule.pattern}`, e);
    }
  }
  
  // Convert to simple key-value
  const final: Record<string, string> = {};
  for (const [key, { value }] of Object.entries(results)) {
    final[key] = value;
  }
  return final;
}

// Extract additional fields from structured data (JSON-LD, Autotrader DOM)
function extractFromStructuredData(markdown: string): Record<string, string> {
  const results: Record<string, string> = {};
  
  // Try to find JSON-LD blocks
  const jsonLdMatch = markdown.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const jsonData = JSON.parse(jsonLdMatch[1]);
      if (jsonData.vehicleEngine) {
        results.engine_size_l = jsonData.vehicleEngine;
      }
      if (jsonData.fuelType) {
        results.fuel_type = jsonData.fuelType.toUpperCase();
      }
      if (jsonData.vehicleTransmission) {
        results.transmission = jsonData.vehicleTransmission.toUpperCase();
      }
      if (jsonData.bodyType) {
        results.body_type = jsonData.bodyType.toUpperCase();
      }
    } catch (e) {
      // JSON parse failed, skip
    }
  }
  
  // Autotrader specific patterns
  if (markdown.includes('autotrader.com.au')) {
    // Engine spec pattern
    const engineMatch = markdown.match(/Engine[:\s]*(\d+\.?\d*)\s*L/i);
    if (engineMatch) {
      results.engine_size_l = engineMatch[1];
    }
    
    // Body type pattern
    const bodyMatch = markdown.match(/Body Type[:\s]*(\w+)/i);
    if (bodyMatch) {
      results.body_type = bodyMatch[1].toUpperCase();
    }
    
    // Transmission pattern
    const transMatch = markdown.match(/Transmission[:\s]*(\w+)/i);
    if (transMatch) {
      results.transmission = transMatch[1].toUpperCase();
    }
    
    // Fuel pattern
    const fuelMatch = markdown.match(/Fuel Type[:\s]*(\w+)/i);
    if (fuelMatch) {
      results.fuel_type = fuelMatch[1].toUpperCase();
    }
  }
  
  return results;
}

// Enrich a single listing
async function enrichListing(
  supabase: any,
  listingId: string,
  rules: VariantRule[],
  firecrawlKey: string | undefined
): Promise<EnrichmentResult> {
  // Fetch listing
  const { data: listing, error: listingError } = await supabase
    .from('retail_listings')
    .select('id, make, model, variant_raw, title, description, listing_url, source')
    .eq('id', listingId)
    .single();
  
  if (listingError || !listing) {
    return {
      badge: null,
      body_type: null,
      engine_family: null,
      engine_size_l: null,
      fuel_type: null,
      transmission: null,
      drivetrain: null,
      series_code: null,
      enrichment_status: 'failed',
      enrichment_source: 'none',
      enrichment_errors: `Listing not found: ${listingError?.message || 'unknown'}`,
    };
  }
  
  // Build text blob from all available fields
  const textBlob = [
    listing.title || '',
    listing.description || '',
    listing.variant_raw || '',
    listing.listing_url || '',
  ].join(' ');
  
  // Apply variant rules
  const extractedFields = applyRules(textBlob, rules, listing.make, listing.model);
  
  // Try Firecrawl scrape for Autotrader/Drive if we have the key and URL
  let scrapedFields: Record<string, string> = {};
  let enrichmentSource = 'variant_rules';
  
  if (firecrawlKey && listing.listing_url) {
    const isAutotrader = listing.listing_url.includes('autotrader.com.au');
    const isDrive = listing.listing_url.includes('drive.com.au');
    
    if (isAutotrader || isDrive) {
      try {
        const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: listing.listing_url,
            formats: ['markdown'],
            onlyMainContent: true,
            waitFor: 1000,
          }),
        });
        
        if (scrapeRes.ok) {
          const scrapeData = await scrapeRes.json();
          const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';
          scrapedFields = extractFromStructuredData(markdown);
          
          // Also apply rules to scraped content
          const scrapedExtracted = applyRules(markdown, rules, listing.make, listing.model);
          scrapedFields = { ...scrapedFields, ...scrapedExtracted };
          
          enrichmentSource = isAutotrader ? 'autotrader_firecrawl' : 'drive_firecrawl';
        }
      } catch (e) {
        console.error(`Firecrawl scrape failed for ${listing.listing_url}:`, e);
      }
    }
  }
  
  // Merge extracted fields (scraped takes priority)
  const finalFields = { ...extractedFields, ...scrapedFields };
  
  // Determine enrichment status
  const hasCore = Boolean(
    finalFields.engine_family || finalFields.body_type || finalFields.badge
  );
  const hasFull = Boolean(
    (finalFields.engine_family || finalFields.engine_size_l) &&
    finalFields.body_type &&
    finalFields.fuel_type
  );
  
  let status: 'ok' | 'partial' | 'failed' = 'failed';
  if (hasFull) {
    status = 'ok';
  } else if (hasCore) {
    status = 'partial';
  }
  
  return {
    badge: finalFields.badge || null,
    body_type: finalFields.body_type || null,
    engine_family: finalFields.engine_family || null,
    engine_size_l: finalFields.engine_size_l ? parseFloat(finalFields.engine_size_l) : null,
    fuel_type: finalFields.fuel_type || null,
    transmission: finalFields.transmission || null,
    drivetrain: finalFields.drivetrain || null,
    series_code: finalFields.series_code || null,
    enrichment_status: status,
    enrichment_source: enrichmentSource,
    enrichment_errors: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json().catch(() => ({}));
    const { listing_ids, max_items = 20, force_scrape = false } = body;
    
    // Load variant extraction rules
    const { data: rules, error: rulesError } = await supabase
      .from('variant_extraction_rules')
      .select('*')
      .eq('enabled', true)
      .order('priority', { ascending: false });
    
    if (rulesError) {
      console.error('Failed to load variant rules:', rulesError);
    }
    
    const variantRules: VariantRule[] = rules || [];
    console.log(`Loaded ${variantRules.length} variant extraction rules`);
    
    const results = {
      processed: 0,
      enriched_ok: 0,
      enriched_partial: 0,
      enriched_failed: 0,
      errors: [] as string[],
    };
    
    // Mode 1: Enrich specific listings
    if (listing_ids && Array.isArray(listing_ids) && listing_ids.length > 0) {
      for (const listingId of listing_ids) {
        if (Date.now() - startTime > TIME_BUDGET_MS) break;
        
        try {
          const enrichResult = await enrichListing(
            supabase, 
            listingId, 
            variantRules, 
            force_scrape ? firecrawlKey : undefined
          );
          
          // Update listing
          const { error: updateError } = await supabase
            .from('retail_listings')
            .update({
              badge: enrichResult.badge,
              body_type: enrichResult.body_type,
              engine_family: enrichResult.engine_family,
              engine_size_l: enrichResult.engine_size_l,
              fuel_type: enrichResult.fuel_type,
              transmission: enrichResult.transmission,
              drivetrain: enrichResult.drivetrain,
              series_code: enrichResult.series_code,
              enrichment_status: enrichResult.enrichment_status,
              enrichment_source: enrichResult.enrichment_source,
              enrichment_errors: enrichResult.enrichment_errors,
              enriched_at: new Date().toISOString(),
            })
            .eq('id', listingId);
          
          if (updateError) {
            results.errors.push(`Update failed for ${listingId}: ${updateError.message}`);
            results.enriched_failed++;
          } else {
            results.processed++;
            if (enrichResult.enrichment_status === 'ok') results.enriched_ok++;
            else if (enrichResult.enrichment_status === 'partial') results.enriched_partial++;
            else results.enriched_failed++;
          }
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          results.errors.push(`Error processing ${listingId}: ${errMsg}`);
          results.enriched_failed++;
        }
      }
      
      return new Response(
        JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Mode 2: Process queue
    const lockToken = crypto.randomUUID();
    const now = new Date();
    const lockUntil = new Date(now.getTime() + LOCK_DURATION_MS);
    
    // Step 1: Find queued jobs that are available
    const { data: availableJobs, error: findError } = await supabase
      .from('listing_enrichment_queue')
      .select('id, listing_id, source, attempts')
      .eq('status', 'queued')
      .lt('attempts', MAX_RETRIES)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(max_items);
    
    if (findError) {
      throw new Error(`Failed to find jobs: ${findError.message}`);
    }
    
    if (!availableJobs || availableJobs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No jobs to process', results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Step 2: Claim jobs by updating their status
    const jobIds = availableJobs.map(j => j.id);
    const { error: claimError } = await supabase
      .from('listing_enrichment_queue')
      .update({
        status: 'processing',
        lock_token: lockToken,
        locked_until: lockUntil.toISOString(),
        updated_at: now.toISOString(),
      })
      .in('id', jobIds)
      .eq('status', 'queued'); // Only update if still queued
    
    if (claimError) {
      console.error('Claim error:', claimError);
    }
    
    const claimedJobs = availableJobs;
    
    console.log(`Claimed ${claimedJobs.length} enrichment jobs`);
    
    for (const job of claimedJobs) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log('Time budget exceeded, stopping');
        break;
      }
      
      try {
        const enrichResult = await enrichListing(
          supabase,
          job.listing_id,
          variantRules,
          firecrawlKey
        );
        
        // Update listing
        const { error: updateError } = await supabase
          .from('retail_listings')
          .update({
            badge: enrichResult.badge,
            body_type: enrichResult.body_type,
            engine_family: enrichResult.engine_family,
            engine_size_l: enrichResult.engine_size_l,
            fuel_type: enrichResult.fuel_type,
            transmission: enrichResult.transmission,
            drivetrain: enrichResult.drivetrain,
            series_code: enrichResult.series_code,
            enrichment_status: enrichResult.enrichment_status,
            enrichment_source: enrichResult.enrichment_source,
            enrichment_errors: enrichResult.enrichment_errors,
            enriched_at: new Date().toISOString(),
          })
          .eq('id', job.listing_id);
        
        if (updateError) {
          // Mark job as failed
          await supabase
            .from('listing_enrichment_queue')
            .update({
              status: 'failed',
              last_error: updateError.message,
              attempts: job.attempts + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
            .eq('lock_token', lockToken);
          
          results.errors.push(`Update failed for ${job.listing_id}: ${updateError.message}`);
          results.enriched_failed++;
        } else {
          // Mark job as done
          await supabase
            .from('listing_enrichment_queue')
            .update({
              status: 'done',
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
            .eq('lock_token', lockToken);
          
          results.processed++;
          if (enrichResult.enrichment_status === 'ok') results.enriched_ok++;
          else if (enrichResult.enrichment_status === 'partial') results.enriched_partial++;
          else results.enriched_failed++;
        }
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        // Mark job as failed
        await supabase
          .from('listing_enrichment_queue')
          .update({
            status: 'failed',
            last_error: errMsg,
            attempts: job.attempts + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('lock_token', lockToken);
        
        results.errors.push(`Error processing ${job.listing_id}: ${errMsg}`);
        results.enriched_failed++;
      }
    }
    
    // Log to cron audit
    await supabase.from('cron_audit_log').insert({
      cron_name: 'enrich-listing',
      success: results.errors.length === 0,
      result: results,
      error: results.errors.length > 0 ? results.errors.join('; ') : null,
    });
    
    console.log(`Enrichment complete:`, results);
    
    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Enrichment worker error:', error);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
