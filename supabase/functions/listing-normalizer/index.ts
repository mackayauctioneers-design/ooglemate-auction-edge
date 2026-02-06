import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Listing Normalizer
 * 
 * Takes raw listing data from listing_details_raw, identifies domain,
 * extracts key fields (price, year, make, model, km), and outputs
 * structured records to listing_details_norm.
 */

// Domain detection
function detectDomain(domain: string, url: string): string {
  const d = domain.toLowerCase();
  if (d.includes("carsales")) return "carsales";
  if (d.includes("pickles")) return "pickles";
  if (d.includes("manheim")) return "manheim";
  if (d.includes("grays")) return "grays";
  if (d.includes("gumtree")) return "gumtree";
  if (d.includes("autotrader")) return "autotrader";
  if (d.includes("carsguide")) return "carsguide";
  if (d.includes("drive.com")) return "drive";
  if (d.includes("facebook")) return "facebook_marketplace";
  return "dealer_site";
}

// Price extraction
function extractPrice(text: string): number | null {
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
      if (price >= 1000 && price <= 1000000) {
        if (!bestPrice || price < bestPrice) {
          bestPrice = price;
        }
      }
    }
  }
  
  return bestPrice;
}

// Year extraction
function extractYear(text: string): number | null {
  const patterns = [
    /(?:year|model\s*year)\s*:?\s*(20[0-2][0-9]|19[89][0-9])/gi,
    /\b(20[0-2][0-9]|19[89][0-9])\s+(?:toyota|ford|holden|mazda|nissan|hyundai|kia|honda|subaru|mitsubishi|volkswagen|bmw|mercedes|audi)/gi,
    /(?:toyota|ford|holden|mazda|nissan|hyundai|kia|honda|subaru|mitsubishi|volkswagen|bmw|mercedes|audi)\s+(20[0-2][0-9]|19[89][0-9])\b/gi,
  ];
  
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const year = parseInt(match[1], 10);
      if (year >= 1990 && year <= 2026) {
        return year;
      }
    }
  }
  
  // Fallback: find any 4-digit year
  const yearMatch = text.match(/\b(20[0-2][0-9]|19[89][0-9])\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }
  
  return null;
}

// Km extraction
function extractKm(text: string): number | null {
  const patterns = [
    /([\d,]+)\s*k[mi]l?o?(?:metres?|meters?)?/gi,
    /(?:odometer|kms?|kilometres?|kilometers?|mileage)\s*:?\s*([\d,]+)/gi,
    /([\d,]+)\s*(?:kms?)\b/gi,
  ];
  
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const km = parseInt(match[1].replace(/,/g, ''), 10);
      if (km >= 0 && km <= 999999) {
        return km;
      }
    }
  }
  
  return null;
}

// Make extraction
function extractMake(text: string): string | null {
  const makes = [
    'TOYOTA', 'FORD', 'HOLDEN', 'MAZDA', 'NISSAN', 'HYUNDAI', 'KIA',
    'HONDA', 'SUBARU', 'MITSUBISHI', 'VOLKSWAGEN', 'BMW', 'MERCEDES',
    'AUDI', 'LEXUS', 'JEEP', 'LAND ROVER', 'ISUZU', 'SUZUKI', 'PEUGEOT',
    'RENAULT', 'VOLVO', 'SKODA', 'FIAT', 'PORSCHE', 'MINI', 'CHRYSLER',
    'DODGE', 'RAM', 'TESLA', 'MG', 'HAVAL', 'GWM', 'LDV', 'SSANGYONG'
  ];
  
  const upper = text.toUpperCase();
  
  for (const make of makes) {
    if (upper.includes(make)) {
      return make;
    }
  }
  
  return null;
}

// Model extraction (based on make)
function extractModel(text: string, make: string | null): string | null {
  if (!make) return null;
  
  const modelMap: Record<string, string[]> = {
    TOYOTA: ['LANDCRUISER', 'LAND CRUISER', 'HILUX', 'PRADO', 'CAMRY', 'COROLLA', 'RAV4', 'KLUGER', 'FORTUNER', '86', 'SUPRA', 'YARIS', 'CH-R', 'AVALON'],
    FORD: ['RANGER', 'MUSTANG', 'EVEREST', 'FOCUS', 'ESCAPE', 'TERRITORY', 'FALCON', 'MONDEO', 'FIESTA', 'ENDURA', 'PUMA'],
    HOLDEN: ['COMMODORE', 'COLORADO', 'CAPTIVA', 'CRUZE', 'TRAX', 'EQUINOX', 'ACADIA', 'ASTRA', 'TRAILBLAZER'],
    MAZDA: ['BT-50', 'BT50', 'CX-5', 'CX5', 'CX-3', 'CX3', 'CX-9', 'CX9', 'CX-30', 'CX30', 'MAZDA3', 'MAZDA6', 'MAZDA2', 'MX-5'],
    NISSAN: ['PATROL', 'NAVARA', 'X-TRAIL', 'XTRAIL', 'PATHFINDER', 'QASHQAI', 'JUKE', 'LEAF', '370Z', 'GT-R'],
    HYUNDAI: ['TUCSON', 'SANTA FE', 'I30', 'KONA', 'VENUE', 'PALISADE', 'IONIQ', 'STARIA', 'ILOAD'],
    KIA: ['SPORTAGE', 'SELTOS', 'CERATO', 'SORENTO', 'CARNIVAL', 'STINGER', 'PICANTO', 'RIO', 'EV6'],
    MITSUBISHI: ['TRITON', 'PAJERO', 'OUTLANDER', 'ASX', 'ECLIPSE CROSS', 'PAJERO SPORT'],
    ISUZU: ['D-MAX', 'DMAX', 'MU-X', 'MUX'],
    SUBARU: ['OUTBACK', 'FORESTER', 'XV', 'IMPREZA', 'WRX', 'BRZ', 'LIBERTY', 'LEVORG'],
    VOLKSWAGEN: ['AMAROK', 'GOLF', 'TIGUAN', 'TOUAREG', 'POLO', 'PASSAT', 'T-ROC', 'ARTEON'],
  };
  
  const upper = text.toUpperCase();
  const models = modelMap[make] || [];
  
  for (const model of models) {
    if (upper.includes(model)) {
      return model.replace('-', '').replace(' ', '');
    }
  }
  
  return null;
}

// Transmission extraction
function extractTransmission(text: string): string | null {
  const upper = text.toUpperCase();
  
  if (upper.includes('AUTOMATIC') || upper.includes('AUTO') || /\bAT\b/.test(upper)) {
    return 'automatic';
  }
  if (upper.includes('MANUAL') || /\bMT\b/.test(upper)) {
    return 'manual';
  }
  if (upper.includes('CVT')) {
    return 'cvt';
  }
  
  return null;
}

// Fuel type extraction
function extractFuelType(text: string): string | null {
  const upper = text.toUpperCase();
  
  if (upper.includes('DIESEL')) return 'diesel';
  if (upper.includes('PETROL') || upper.includes('UNLEADED')) return 'petrol';
  if (upper.includes('HYBRID')) return 'hybrid';
  if (upper.includes('ELECTRIC') || upper.includes('EV') || upper.includes('BEV')) return 'electric';
  if (upper.includes('LPG')) return 'lpg';
  
  return null;
}

// Body type extraction
function extractBodyType(text: string): string | null {
  const upper = text.toUpperCase();
  
  if (upper.includes('UTE') || upper.includes('PICKUP') || upper.includes('DUAL CAB')) return 'ute';
  if (upper.includes('SUV') || upper.includes('4WD') || upper.includes('4X4')) return 'suv';
  if (upper.includes('SEDAN')) return 'sedan';
  if (upper.includes('HATCH') || upper.includes('HATCHBACK')) return 'hatch';
  if (upper.includes('WAGON')) return 'wagon';
  if (upper.includes('COUPE')) return 'coupe';
  if (upper.includes('CONVERTIBLE') || upper.includes('CABRIOLET')) return 'convertible';
  if (upper.includes('VAN')) return 'van';
  
  return null;
}

// Calculate confidence based on extracted fields
function calculateConfidence(extracted: Record<string, unknown>): string {
  const coreFields = ['make', 'model', 'year', 'price'];
  const filledCore = coreFields.filter(f => extracted[f] !== null).length;
  
  if (filledCore >= 4) return 'high';
  if (filledCore >= 2) return 'medium';
  return 'low';
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { batch_size = 10 } = await req.json().catch(() => ({}));

  console.log(`[listing-normalizer] Starting normalization run, batch_size=${batch_size}`);

  // Get raw listings that haven't been normalized yet
  const { data: rawListings, error: fetchErr } = await supabase
    .from("listing_details_raw")
    .select("*")
    .eq("parse_status", "fetched")
    .order("fetched_at", { ascending: true })
    .limit(batch_size);

  if (fetchErr) {
    console.error("[listing-normalizer] Failed to fetch raw listings:", fetchErr);
    return new Response(
      JSON.stringify({ error: fetchErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!rawListings || rawListings.length === 0) {
    console.log("[listing-normalizer] No raw listings to process");
    return new Response(
      JSON.stringify({ message: "No listings to normalize", processed: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[listing-normalizer] Processing ${rawListings.length} raw listings`);

  const results = {
    processed: 0,
    normalized: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const raw of rawListings) {
    try {
      const text = raw.raw_text || '';
      const domainType = detectDomain(raw.domain, raw.url_canonical);
      
      // Extract all fields
      const make = extractMake(text);
      const model = extractModel(text, make);
      const year = extractYear(text);
      const km = extractKm(text);
      const price = extractPrice(text);
      const transmission = extractTransmission(text);
      const fuelType = extractFuelType(text);
      const bodyType = extractBodyType(text);

      const extractedFields = {
        make,
        model,
        year,
        km,
        price,
        transmission,
        fuel_type: fuelType,
        body_type: bodyType,
      };

      const confidence = calculateConfidence(extractedFields);

      // Upsert normalized record (idempotent - allows re-running normalization)
      const { error: upsertErr } = await supabase.from("listing_details_norm").upsert({
        account_id: raw.account_id,
        raw_id: raw.id,
        url_canonical: raw.url_canonical,
        domain: domainType,
        dealer_slug: raw.dealer_slug,
        make,
        model,
        year,
        km,
        price,
        transmission,
        fuel_type: fuelType,
        body_type: bodyType,
        extraction_confidence: confidence,
        extracted_fields: extractedFields,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'raw_id' });

      if (upsertErr) {
        throw upsertErr;
      }

      // Always mark as parsed - weak extraction is NOT a failure
      // Failure = system broke, not data was weak
      await supabase
        .from("listing_details_raw")
        .update({ parse_status: "parsed" })
        .eq("id", raw.id);

      results.processed++;
      if (confidence !== 'low') {
        results.normalized++;
      }

    } catch (err: unknown) {
      // Only mark failed on real system errors (code crashes, DB issues)
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[listing-normalizer] System error on ${raw.id}:`, errorMessage);
      
      await supabase
        .from("listing_details_raw")
        .update({ parse_status: "failed", error: errorMessage })
        .eq("id", raw.id);

      results.failed++;
      results.errors.push(`${raw.id}: ${errorMessage}`);
    }
  }

  console.log(`[listing-normalizer] Complete:`, results);

  return new Response(
    JSON.stringify({
      success: true,
      ...results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
