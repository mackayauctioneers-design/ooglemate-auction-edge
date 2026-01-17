import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Listing Enrichment Worker v1.1
 * 
 * THROUGHPUT BOOST:
 * - 200 items per batch (up from 20)
 * - 55s time budget (up from 25s)
 * - Parallel processing (10 concurrent)
 * 
 * FAST-PATH EXTRACTION:
 * - Uses variant_raw + URL + year/make/model (no title/description needed)
 * - Engine codes: VDJ=V8, GDJ=I4, GRJ=V6
 * - Cab types: DUAL_CAB, SINGLE_CAB, CAB_CHASSIS
 * - Body types: WAGON, HATCH, SEDAN, etc.
 * 
 * SMART SCRAPE (only when needed):
 * - Only scrape if priority >= 10 (hunt candidates)
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

// THROUGHPUT: Increased time budget + batch size
const TIME_BUDGET_MS = 55000;  // 55s (leave 5s buffer)
const LOCK_DURATION_MS = 60000;
const MAX_RETRIES = 3;
const DEFAULT_BATCH_SIZE = 200;
const PARALLEL_CHUNK_SIZE = 10;  // Process 10 listings concurrently

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
      rule.model.toUpperCase() === upperModel ||
      upperModel.includes(rule.model.toUpperCase());
    
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

// Extract additional fields from Firecrawl markdown
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
  
  // Autotrader specific patterns from DOM/text
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
  
  return results;
}

// Derive engine family from engine size
function deriveEngineFamily(engineSizeL: number | null): string | null {
  if (!engineSizeL) return null;
  
  if (engineSizeL >= 4.4 && engineSizeL <= 4.6) return 'V8';
  if (engineSizeL >= 3.9 && engineSizeL <= 4.1) return 'V6';
  if (engineSizeL >= 2.7 && engineSizeL <= 2.9) return 'I4';
  if (engineSizeL >= 1.9 && engineSizeL <= 2.1) return 'I4';
  if (engineSizeL >= 2.9 && engineSizeL <= 3.2) return 'I6';
  
  return null;
}

// Enrich a single listing
async function enrichListing(
  supabase: any,
  listingId: string,
  rules: VariantRule[],
  firecrawlKey: string | undefined,
  shouldScrape: boolean = false
): Promise<EnrichmentResult> {
  // Fetch listing with all relevant fields
  const { data: listing, error: listingError } = await supabase
    .from('retail_listings')
    .select('id, year, make, model, variant_raw, title, description, listing_url, source, fuel_type, transmission, body_type')
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
  
  // FAST-PATH: Build comprehensive text blob from all available fields
  // (Autotrader often lacks title/description, so we use variant_raw + URL + existing fields)
  const textBlob = [
    listing.make || '',
    listing.model || '',
    listing.year || '',
    listing.variant_raw || '',
    listing.listing_url || '',
    listing.title || '',
    listing.description || '',
    listing.fuel_type || '',
    listing.transmission || '',
    listing.body_type || '',
  ].join(' ');
  
  // Apply variant rules (fast, no network call)
  const extractedFields = applyRules(textBlob, rules, listing.make, listing.model);
  
  // Try Firecrawl scrape ONLY if:
  // 1. We have the key
  // 2. shouldScrape is true (priority >= 10 hunt candidate)
  // 3. We're still missing key fields after fast-path
  let scrapedFields: Record<string, string> = {};
  let enrichmentSource = 'variant_rules';
  
  const hasMissingCoreFields = !extractedFields.engine_family && !extractedFields.body_type;
  
  if (firecrawlKey && shouldScrape && hasMissingCoreFields && listing.listing_url) {
    const isAutotrader = listing.listing_url.includes('autotrader.com.au');
    const isDrive = listing.listing_url.includes('drive.com.au');
    
    if (isAutotrader || isDrive) {
      try {
        console.log(`Deep scraping: ${listing.listing_url}`);
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
  
  // Derive engine family from engine size if not already set
  let engineFamily = finalFields.engine_family || null;
  const engineSizeL = finalFields.engine_size_l ? parseFloat(finalFields.engine_size_l) : null;
  
  if (!engineFamily && engineSizeL) {
    engineFamily = deriveEngineFamily(engineSizeL);
  }
  
  // Determine enrichment status
  // OK = has at least 2 of: engine_family, body_type, badge/series
  // PARTIAL = has at least 1
  // FAILED = has none
  const coreFieldCount = [
    engineFamily,
    finalFields.body_type,
    finalFields.badge || finalFields.series_code
  ].filter(Boolean).length;
  
  let status: 'ok' | 'partial' | 'failed' = 'failed';
  if (coreFieldCount >= 2) {
    status = 'ok';
  } else if (coreFieldCount >= 1) {
    status = 'partial';
  }
  
  return {
    badge: finalFields.badge || null,
    body_type: finalFields.body_type || null,
    engine_family: engineFamily,
    engine_size_l: engineSizeL,
    fuel_type: finalFields.fuel_type || null,
    transmission: finalFields.transmission || null,
    drivetrain: finalFields.drivetrain || null,
    series_code: finalFields.series_code || null,
    enrichment_status: status,
    enrichment_source: enrichmentSource,
    enrichment_errors: null,
  };
}

// Process a batch of jobs in parallel
async function processBatch(
  supabase: any,
  jobs: any[],
  rules: VariantRule[],
  firecrawlKey: string | undefined,
  lockToken: string
): Promise<{ processed: number; ok: number; partial: number; failed: number; errors: string[] }> {
  const results = {
    processed: 0,
    ok: 0,
    partial: 0,
    failed: 0,
    errors: [] as string[],
  };
  
  const processJob = async (job: any) => {
    const shouldScrape = job.priority >= 10;  // Only deep scrape high-priority jobs
    
    try {
      const enrichResult = await enrichListing(
        supabase,
        job.listing_id,
        rules,
        firecrawlKey,
        shouldScrape
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
        results.failed++;
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
        if (enrichResult.enrichment_status === 'ok') results.ok++;
        else if (enrichResult.enrichment_status === 'partial') results.partial++;
        else results.failed++;
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
      results.failed++;
    }
  };
  
  // Process in parallel chunks
  await Promise.allSettled(jobs.map(processJob));
  
  return results;
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
    const { listing_ids, max_items = DEFAULT_BATCH_SIZE, force_scrape = false } = body;
    
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
    
    // Mode 1: Enrich specific listings (for operator "Force Enrich" action)
    if (listing_ids && Array.isArray(listing_ids) && listing_ids.length > 0) {
      console.log(`Processing ${listing_ids.length} specific listings`);
      
      // Process in parallel chunks
      for (let i = 0; i < listing_ids.length; i += PARALLEL_CHUNK_SIZE) {
        if (Date.now() - startTime > TIME_BUDGET_MS) break;
        
        const chunk = listing_ids.slice(i, i + PARALLEL_CHUNK_SIZE);
        const chunkResults = await Promise.allSettled(
          chunk.map((listingId: string) => 
            enrichListing(supabase, listingId, variantRules, force_scrape ? firecrawlKey : undefined, force_scrape)
              .then(async (enrichResult) => {
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
                
                return { updateError, enrichResult };
              })
          )
        );
        
        for (const result of chunkResults) {
          if (result.status === 'fulfilled') {
            const { updateError, enrichResult } = result.value;
            if (updateError) {
              results.errors.push(`Update failed: ${updateError.message}`);
              results.enriched_failed++;
            } else {
              results.processed++;
              if (enrichResult.enrichment_status === 'ok') results.enriched_ok++;
              else if (enrichResult.enrichment_status === 'partial') results.enriched_partial++;
              else results.enriched_failed++;
            }
          } else {
            results.errors.push(`Error: ${result.reason}`);
            results.enriched_failed++;
          }
        }
      }
      
      return new Response(
        JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Mode 2: Process queue (cron/scheduled)
    const lockToken = crypto.randomUUID();
    const now = new Date();
    const lockUntil = new Date(now.getTime() + LOCK_DURATION_MS);
    
    // Find available jobs (prioritize high-priority first)
    const { data: availableJobs, error: findError } = await supabase
      .from('listing_enrichment_queue')
      .select('id, listing_id, source, attempts, priority')
      .eq('status', 'queued')
      .lt('attempts', MAX_RETRIES)
      .order('priority', { ascending: false })  // High priority first
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
    
    // Claim jobs
    const jobIds = availableJobs.map((j: any) => j.id);
    const { error: claimError } = await supabase
      .from('listing_enrichment_queue')
      .update({
        status: 'processing',
        lock_token: lockToken,
        locked_until: lockUntil.toISOString(),
        updated_at: now.toISOString(),
      })
      .in('id', jobIds)
      .eq('status', 'queued');
    
    if (claimError) {
      console.error('Claim error:', claimError);
    }
    
    console.log(`Claimed ${availableJobs.length} enrichment jobs (batch size: ${max_items})`);
    
    // Process in parallel chunks for THROUGHPUT
    for (let i = 0; i < availableJobs.length; i += PARALLEL_CHUNK_SIZE) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`Time budget exceeded after processing ${results.processed} items`);
        break;
      }
      
      const chunk = availableJobs.slice(i, i + PARALLEL_CHUNK_SIZE);
      const chunkResults = await processBatch(supabase, chunk, variantRules, firecrawlKey, lockToken);
      
      results.processed += chunkResults.processed;
      results.enriched_ok += chunkResults.ok;
      results.enriched_partial += chunkResults.partial;
      results.enriched_failed += chunkResults.failed;
      results.errors.push(...chunkResults.errors);
    }
    
    // Log to cron audit
    await supabase.from('cron_audit_log').insert({
      cron_name: 'enrich-listing',
      success: results.errors.length < results.processed,  // Allow some errors
      result: results,
      error: results.errors.length > 0 ? results.errors.slice(0, 5).join('; ') : null,
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
