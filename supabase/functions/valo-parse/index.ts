import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ParsedVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
  body_style: string | null;
  variant_raw: string | null;
  variant_family: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  km: number | null;
  notes: string | null;
  missing_fields: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { description } = await req.json();
    
    if (!description || typeof description !== "string") {
      return new Response(
        JSON.stringify({ error: "Description is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a vehicle data extraction specialist. Parse the user's free-text description of a car and extract structured data.

RULES:
- Extract only what is explicitly stated or can be confidently inferred
- For uncertain fields, set to null and add to missing_fields
- Year: 4-digit year (e.g., 2025)
- KM: numeric kilometers (e.g., 10000 for "10,000 km")
- Make: manufacturer (Toyota, Ford, etc.)
- Model: model name (Hilux, Ranger, etc.)
- Variant family: trim level like SR5, GXL, XLT, Wildtrak (if mentioned)
- Body style: ute, sedan, SUV, wagon, hatch, van, etc.
- Engine: V8, V6, 4cyl, diesel, petrol, turbo diesel, 2.8L, etc.
- Transmission: auto, manual
- Drivetrain: 4x4, 4WD, AWD, 2WD, RWD, FWD
- Notes: any other relevant info like "nice car", "one owner", "service history"

Common Australian vehicle terms:
- "dual cab" = dual cab ute body style
- "single cab" = single cab ute
- "D/C" = dual cab
- "S/C" = single cab
- "turbo diesel" or "TD" = turbo diesel engine
- "auto" or "AT" = automatic transmission
- "manual" or "MT" = manual transmission`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Parse this vehicle description: "${description}"` }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_vehicle_data",
              description: "Extract structured vehicle data from a description",
              parameters: {
                type: "object",
                properties: {
                  year: { type: "number", nullable: true, description: "4-digit year" },
                  make: { type: "string", nullable: true, description: "Manufacturer" },
                  model: { type: "string", nullable: true, description: "Model name" },
                  body_style: { type: "string", nullable: true, description: "Body style" },
                  variant_raw: { type: "string", nullable: true, description: "Full variant string" },
                  variant_family: { type: "string", nullable: true, description: "Trim level family" },
                  engine: { type: "string", nullable: true, description: "Engine type" },
                  transmission: { type: "string", nullable: true, description: "auto or manual" },
                  drivetrain: { type: "string", nullable: true, description: "4x4, AWD, 2WD, etc." },
                  km: { type: "number", nullable: true, description: "Kilometers" },
                  notes: { type: "string", nullable: true, description: "Other details" },
                  missing_fields: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "Fields that could not be determined" 
                  }
                },
                required: ["missing_fields"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_vehicle_data" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to parse vehicle description" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    
    // Extract the tool call response
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "extract_vehicle_data") {
      console.error("Unexpected response format:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed: ParsedVehicle = JSON.parse(toolCall.function.arguments);
    
    // Ensure missing_fields is always an array
    if (!parsed.missing_fields) {
      parsed.missing_fields = [];
    }

    // Add fields that are null to missing_fields if not already there
    const fields = ['year', 'make', 'model', 'body_style', 'variant_family', 'engine', 'transmission', 'drivetrain', 'km'];
    for (const field of fields) {
      if (parsed[field as keyof ParsedVehicle] === null && !parsed.missing_fields.includes(field)) {
        parsed.missing_fields.push(field);
      }
    }

    console.log("Parsed vehicle:", JSON.stringify(parsed));

    return new Response(
      JSON.stringify({ parsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("VALO parse error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
