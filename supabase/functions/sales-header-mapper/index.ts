import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CANONICAL_FIELDS = [
  { name: "sold_at", description: "Date the vehicle was sold (sale date, sold date)" },
  { name: "acquired_at", description: "Date the vehicle was acquired/purchased (buy date, stock date). Optional." },
  { name: "make", description: "Vehicle manufacturer (Toyota, Ford, Hyundai, etc.)" },
  { name: "model", description: "Vehicle model (Hilux, Ranger, i30, etc.)" },
  { name: "variant", description: "Trim/variant (SR5, XLS, N-Line, etc.). Optional." },
  { name: "year", description: "Model year (2020, 2021, etc.)" },
  { name: "km", description: "Odometer reading in kilometres" },
  { name: "sale_price", description: "Sale price / sell price in dollars" },
  { name: "buy_price", description: "Purchase/buy price. Optional." },
  { name: "transmission", description: "Auto/Manual. Optional." },
  { name: "fuel_type", description: "Petrol/Diesel/Hybrid/Electric. Optional." },
  { name: "body_type", description: "Sedan/SUV/Ute/Hatch etc. Optional." },
  { name: "notes", description: "Any additional notes. Optional." },
  { name: "location", description: "Location/state/region. Optional." },
  { name: "dealer_name", description: "Dealer or yard name. Optional." },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { headers, sample_rows } = await req.json();

    if (!headers || !Array.isArray(headers)) {
      return new Response(
        JSON.stringify({ error: "headers array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      // Fallback: heuristic mapping
      console.log("[sales-header-mapper] No API key, using heuristic mapping");
      const mapping = heuristicMap(headers);
      return new Response(
        JSON.stringify({ mapping, method: "heuristic" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fieldDescriptions = CANONICAL_FIELDS
      .map(f => `- "${f.name}": ${f.description}`)
      .join("\n");

    const sampleContext = sample_rows?.length
      ? `\n\nHere are some sample data rows to help with mapping:\n${JSON.stringify(sample_rows.slice(0, 3), null, 2)}`
      : "";

    const systemPrompt = `You are a data mapping assistant for an automotive dealer sales system.
Given a list of CSV/spreadsheet column headers from a dealer's sales export, map each header to the most appropriate canonical field.

Canonical fields:
${fieldDescriptions}

Rules:
- Map each source header to exactly one canonical field, or null if no match
- Be flexible with naming (e.g. "Sale Date", "SaleDate", "date_sold", "Sold" all map to "sold_at")
- "Price", "Selling Price", "Sell Price", "Sale Price" → "sale_price"
- "Purchase Price", "Cost", "Buy Price", "Cost Price" → "buy_price"  
- "Odo", "Odometer", "KMs", "Kilometres", "Mileage" → "km"
- "Year", "Model Year", "Yr" → "year"
- "Trans", "Gearbox" → "transmission"
- Headers like "ID", "Stock No", "Reference" should map to null (not needed)
- Return ONLY valid JSON object mapping source_header → canonical_field_or_null`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Map these headers to canonical fields:\n\nHeaders: ${JSON.stringify(headers)}${sampleContext}\n\nRespond with ONLY a JSON object like: {"Source Header": "canonical_field", "Other Header": null}` }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error("[sales-header-mapper] AI error:", response.status);
      // Fallback to heuristic
      const mapping = heuristicMap(headers);
      return new Response(
        JSON.stringify({ mapping, method: "heuristic_fallback" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || "";
    
    // Extract JSON from response
    let mapping: Record<string, string | null>;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      mapping = jsonMatch ? JSON.parse(jsonMatch[0]) : heuristicMap(headers);
    } catch {
      console.error("[sales-header-mapper] Failed to parse AI response, using heuristic");
      mapping = heuristicMap(headers);
    }

    return new Response(
      JSON.stringify({ mapping, method: "ai" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[sales-header-mapper] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function heuristicMap(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const patterns: [RegExp, string][] = [
    [/^(sale[_\s]?date|sold[_\s]?(date|at|on)?|date[_\s]?sold)$/i, "sold_at"],
    [/^(acqu|buy[_\s]?date|purchase[_\s]?date|stock[_\s]?date|date[_\s]?(bought|acquired|purchased))$/i, "acquired_at"],
    [/^(make|manufacturer|brand)$/i, "make"],
    [/^(model|model[_\s]?name)$/i, "model"],
    [/^(variant|trim|badge|grade|spec|series)$/i, "variant"],
    [/^(year|model[_\s]?year|yr)$/i, "year"],
    [/^(km|kms|kilometres?|kilometers?|odo|odometer|mileage)$/i, "km"],
    [/^(sale[_\s]?price|sell[_\s]?price|selling[_\s]?price|sold[_\s]?for|price)$/i, "sale_price"],
    [/^(buy[_\s]?price|purchase[_\s]?price|cost[_\s]?price|cost|bought[_\s]?for)$/i, "buy_price"],
    [/^(trans|transmission|gearbox|gear)$/i, "transmission"],
    [/^(fuel|fuel[_\s]?type|engine[_\s]?type)$/i, "fuel_type"],
    [/^(body|body[_\s]?type|body[_\s]?style|type)$/i, "body_type"],
    [/^(notes?|comments?|remarks?)$/i, "notes"],
    [/^(location|state|region|city|suburb)$/i, "location"],
    [/^(dealer|dealer[_\s]?name|yard|business)$/i, "dealer_name"],
  ];

  for (const header of headers) {
    const clean = header.trim();
    let matched = false;
    for (const [pattern, field] of patterns) {
      if (pattern.test(clean)) {
        mapping[header] = field;
        matched = true;
        break;
      }
    }
    if (!matched) mapping[header] = null;
  }

  return mapping;
}
