import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SnapIdRequest {
  session_id: string;
}

interface VehicleIdentification {
  make: string | null;
  model: string | null;
  year_min: number | null;
  year_max: number | null;
  variant: string | null;
  transmission: string | null;
  fuel_type: string | null;
  body_type: string | null;
  confidence: "high" | "medium" | "low";
  known_issues: string[];
  avoided_issues: string[];
  why_this_matters: string;
}

// Known vehicle issues database (expandable)
const KNOWN_ISSUES: Record<string, string[]> = {
  "TOYOTA_HILUX": ["DPF issues on 2.8L diesel", "Injector problems pre-2020"],
  "TOYOTA_LANDCRUISER": ["Head gasket issues on 1VD-FTV", "Turbo failures"],
  "FORD_RANGER": ["Dual-clutch transmission issues (PX2/PX3)", "Engine timing chain"],
  "MAZDA_BT-50": ["Same platform as Ranger - check transmission"],
  "VOLKSWAGEN_AMAROK": ["Timing chain tensioner", "AdBlue system issues"],
  "NISSAN_NAVARA": ["D40 timing chain failures", "Chassis cracking (D22)"],
  "MITSUBISHI_TRITON": ["DPF issues", "Clutch problems on manual"],
  "HOLDEN_COLORADO": ["Injector issues", "Head gasket (pre-2017)"],
  "ISUZU_D-MAX": ["Generally reliable", "Check service history"],
};

// VIN decoding patterns (simplified - real implementation would use NHTSA/NEVDIS)
function decodeVin(vin: string): Partial<VehicleIdentification> {
  // World Manufacturer Identifier (first 3 characters)
  const wmi = vin.substring(0, 3).toUpperCase();
  
  // Basic manufacturer detection
  const manufacturers: Record<string, string> = {
    "1G1": "CHEVROLET", "1G2": "PONTIAC", "1GC": "CHEVROLET",
    "1HG": "HONDA", "1FA": "FORD", "1FT": "FORD",
    "1N4": "NISSAN", "1N6": "NISSAN",
    "2HG": "HONDA", "2HM": "HYUNDAI",
    "3FA": "FORD", "3VW": "VOLKSWAGEN",
    "5N1": "NISSAN", "5NP": "HYUNDAI",
    "JA3": "MITSUBISHI", "JA4": "MITSUBISHI",
    "JH4": "ACURA", "JHM": "HONDA",
    "JM1": "MAZDA", "JM3": "MAZDA",
    "JN1": "NISSAN", "JN8": "NISSAN",
    "JT3": "TOYOTA", "JT4": "TOYOTA", "JTD": "TOYOTA", "JTE": "TOYOTA",
    "KM8": "HYUNDAI", "KNA": "KIA", "KND": "KIA",
    "MR0": "TOYOTA", "MR1": "TOYOTA",
    "SAL": "LAND ROVER", "SAJ": "JAGUAR",
    "VF1": "RENAULT", "VF3": "PEUGEOT",
    "W0L": "OPEL", "WAU": "AUDI", "WBA": "BMW", "WBS": "BMW M",
    "WDB": "MERCEDES", "WDC": "MERCEDES", "WDD": "MERCEDES",
    "WF0": "FORD", "WVW": "VOLKSWAGEN", "WVG": "VOLKSWAGEN",
    "YV1": "VOLVO", "YV4": "VOLVO",
    "ZAM": "MASERATI", "ZAR": "ALFA ROMEO", "ZFA": "FIAT", "ZFF": "FERRARI",
    "6F4": "FORD", "6G1": "HOLDEN", "6G2": "PONTIAC",
    "6H1": "HOLDEN", "6MM": "MITSUBISHI",
    "6T1": "TOYOTA", "6T2": "TOYOTA",
    "MNT": "TOYOTA", "MNB": "FORD",
  };

  const make = manufacturers[wmi] || null;
  
  // Year from 10th character (simplified)
  const yearChar = vin.charAt(9);
  const yearCodes: Record<string, number> = {
    "A": 2010, "B": 2011, "C": 2012, "D": 2013, "E": 2014,
    "F": 2015, "G": 2016, "H": 2017, "J": 2018, "K": 2019,
    "L": 2020, "M": 2021, "N": 2022, "P": 2023, "R": 2024,
    "S": 2025, "T": 2026,
  };
  const year = yearCodes[yearChar.toUpperCase()] || null;

  return {
    make,
    year_min: year,
    year_max: year,
  };
}

// Generate intelligence summary
function generateIntelligence(vehicle: Partial<VehicleIdentification>): VehicleIdentification {
  const { make, model } = vehicle;
  const key = `${make}_${model}`.toUpperCase().replace(/\s+/g, "_");
  
  const knownIssues = KNOWN_ISSUES[key] || [];
  const avoidedIssues: string[] = [];
  
  // If we have year info, we can be more specific about avoided issues
  if (vehicle.year_min && vehicle.year_min >= 2020) {
    avoidedIssues.push("Pre-facelift issues typically resolved");
  }
  
  let whyThisMatters = "";
  if (make && model) {
    whyThisMatters = `Identified as ${make} ${model}. `;
    if (knownIssues.length > 0) {
      whyThisMatters += `This model has ${knownIssues.length} known concern area(s) to check. `;
    } else {
      whyThisMatters += "No major known issues in our database for this model. ";
    }
    whyThisMatters += "Always verify with a mechanical inspection.";
  } else {
    whyThisMatters = "Unable to identify vehicle model. Manual verification required.";
  }

  return {
    make: vehicle.make || null,
    model: vehicle.model || null,
    year_min: vehicle.year_min || null,
    year_max: vehicle.year_max || null,
    variant: vehicle.variant || null,
    transmission: vehicle.transmission || null,
    fuel_type: vehicle.fuel_type || null,
    body_type: vehicle.body_type || null,
    confidence: vehicle.make && vehicle.model ? "high" : vehicle.make ? "medium" : "low",
    known_issues: knownIssues,
    avoided_issues: avoidedIssues,
    why_this_matters: whyThisMatters,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { session_id }: SnapIdRequest = await req.json();

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[snap-id-process] Processing session: ${session_id}`);

    // Get the session
    const { data: session, error: sessionErr } = await supabase
      .from("snap_id_sessions")
      .select("*")
      .eq("id", session_id)
      .single();

    if (sessionErr || !session) {
      return new Response(
        JSON.stringify({ error: "Session not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark as processing
    await supabase
      .from("snap_id_sessions")
      .update({ status: "processing" })
      .eq("id", session_id);

    // Get the compliance plate image from storage
    if (!session.compliance_plate_path) {
      await supabase
        .from("snap_id_sessions")
        .update({ status: "failed", error: "No compliance plate image uploaded" })
        .eq("id", session_id);

      return new Response(
        JSON.stringify({ error: "No compliance plate image" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Download the image
    const { data: imageData, error: downloadErr } = await supabase.storage
      .from("snap-id-photos")
      .download(session.compliance_plate_path);

    if (downloadErr || !imageData) {
      console.error("[snap-id-process] Failed to download image:", downloadErr);
      await supabase
        .from("snap_id_sessions")
        .update({ status: "failed", error: "Failed to download image" })
        .eq("id", session_id);

      return new Response(
        JSON.stringify({ error: "Failed to download image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Convert to base64 for AI processing
    const arrayBuffer = await imageData.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const mimeType = imageData.type || "image/jpeg";

    // Use Lovable AI (Gemini) for OCR and vehicle identification
    console.log("[snap-id-process] Sending to AI for OCR...");
    
    const aiResponse = await fetch("https://api.lovable.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this vehicle compliance plate or VIN plate image. Extract:
1. VIN (Vehicle Identification Number) - 17 characters
2. Make (manufacturer)
3. Model
4. Year of manufacture
5. Variant/trim level if visible
6. Transmission type if visible
7. Engine/fuel type if visible
8. Body type if visible

Return ONLY a JSON object with these exact fields:
{
  "vin": "extracted VIN or null",
  "make": "manufacturer name or null",
  "model": "model name or null", 
  "year": year as number or null,
  "variant": "variant/trim or null",
  "transmission": "auto/manual/cvt or null",
  "fuel_type": "petrol/diesel/hybrid/electric or null",
  "body_type": "sedan/suv/ute/wagon/hatch/van or null",
  "confidence": "high/medium/low",
  "raw_text": "all text visible on the plate"
}

If you cannot read something clearly, set it to null. Be conservative with confidence.`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 500,
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("[snap-id-process] AI API error:", errorText);
      
      // Fallback: try basic VIN extraction from any text we might have
      await supabase
        .from("snap_id_sessions")
        .update({ 
          status: "failed", 
          error: `AI processing failed: ${aiResponse.status}`,
          vehicle_confidence: "low",
          why_this_matters: "AI processing unavailable. Please try again or enter details manually."
        })
        .eq("id", session_id);

      return new Response(
        JSON.stringify({ error: "AI processing failed", details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await aiResponse.json();
    const aiContent = aiResult.choices?.[0]?.message?.content || "";
    
    console.log("[snap-id-process] AI response:", aiContent);

    // Parse the JSON from AI response
    let extracted: {
      vin?: string;
      make?: string;
      model?: string;
      year?: number;
      variant?: string;
      transmission?: string;
      fuel_type?: string;
      body_type?: string;
      confidence?: string;
      raw_text?: string;
    } = {};

    try {
      // Find JSON in the response
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.error("[snap-id-process] Failed to parse AI response:", parseErr);
    }

    // If we got a VIN, try to decode it for additional info
    let vinDecoded: Partial<VehicleIdentification> = {};
    if (extracted.vin && extracted.vin.length === 17) {
      vinDecoded = decodeVin(extracted.vin);
    }

    // Merge AI extraction with VIN decoding (AI takes priority where available)
    const mergedVehicle: Partial<VehicleIdentification> = {
      make: extracted.make || vinDecoded.make || null,
      model: extracted.model || null,
      year_min: extracted.year || vinDecoded.year_min || null,
      year_max: extracted.year || vinDecoded.year_max || null,
      variant: extracted.variant || null,
      transmission: extracted.transmission || null,
      fuel_type: extracted.fuel_type || null,
      body_type: extracted.body_type || null,
    };

    // Generate intelligence summary
    const intelligence = generateIntelligence(mergedVehicle);

    // Update session with results
    const { error: updateErr } = await supabase
      .from("snap_id_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        extracted_vin: extracted.vin || null,
        vin_confidence: extracted.confidence || "low",
        identified_make: intelligence.make,
        identified_model: intelligence.model,
        identified_year_min: intelligence.year_min,
        identified_year_max: intelligence.year_max,
        identified_variant: intelligence.variant,
        identified_transmission: intelligence.transmission,
        identified_fuel_type: intelligence.fuel_type,
        identified_body_type: intelligence.body_type,
        vehicle_confidence: intelligence.confidence,
        known_issues: intelligence.known_issues,
        avoided_issues: intelligence.avoided_issues,
        why_this_matters: intelligence.why_this_matters,
        ocr_raw: { ai_response: extracted, vin_decoded: vinDecoded },
      })
      .eq("id", session_id);

    if (updateErr) {
      console.error("[snap-id-process] Failed to update session:", updateErr);
      throw updateErr;
    }

    console.log(`[snap-id-process] Completed session: ${session_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        session_id,
        vehicle: intelligence,
        vin: extracted.vin || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[snap-id-process] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
