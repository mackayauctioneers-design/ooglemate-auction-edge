import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * toyota-dealer-trap-mapper
 * 
 * Reads franchise_dealer_candidates with status='candidate'
 * Attempts to find inventory URLs using common patterns
 * Creates dealer_traps entries for validation
 */

const INVENTORY_URL_PATTERNS = [
  '/pre-owned',
  '/used-cars',
  '/used-vehicles',
  '/inventory/pre-owned',
  '/inventory/used',
  '/stock',
  '/stock/used',
  '/vehicles/used',
  '/cars/used',
];

// Region mapping from dealer location
function deriveRegionFromLocation(location: string): string {
  if (!location) return 'NSW_REGIONAL';
  const loc = location.toUpperCase();
  
  if (['GOSFORD', 'WYONG', 'TUGGERAH', 'ERINA', 'TERRIGAL', 'CENTRAL COAST'].some(s => loc.includes(s))) return 'NSW_CENTRAL_COAST';
  if (['NEWCASTLE', 'MAITLAND', 'HUNTER', 'CHARLESTOWN', 'CARDIFF', 'CESSNOCK'].some(s => loc.includes(s))) return 'NSW_HUNTER_NEWCASTLE';
  if (['SYDNEY', 'PARRAMATTA', 'BLACKTOWN', 'PENRITH', 'LIVERPOOL'].some(s => loc.includes(s))) return 'NSW_SYDNEY_METRO';
  if (loc.includes('NSW')) return 'NSW_REGIONAL';
  
  if (['MELBOURNE', 'DANDENONG', 'RINGWOOD'].some(s => loc.includes(s))) return 'VIC_METRO';
  if (loc.includes('VIC')) return 'VIC_REGIONAL';
  
  if (['BRISBANE', 'GOLD COAST', 'SUNSHINE COAST'].some(s => loc.includes(s))) return 'QLD_SE';
  if (loc.includes('QLD')) return 'QLD_REGIONAL';
  
  return 'NSW_REGIONAL';
}

// Generate trap slug from dealer name
function generateTrapSlug(dealerName: string): string {
  return dealerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

// Try to extract base domain from dealer URL or name
function extractBaseDomain(dealerName: string, dealerUrl?: string): string | null {
  // If we have a URL, use it
  if (dealerUrl) {
    try {
      const url = new URL(dealerUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Invalid URL
    }
  }
  
  // Try to construct from dealer name
  const cleanName = dealerName
    .toLowerCase()
    .replace(/toyota/gi, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
  
  // Common Toyota dealer URL patterns
  const patterns = [
    `https://www.${cleanName}toyota.com.au`,
    `https://${cleanName}toyota.com.au`,
    `https://www.toyota${cleanName}.com.au`,
  ];
  
  return patterns[0]; // Return first guess, preflight will validate
}

// Probe URL to check if it returns 200
async function probeUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OogleMate/1.0)',
      },
    });
    
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

// Find best inventory URL for a domain
async function findInventoryUrl(baseDomain: string): Promise<string | null> {
  // Try each pattern
  for (const pattern of INVENTORY_URL_PATTERNS) {
    const testUrl = `${baseDomain}${pattern}`;
    const isValid = await probeUrl(testUrl);
    if (isValid) {
      console.log(`[trap-mapper] Found valid inventory URL: ${testUrl}`);
      return testUrl;
    }
  }
  
  // Try base domain as fallback
  if (await probeUrl(baseDomain)) {
    return baseDomain;
  }
  
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Parse params
    let brand = 'TOYOTA';
    let limit = 20;
    
    try {
      const body = await req.json();
      brand = body.brand || brand;
      limit = body.limit || limit;
    } catch {
      // Use defaults
    }
    
    console.log(`[trap-mapper] Starting mapper for ${brand}, limit=${limit}`);
    
    // Fetch candidate dealers
    const { data: candidates, error: fetchError } = await supabase
      .from('franchise_dealer_candidates')
      .select('*')
      .eq('brand', brand)
      .eq('status', 'candidate')
      .order('last_seen_at', { ascending: false })
      .limit(limit);
    
    if (fetchError) {
      throw fetchError;
    }
    
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No candidates to process',
          processed: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`[trap-mapper] Processing ${candidates.length} candidates`);
    
    let mapped = 0;
    let skipped = 0;
    let failed = 0;
    const results: { dealer: string; status: string; url?: string }[] = [];
    
    for (const candidate of candidates) {
      const trapSlug = generateTrapSlug(candidate.dealer_name);
      
      // Check if trap already exists
      const { data: existingTrap } = await supabase
        .from('dealer_traps')
        .select('id')
        .eq('trap_slug', trapSlug)
        .maybeSingle();
      
      if (existingTrap) {
        // Already mapped
        await supabase
          .from('franchise_dealer_candidates')
          .update({ status: 'mapped', updated_at: new Date().toISOString() })
          .eq('id', candidate.id);
        
        skipped++;
        results.push({ dealer: candidate.dealer_name, status: 'already_mapped' });
        continue;
      }
      
      // Try to find inventory URL
      const baseDomain = extractBaseDomain(candidate.dealer_name, candidate.dealer_url);
      
      if (!baseDomain) {
        failed++;
        results.push({ dealer: candidate.dealer_name, status: 'no_domain' });
        continue;
      }
      
      const inventoryUrl = await findInventoryUrl(baseDomain);
      
      if (!inventoryUrl) {
        // Mark as failed but don't disable - manual review needed
        await supabase
          .from('franchise_dealer_candidates')
          .update({ 
            status: 'candidate', 
            notes: `No inventory URL found. Tried: ${baseDomain}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', candidate.id);
        
        failed++;
        results.push({ dealer: candidate.dealer_name, status: 'no_url_found', url: baseDomain });
        continue;
      }
      
      // Create trap entry
      const regionId = deriveRegionFromLocation(candidate.dealer_location || '');
      
      const { error: insertError } = await supabase
        .from('dealer_traps')
        .insert({
          trap_slug: trapSlug,
          dealer_name: candidate.dealer_name,
          region_id: regionId,
          inventory_url: inventoryUrl,
          parser_mode: 'auto', // Let preflight determine
          enabled: false, // Disabled until validated
          anchor_trap: false,
          validation_status: 'pending',
          preflight_status: 'pending',
          validation_notes: `Auto-created from ${brand} portal feed`,
        });
      
      if (insertError) {
        console.error(`[trap-mapper] Failed to create trap for ${candidate.dealer_name}:`, insertError);
        failed++;
        results.push({ dealer: candidate.dealer_name, status: 'insert_failed' });
        continue;
      }
      
      // Update candidate status
      await supabase
        .from('franchise_dealer_candidates')
        .update({ 
          status: 'mapped', 
          dealer_url: inventoryUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id);
      
      mapped++;
      results.push({ dealer: candidate.dealer_name, status: 'mapped', url: inventoryUrl });
    }
    
    console.log(`[trap-mapper] Complete: ${mapped} mapped, ${skipped} skipped, ${failed} failed`);
    
    return new Response(
      JSON.stringify({
        success: true,
        brand,
        processed: candidates.length,
        mapped,
        skipped,
        failed,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[trap-mapper] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
