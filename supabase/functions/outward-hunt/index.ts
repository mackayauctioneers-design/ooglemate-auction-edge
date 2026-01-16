import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Outward Hunt - Web/Auction Lane Discovery
 * 
 * Searches external sites (Lloyds, Grays, Trading Post, etc.) to find
 * candidates that aren't in our retail_listings feeds.
 * 
 * Flow:
 * 1. Get hunts with outward_enabled = true
 * 2. For each hunt, query configured sources via Firecrawl
 * 3. Parse results to extract candidate listings
 * 4. Score candidates + emit alerts if thresholds met
 */

interface Hunt {
  id: string;
  dealer_id: string;
  make: string;
  model: string;
  year: number;
  variant_family: string | null;
  km: number | null;
  proven_exit_value: number | null;
  min_gap_abs_buy: number;
  min_gap_pct_buy: number;
  min_gap_abs_watch: number;
  min_gap_pct_watch: number;
  outward_sources: string[];
}

interface WebSource {
  name: string;
  display_name: string;
  base_url: string;
  search_url_template: string | null;
  parser_type: string;
  rate_limit_per_hour: number;
}

interface ExtractedCandidate {
  source_url: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  km: number | null;
  asking_price: number | null;
  location: string | null;
  raw_snippet: string;
  confidence: 'high' | 'medium' | 'low';
}

// Build search URL from template
function buildSearchUrl(source: WebSource, hunt: Hunt): string {
  let url = source.base_url;
  
  if (source.search_url_template) {
    url += source.search_url_template
      .replace('{make}', encodeURIComponent(hunt.make))
      .replace('{model}', encodeURIComponent(hunt.model))
      .replace('{year}', String(hunt.year));
  }
  
  return url;
}

// Generate dedup key
function generateDedupKey(sourceName: string, url: string): string {
  // Normalize URL (remove trailing slashes, query params for dedup)
  const normalized = url.split('?')[0].replace(/\/+$/, '').toLowerCase();
  return `${sourceName}:${normalized}`;
}

// Extract candidates from Firecrawl markdown response
function extractCandidatesFromMarkdown(
  markdown: string, 
  source: WebSource,
  hunt: Hunt
): ExtractedCandidate[] {
  const candidates: ExtractedCandidate[] = [];
  
  // Split by common listing patterns
  const blocks = markdown.split(/\n(?=\[|\#{1,3}\s|\*\*\$|\d{4}\s+[A-Z])/gi);
  
  for (const block of blocks) {
    if (block.length < 50) continue;
    
    try {
      // Try to extract URL
      const urlMatch = block.match(/\((https?:\/\/[^\s\)]+)\)/);
      if (!urlMatch) continue;
      
      const sourceUrl = urlMatch[1];
      
      // Skip if URL doesn't look like a listing
      if (!sourceUrl.includes('/') || sourceUrl.includes('search') || sourceUrl.includes('login')) {
        continue;
      }
      
      // Extract year (4-digit number 2010-2026)
      const yearMatch = block.match(/\b(20[1-2][0-9])\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
      
      // Skip if year doesn't match hunt (±2 years tolerance)
      if (year && Math.abs(year - hunt.year) > 2) continue;
      
      // Check if make/model mentioned
      const textLower = block.toLowerCase();
      const huntMakeLower = hunt.make.toLowerCase();
      const huntModelLower = hunt.model.toLowerCase();
      
      if (!textLower.includes(huntMakeLower) && !textLower.includes(huntModelLower)) {
        continue;
      }
      
      // Extract price
      const priceMatch = block.match(/\$\s*([\d,]+)/);
      const asking_price = priceMatch 
        ? parseInt(priceMatch[1].replace(/,/g, ''), 10) 
        : null;
      
      // Skip unrealistic prices
      if (asking_price && (asking_price < 1000 || asking_price > 500000)) continue;
      
      // Extract km
      const kmMatch = block.match(/([\d,]+)\s*k?m/i);
      const km = kmMatch 
        ? parseInt(kmMatch[1].replace(/,/g, ''), 10) 
        : null;
      
      // Extract title (first line or bolded text)
      const titleMatch = block.match(/\*\*([^*]+)\*\*/);
      const title = titleMatch ? titleMatch[1].trim() : block.slice(0, 80).trim();
      
      // Determine confidence
      let confidence: 'high' | 'medium' | 'low' = 'low';
      if (year && asking_price && textLower.includes(huntMakeLower) && textLower.includes(huntModelLower)) {
        confidence = 'high';
      } else if ((year || asking_price) && (textLower.includes(huntMakeLower) || textLower.includes(huntModelLower))) {
        confidence = 'medium';
      }
      
      candidates.push({
        source_url: sourceUrl,
        title,
        year,
        make: textLower.includes(huntMakeLower) ? hunt.make : null,
        model: textLower.includes(huntModelLower) ? hunt.model : null,
        variant_raw: null,
        km,
        asking_price,
        location: null,
        raw_snippet: block.slice(0, 500),
        confidence,
      });
    } catch {
      continue;
    }
  }
  
  return candidates;
}

// Score a candidate against the hunt
function scoreCandidate(
  candidate: ExtractedCandidate,
  hunt: Hunt
): { score: number; decision: 'buy' | 'watch' | 'ignore' } {
  let score = 5.0; // Base score
  
  // Year match
  if (candidate.year) {
    if (candidate.year === hunt.year) score += 1.5;
    else if (Math.abs(candidate.year - hunt.year) === 1) score += 0.5;
  }
  
  // Make/model match
  if (candidate.make?.toUpperCase() === hunt.make.toUpperCase()) score += 1.0;
  if (candidate.model?.toUpperCase() === hunt.model.toUpperCase()) score += 1.0;
  
  // Price gap (if we have both prices)
  let gap_dollars = 0;
  let gap_pct = 0;
  
  if (candidate.asking_price && hunt.proven_exit_value) {
    gap_dollars = hunt.proven_exit_value - candidate.asking_price;
    gap_pct = (gap_dollars / hunt.proven_exit_value) * 100;
    
    if (gap_pct >= 10) score += 1.5;
    else if (gap_pct >= 5) score += 1.0;
    else if (gap_pct >= 0) score += 0.5;
    else score -= 1.0; // Overpriced
  }
  
  // Confidence boost
  if (candidate.confidence === 'high') score += 0.5;
  
  // Cap score
  score = Math.min(10, Math.max(0, score));
  
  // Decision
  const canBuy = 
    score >= 7.5 &&
    gap_dollars >= hunt.min_gap_abs_buy &&
    gap_pct >= hunt.min_gap_pct_buy &&
    candidate.confidence !== 'low';
  
  const canWatch =
    score >= 6.0 &&
    (gap_dollars >= hunt.min_gap_abs_watch || gap_pct >= hunt.min_gap_pct_watch);
  
  if (canBuy) return { score, decision: 'buy' };
  if (canWatch) return { score, decision: 'watch' };
  return { score, decision: 'ignore' };
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
      throw new Error("FIRECRAWL_API_KEY not configured");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { hunt_id, source_name } = await req.json().catch(() => ({}));
    
    // Get hunts to process
    let huntsQuery = supabase
      .from('sale_hunts')
      .select('*')
      .eq('status', 'active')
      .eq('outward_enabled', true);
    
    if (hunt_id) {
      huntsQuery = huntsQuery.eq('id', hunt_id);
    }
    
    const { data: hunts, error: huntsError } = await huntsQuery.limit(10);
    
    if (huntsError) throw huntsError;
    if (!hunts || hunts.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No outward-enabled hunts",
        duration_ms: Date.now() - startTime,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    // Get enabled web sources
    let sourcesQuery = supabase
      .from('hunt_web_sources')
      .select('*')
      .eq('enabled', true)
      .order('priority', { ascending: false });
    
    if (source_name) {
      sourcesQuery = sourcesQuery.eq('name', source_name);
    }
    
    const { data: sources } = await sourcesQuery;
    
    if (!sources || sources.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No enabled web sources",
        duration_ms: Date.now() - startTime,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    const results = {
      hunts_processed: 0,
      sources_searched: 0,
      candidates_found: 0,
      candidates_saved: 0,
      alerts_emitted: 0,
      errors: [] as string[],
    };
    
    for (const hunt of hunts as Hunt[]) {
      results.hunts_processed++;
      
      // Filter sources to those enabled for this hunt
      const huntSources = sources.filter(s => 
        hunt.outward_sources?.includes(s.name)
      );
      
      for (const source of huntSources as WebSource[]) {
        try {
          // Create search task
          const { data: task } = await supabase
            .from('hunt_search_tasks')
            .insert({
              hunt_id: hunt.id,
              source_name: source.name,
              status: 'running',
              search_query: buildSearchUrl(source, hunt),
              started_at: new Date().toISOString(),
            })
            .select()
            .single();
          
          const searchUrl = buildSearchUrl(source, hunt);
          console.log(`Searching ${source.name}: ${searchUrl}`);
          
          // Call Firecrawl
          const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${firecrawlKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: searchUrl,
              formats: ["markdown"],
              waitFor: 5000,
              onlyMainContent: true,
            }),
          });
          
          results.sources_searched++;
          
          if (!scrapeRes.ok) {
            const errText = await scrapeRes.text();
            console.error(`Firecrawl error for ${source.name}:`, errText);
            
            await supabase
              .from('hunt_search_tasks')
              .update({ status: 'error', error: errText.slice(0, 500), completed_at: new Date().toISOString() })
              .eq('id', task?.id);
            
            results.errors.push(`${source.name}: ${errText.slice(0, 100)}`);
            continue;
          }
          
          const scrapeData = await scrapeRes.json();
          const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
          
          // Extract candidates
          const candidates = extractCandidatesFromMarkdown(markdown, source, hunt);
          results.candidates_found += candidates.length;
          
          console.log(`${source.name}: Found ${candidates.length} candidates`);
          
          // Save candidates (upsert on dedup_key)
          for (const candidate of candidates) {
            const dedupKey = generateDedupKey(source.name, candidate.source_url);
            
            // Score the candidate
            const { score, decision } = scoreCandidate(candidate, hunt);
            
            // Upsert
            const { error: upsertError } = await supabase
              .from('hunt_external_candidates')
              .upsert({
                hunt_id: hunt.id,
                source_name: source.name,
                source_url: candidate.source_url,
                dedup_key: dedupKey,
                title: candidate.title,
                year: candidate.year,
                make: candidate.make,
                model: candidate.model,
                variant_raw: candidate.variant_raw,
                km: candidate.km,
                asking_price: candidate.asking_price,
                location: candidate.location,
                match_score: score,
                decision,
                confidence: candidate.confidence,
                raw_snippet: candidate.raw_snippet,
                scored_at: new Date().toISOString(),
              }, { onConflict: 'dedup_key' });
            
            if (!upsertError) {
              results.candidates_saved++;
              
              // Emit alert for BUY/WATCH decisions (if not already emitted)
              if (decision === 'buy' || decision === 'watch') {
                // Check if we already emitted for this
                const { data: existing } = await supabase
                  .from('hunt_external_candidates')
                  .select('alert_emitted')
                  .eq('dedup_key', dedupKey)
                  .single();
                
                if (!existing?.alert_emitted) {
                  // Insert hunt_alert
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
                    source: `${source.display_name} (outward)`,
                    listing_url: candidate.source_url,
                    state: null,
                    suburb: candidate.location,
                    reasons: [`Found via outward search on ${source.display_name}`, `Confidence: ${candidate.confidence}`],
                  };
                  
                  await supabase.from('hunt_alerts').insert({
                    hunt_id: hunt.id,
                    listing_id: dedupKey,
                    alert_type: decision === 'buy' ? 'BUY' : 'WATCH',
                    payload: alertPayload,
                  });
                  
                  // Mark as emitted
                  await supabase
                    .from('hunt_external_candidates')
                    .update({ alert_emitted: true })
                    .eq('dedup_key', dedupKey);
                  
                  results.alerts_emitted++;
                }
              }
            }
          }
          
          // Update task
          await supabase
            .from('hunt_search_tasks')
            .update({ 
              status: 'complete', 
              candidates_found: candidates.length,
              completed_at: new Date().toISOString(),
            })
            .eq('id', task?.id);
          
          // Update source last_searched_at
          await supabase
            .from('hunt_web_sources')
            .update({ last_searched_at: new Date().toISOString() })
            .eq('name', source.name);
          
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`Error searching ${source.name}:`, errMsg);
          results.errors.push(`${source.name}: ${errMsg}`);
        }
      }
    }
    
    // Log to cron audit
    await supabase.from('cron_audit_log').insert({
      cron_name: 'outward-hunt',
      run_date: new Date().toISOString().slice(0, 10),
      success: results.errors.length === 0,
      result: results,
    });
    
    console.log('Outward hunt complete:', results);
    
    return new Response(JSON.stringify({
      success: true,
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
