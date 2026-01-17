import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Outward Scrape Worker v1.0
 * 
 * Processes the scrape queue to verify candidate listings:
 * 1. Claims queued candidates with lock
 * 2. Scrapes each URL via Firecrawl
 * 3. Extracts and verifies: price, km, year
 * 4. Updates hunt_external_candidates with verified fields
 * 5. After processing, triggers re-ranking by price
 */

interface QueueItem {
  id: string;
  hunt_id: string;
  candidate_id: string;
  candidate_url: string;
  priority: number;
  attempts: number;
}

// Extract price from page content
function extractPrice(text: string): number | null {
  // Match AU currency formats: $123,456 or $123456
  const patterns = [
    /\$\s*([\d,]+)(?:\s*(?:AUD|aud))?/g,
    /(?:price|asking|sale)\s*:?\s*\$?\s*([\d,]+)/gi,
    /([\d,]+)\s*\$\s*(?:AUD)?/g,
  ];
  
  let bestPrice: number | null = null;
  
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const price = parseInt(match[1].replace(/,/g, ''), 10);
      // Validate vehicle price range
      if (price >= 5000 && price <= 500000) {
        if (!bestPrice || price < bestPrice) {
          bestPrice = price;
        }
      }
    }
  }
  
  return bestPrice;
}

// Extract km from page content
function extractKm(text: string): number | null {
  const patterns = [
    /([\d,]+)\s*k[mi]l?o?(?:metres?|meters?)?/gi,
    /(?:odometer|kms?|kilometres?|kilometers?)\s*:?\s*([\d,]+)/gi,
    /([\d,]+)\s*(?:kms?)\b/gi,
  ];
  
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const km = parseInt(match[1].replace(/,/g, ''), 10);
      // Validate km range for used vehicles
      if (km >= 0 && km <= 999999) {
        return km;
      }
    }
  }
  
  return null;
}

// Extract year from page content
function extractYear(text: string): number | null {
  // Look for 4-digit year in vehicle context
  const yearPatterns = [
    /(?:year|model\s*year)\s*:?\s*(20[1-2][0-9])/gi,
    /\b(20[1-2][0-9])\s+(?:toyota|landcruiser|hilux|ranger|ford|nissan|mazda)/gi,
    /(?:toyota|landcruiser|hilux|ranger|ford|nissan|mazda)\s+(20[1-2][0-9])\b/gi,
    /\b(20[1-2][0-9])\b/g,
  ];
  
  for (const pattern of yearPatterns) {
    const match = pattern.exec(text);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

// Extract make/model from page content
function extractMakeModel(text: string): { make: string | null; model: string | null } {
  const makes = ['TOYOTA', 'FORD', 'NISSAN', 'MAZDA', 'HOLDEN', 'MITSUBISHI', 'ISUZU', 'VOLKSWAGEN'];
  const models: Record<string, string[]> = {
    TOYOTA: ['LANDCRUISER', 'LAND CRUISER', 'HILUX', 'PRADO', 'FORTUNER', 'RAV4', '86', 'COROLLA', 'CAMRY'],
    FORD: ['RANGER', 'EVEREST', 'WILDTRAK', 'RAPTOR', 'FOCUS', 'MUSTANG', 'TERRITORY'],
    NISSAN: ['PATROL', 'NAVARA', 'XTRAIL', 'PATHFINDER', 'QASHQAI'],
    MAZDA: ['BT50', 'BT-50', 'CX5', 'CX-5', 'CX9', 'CX-9', 'MAZDA3', 'MAZDA6'],
    HOLDEN: ['COLORADO', 'TRAILBLAZER', 'COMMODORE', 'CAPTIVA'],
    MITSUBISHI: ['TRITON', 'PAJERO', 'OUTLANDER', 'ASX'],
    ISUZU: ['DMAX', 'D-MAX', 'MUX', 'MU-X'],
    VOLKSWAGEN: ['AMAROK'],
  };
  
  const upper = text.toUpperCase();
  
  for (const make of makes) {
    if (upper.includes(make)) {
      for (const model of models[make] || []) {
        if (upper.includes(model)) {
          return { make, model: model.replace('-', '').replace(' ', '') };
        }
      }
      return { make, model: null };
    }
  }
  
  return { make: null, model: null };
}

// Extract location/state
function extractLocation(text: string): { location: string | null; state: string | null } {
  const states = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
  
  for (const state of states) {
    if (text.includes(state)) {
      return { location: null, state };
    }
  }
  
  return { location: null, state: null };
}

// Extract engine markers
function extractEngineMarkers(text: string): string[] {
  const markers: string[] = [];
  const upper = text.toUpperCase();
  
  if (/V8|VDJ|4\.5L|4\.5\s*DIESEL/i.test(text)) markers.push('V8_DIESEL');
  if (/2\.8L?|GDJ|4\s*CYL|4-CYL/i.test(text)) markers.push('I4_DIESEL');
  if (/V6|GRJ|4\.0L|4\.0\s*PETROL/i.test(text)) markers.push('V6_PETROL');
  if (/TWIN\s*TURBO|3\.3L/i.test(text)) markers.push('V6_DIESEL_TT');
  
  return markers;
}

// Extract body/cab type
function extractBodyCab(text: string): { body: string | null; cab: string | null } {
  const upper = text.toUpperCase();
  
  let body: string | null = null;
  let cab: string | null = null;
  
  if (upper.includes('CAB CHASSIS') || upper.includes('TRAY') || upper.includes('UTE')) {
    body = 'CAB_CHASSIS';
  } else if (upper.includes('WAGON') || upper.includes('SUV')) {
    body = 'WAGON';
  }
  
  if (upper.includes('DUAL CAB') || upper.includes('DOUBLE CAB') || upper.includes('D/CAB')) {
    cab = 'DUAL';
  } else if (upper.includes('SINGLE CAB') || upper.includes('S/CAB')) {
    cab = 'SINGLE';
  } else if (upper.includes('EXTRA CAB') || upper.includes('KING CAB')) {
    cab = 'EXTRA';
  }
  
  return { body, cab };
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
    
    const { batch_size = 10 } = await req.json().catch(() => ({}));
    
    // Generate a lock token
    const lockToken = crypto.randomUUID();
    const lockUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min lock
    
    // Claim queued items
    const { data: claimedRows, error: claimError } = await supabase
      .from('outward_candidate_scrape_queue')
      .update({
        status: 'processing',
        lock_token: lockToken,
        locked_until: lockUntil,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'queued')
      .lt('attempts', 3)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(batch_size)
      .select();
    
    if (claimError) {
      console.error('Failed to claim queue items:', claimError);
      throw claimError;
    }
    
    const queueItems: QueueItem[] = claimedRows || [];
    
    console.log(`Claimed ${queueItems.length} items for scrape verification`);
    
    if (queueItems.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No items to process',
        processed: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    const results = {
      processed: 0,
      verified: 0,
      failed: 0,
      hunts_to_rerank: new Set<string>(),
    };
    
    for (const item of queueItems) {
      try {
        console.log(`Scraping: ${item.candidate_url}`);
        
        // Scrape the URL
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: item.candidate_url,
            formats: ["markdown"],
            onlyMainContent: true,
            waitFor: 2000,
          }),
        });
        
        if (!scrapeRes.ok) {
          const errText = await scrapeRes.text();
          console.error(`Scrape failed for ${item.candidate_url}:`, errText);
          
          // Update queue as failed
          await supabase
            .from('outward_candidate_scrape_queue')
            .update({
              status: item.attempts >= 2 ? 'failed' : 'queued',
              attempts: item.attempts + 1,
              last_error: errText.slice(0, 500),
              lock_token: null,
              locked_until: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.id)
            .eq('lock_token', lockToken);
          
          results.failed++;
          continue;
        }
        
        const scrapeData = await scrapeRes.json();
        const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';
        
        if (!markdown || markdown.length < 100) {
          console.log(`No content from ${item.candidate_url}`);
          
          await supabase
            .from('outward_candidate_scrape_queue')
            .update({
              status: 'failed',
              last_error: 'No content returned',
              lock_token: null,
              locked_until: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.id)
            .eq('lock_token', lockToken);
          
          results.failed++;
          continue;
        }
        
        // Extract verified fields
        const price = extractPrice(markdown);
        const km = extractKm(markdown);
        const year = extractYear(markdown);
        const { make, model } = extractMakeModel(markdown);
        const { location, state } = extractLocation(markdown);
        const engineMarkers = extractEngineMarkers(markdown);
        const { body, cab } = extractBodyCab(markdown);
        
        const verifiedFields = {
          asking_price: price,
          km,
          year,
          make,
          model,
          location,
          state,
          engine_markers: engineMarkers,
          body,
          cab,
          scraped_at: new Date().toISOString(),
          content_length: markdown.length,
        };
        
        // Update hunt_external_candidates with verified data
        const { error: updateError } = await supabase
          .from('hunt_external_candidates')
          .update({
            asking_price: price || undefined,
            km: km || undefined,
            year: year || undefined,
            make: make || undefined,
            model: model || undefined,
            location: location || state || undefined,
            price_verified: !!price,
            km_verified: !!km,
            year_verified: !!year,
            verified_at: new Date().toISOString(),
            verified_fields: verifiedFields,
          })
          .eq('id', item.candidate_id);
        
        if (updateError) {
          console.error(`Failed to update candidate ${item.candidate_id}:`, updateError);
        }
        
        // Mark queue item as done
        await supabase
          .from('outward_candidate_scrape_queue')
          .update({
            status: 'done',
            lock_token: null,
            locked_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)
          .eq('lock_token', lockToken);
        
        results.processed++;
        if (price) results.verified++;
        results.hunts_to_rerank.add(item.hunt_id);
        
      } catch (err) {
        console.error(`Error processing ${item.candidate_url}:`, err);
        
        await supabase
          .from('outward_candidate_scrape_queue')
          .update({
            status: item.attempts >= 2 ? 'failed' : 'queued',
            attempts: item.attempts + 1,
            last_error: err instanceof Error ? err.message : String(err),
            lock_token: null,
            locked_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)
          .eq('lock_token', lockToken);
        
        results.failed++;
      }
    }
    
    // Re-rank affected hunts
    for (const huntId of results.hunts_to_rerank) {
      try {
        console.log(`Re-ranking hunt ${huntId} after verification`);
        
        // Call the unified candidate builder which handles ranking
        await supabase.rpc('rpc_build_unified_candidates', { p_hunt_id: huntId });
        
      } catch (rankErr) {
        console.error(`Failed to re-rank hunt ${huntId}:`, rankErr);
      }
    }
    
    console.log('Scrape worker complete:', results);
    
    return new Response(JSON.stringify({
      success: true,
      ...results,
      hunts_reranked: Array.from(results.hunts_to_rerank),
      duration_ms: Date.now() - startTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    
  } catch (error) {
    console.error("Scrape worker error:", error);
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
