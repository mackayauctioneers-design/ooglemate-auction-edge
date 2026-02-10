import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ============================================================================
// BOB-SOURCING-LINKS — Find live listings matching vehicles Bob mentioned
// Takes structured vehicle mentions → queries vehicle_listings + autotrader
// Returns scored listings with match quality badges
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface VehicleMention {
  make: string;
  model: string;
  variant?: string;
  year_min?: number;
  year_max?: number;
  drivetrain?: string;
  fuel_type?: string;
  transmission?: string;
  confidence_level: string;
}

interface ScoredListing {
  id: string;
  listing_url: string | null;
  make: string;
  model: string;
  variant_used: string | null;
  year: number;
  km: number | null;
  asking_price: number | null;
  source: string;
  source_class: string;
  auction_house: string | null;
  location: string | null;
  match_quality: "exact" | "close" | "loose";
  match_vehicle_index: number;
}

function scoreMatch(listing: any, mention: VehicleMention): "exact" | "close" | "loose" | null {
  // Must match make/model (case-insensitive)
  if (listing.make?.toLowerCase() !== mention.make.toLowerCase()) return null;
  if (listing.model?.toLowerCase() !== mention.model.toLowerCase()) return null;

  let specMatches = 0;
  let specChecks = 0;

  // Year range
  if (mention.year_min != null && mention.year_max != null) {
    specChecks++;
    if (listing.year >= mention.year_min && listing.year <= mention.year_max) specMatches++;
    else if (listing.year >= mention.year_min - 1 && listing.year <= mention.year_max + 1) {
      // Within ±1 tolerance — counts as partial
    } else {
      return null; // Too far outside year range
    }
  }

  // Variant
  if (mention.variant) {
    specChecks++;
    const lv = (listing.variant_used || listing.variant_raw || "").toLowerCase();
    if (lv.includes(mention.variant.toLowerCase())) specMatches++;
  }

  // Drivetrain
  if (mention.drivetrain) {
    specChecks++;
    const ld = (listing.drivetrain || "").toLowerCase();
    if (ld === mention.drivetrain.toLowerCase() || ld.includes(mention.drivetrain.toLowerCase())) specMatches++;
  }

  // Fuel
  if (mention.fuel_type) {
    specChecks++;
    const lf = (listing.fuel || "").toLowerCase();
    if (lf.includes(mention.fuel_type.toLowerCase())) specMatches++;
  }

  // Transmission
  if (mention.transmission) {
    specChecks++;
    const lt = (listing.transmission || "").toLowerCase();
    if (lt.includes(mention.transmission.toLowerCase())) specMatches++;
  }

  if (specChecks === 0) return "loose";
  const ratio = specMatches / specChecks;
  if (ratio >= 0.8) return "exact";
  if (ratio >= 0.4) return "close";
  return "loose";
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { bobResponse, accountId } = await req.json();

    if (!bobResponse || !accountId) {
      return new Response(
        JSON.stringify({ error: "bobResponse and accountId required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // ── Step 1: Extract structured vehicle mentions from Bob's response via AI tool call ──
    const extractionRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: "Extract all specific vehicle mentions from the text. Only include vehicles with at least a make and model. Be precise about variants, drivetrains, and specs when mentioned.",
          },
          { role: "user", content: bobResponse },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_vehicles",
              description: "Extract structured vehicle mentions from Bob's response text",
              parameters: {
                type: "object",
                properties: {
                  vehicles: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        make: { type: "string" },
                        model: { type: "string" },
                        variant: { type: "string", description: "Trim/variant if mentioned (e.g. SR5, Style, TDI500)" },
                        year_min: { type: "number", description: "Start of year range" },
                        year_max: { type: "number", description: "End of year range" },
                        drivetrain: { type: "string", description: "e.g. 4x4, 4x2, AWD" },
                        fuel_type: { type: "string", description: "e.g. Diesel, Petrol" },
                        transmission: { type: "string", description: "e.g. Auto, Manual" },
                        confidence_level: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                      },
                      required: ["make", "model", "confidence_level"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["vehicles"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_vehicles" } },
      }),
    });

    if (!extractionRes.ok) {
      console.error("Vehicle extraction failed:", extractionRes.status);
      return new Response(
        JSON.stringify({ vehicles: [], listings: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const extractionData = await extractionRes.json();
    let vehicles: VehicleMention[] = [];

    try {
      const toolCall = extractionData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        vehicles = parsed.vehicles || [];
      }
    } catch (e) {
      console.error("Failed to parse vehicle extraction:", e);
    }

    if (!vehicles.length) {
      return new Response(
        JSON.stringify({ vehicles: [], listings: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Limit to 6 unique vehicle mentions
    vehicles = vehicles.slice(0, 6);
    console.log(`[SOURCING] Extracted ${vehicles.length} vehicles:`, vehicles.map(v => `${v.make} ${v.model}`));

    // ── Step 2: Query listings for each vehicle ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const allListings: ScoredListing[] = [];

    // Build a single query to get relevant listings
    // We OR together make+model pairs
    const makeModelPairs = [...new Set(vehicles.map(v => `${v.make}|${v.model}`))];

    for (const pair of makeModelPairs) {
      const [make, model] = pair.split("|");

      // Query vehicle_listings (auction/dealer inventory)
      const { data: listings } = await supabase
        .from("vehicle_listings")
        .select("id, listing_url, make, model, variant_used, variant_raw, year, km, asking_price, source, source_class, auction_house, location, drivetrain, fuel, transmission, status, lifecycle_state")
        .ilike("make", make)
        .ilike("model", model)
        .in("lifecycle_state", ["active", "new", "watching"])
        .order("first_seen_at", { ascending: false })
        .limit(20);

      if (listings?.length) {
        for (const l of listings) {
          // Score against each vehicle mention
          for (let vi = 0; vi < vehicles.length; vi++) {
            const v = vehicles[vi];
            if (v.make.toLowerCase() !== make.toLowerCase() || v.model.toLowerCase() !== model.toLowerCase()) continue;
            const quality = scoreMatch(l, v);
            if (quality) {
              allListings.push({
                id: l.id,
                listing_url: l.listing_url,
                make: l.make,
                model: l.model,
                variant_used: l.variant_used || l.variant_raw,
                year: l.year,
                km: l.km,
                asking_price: l.asking_price,
                source: l.source,
                source_class: l.source_class,
                auction_house: l.auction_house,
                location: l.location,
                match_quality: quality,
                match_vehicle_index: vi,
              });
              break; // Don't double-count same listing
            }
          }
        }
      }

      // Also check autotrader_raw_payloads for retail coverage
      const { data: atListings } = await supabase
        .from("autotrader_raw_payloads")
        .select("id, source_listing_id, payload, price_at_last_seen, last_seen_at")
        .limit(15);

      // autotrader payloads are JSON - filter client-side
      if (atListings?.length) {
        for (const at of atListings) {
          const p = at.payload as any;
          if (!p?.make || !p?.model) continue;
          if (p.make.toLowerCase() !== make.toLowerCase() || p.model.toLowerCase() !== model.toLowerCase()) continue;

          for (let vi = 0; vi < vehicles.length; vi++) {
            const v = vehicles[vi];
            if (v.make.toLowerCase() !== make.toLowerCase() || v.model.toLowerCase() !== model.toLowerCase()) continue;
            const fakeListing = {
              make: p.make, model: p.model,
              variant_used: p.variant || p.badge,
              variant_raw: p.variant || p.badge,
              year: p.year, km: p.km,
              drivetrain: p.drivetrain, fuel: p.fuel_type, transmission: p.transmission,
            };
            const quality = scoreMatch(fakeListing, v);
            if (quality) {
              allListings.push({
                id: at.id,
                listing_url: p.url || null,
                make: p.make,
                model: p.model,
                variant_used: p.variant || p.badge || null,
                year: p.year,
                km: p.km,
                asking_price: at.price_at_last_seen || p.price,
                source: "autotrader",
                source_class: "classifieds",
                auction_house: null,
                location: p.location || null,
                match_quality: quality,
                match_vehicle_index: vi,
              });
              break;
            }
          }
        }
      }
    }

    // Sort: exact first, then close, then loose. Limit per vehicle.
    const qualityOrder = { exact: 0, close: 1, loose: 2 };
    allListings.sort((a, b) => qualityOrder[a.match_quality] - qualityOrder[b.match_quality]);

    // Limit to 6 listings per vehicle mention, 18 total
    const perVehicle: Record<number, number> = {};
    const finalListings = allListings.filter(l => {
      const count = perVehicle[l.match_vehicle_index] || 0;
      if (count >= 6) return false;
      perVehicle[l.match_vehicle_index] = count + 1;
      return true;
    }).slice(0, 18);

    // Deduplicate by id
    const seen = new Set<string>();
    const dedupedListings = finalListings.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    return new Response(
      JSON.stringify({ vehicles, listings: dedupedListings }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("bob-sourcing-links error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
