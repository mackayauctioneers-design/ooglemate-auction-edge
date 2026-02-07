import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text_content, filename } = await req.json();

    if (!text_content) {
      return new Response(
        JSON.stringify({ error: "text_content required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[sales-document-extract] Processing ${filename || "document"}, content length: ${text_content.length}`);

    const systemPrompt = `You are a data extraction specialist for automotive dealer sales reports.

Given raw text content from a PDF or document export (like EasyCars, DealerSocket, AutoPlay, etc.), extract the tabular sales data.

Rules:
- Identify column headers from the document structure
- Extract each row of vehicle sale data
- If there's a combined "Description" or "Vehicle" field, keep it as-is — do NOT split it
- Clean up any formatting artefacts (page breaks, repeated headers, etc.)
- Return ONLY valid JSON

Response format:
{
  "headers": ["Column1", "Column2", ...],
  "rows": [
    {"Column1": "value1", "Column2": "value2", ...},
    ...
  ],
  "detected_format": "EasyCars PDF" | "DealerSocket Export" | "Unknown"
}

If you cannot extract tabular data, return:
{
  "headers": [],
  "rows": [],
  "detected_format": "unrecognised",
  "error": "Could not identify tabular data in this document"
}`;

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
          {
            role: "user",
            content: `Extract tabular sales data from this document (filename: ${filename || "unknown"}):\n\n${text_content.slice(0, 15000)}`,
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      console.error(`[sales-document-extract] AI gateway error: ${status}`);

      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "AI extraction failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || "";

    let extracted;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      console.error("[sales-document-extract] Failed to parse AI response");
      extracted = null;
    }

    if (!extracted || !extracted.headers?.length) {
      return new Response(
        JSON.stringify({
          headers: [],
          rows: [],
          detected_format: "unrecognised",
          error: "Could not extract tabular data from this document. Try CSV or XLSX instead.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[sales-document-extract] Extracted ${extracted.rows?.length || 0} rows with ${extracted.headers.length} columns`);

    return new Response(
      JSON.stringify(extracted),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[sales-document-extract] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
