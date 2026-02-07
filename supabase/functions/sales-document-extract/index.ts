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
    const { text_content, pdf_base64, filename } = await req.json();

    if (!text_content && !pdf_base64) {
      return new Response(
        JSON.stringify({ error: "text_content or pdf_base64 required" }),
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

    const payloadSizeKB = pdf_base64 ? Math.round(pdf_base64.length / 1024) : 0;
    console.log(`[sales-document-extract] Processing ${filename || "document"}, mode: ${pdf_base64 ? "pdf_base64" : "text"}, payload: ${payloadSizeKB}KB`);

    // Reject excessively large PDFs (>8MB base64 ≈ ~6MB raw)
    if (payloadSizeKB > 8192) {
      console.warn(`[sales-document-extract] PDF too large: ${payloadSizeKB}KB`);
      return new Response(
        JSON.stringify({ error: "PDF is too large for AI extraction. Please export as CSV or XLSX instead." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a data extraction specialist for automotive dealer sales reports.

Given content from a dealer sales export document (PDF, EasyCars report, DealerSocket export, etc.), extract the tabular sales data.

Rules:
- Identify column headers from the document structure
- Extract each row of vehicle sale data
- If there's a combined "Description" or "Vehicle" field, keep it as-is — do NOT split it
- Clean up any formatting artefacts (page breaks, repeated headers, footers, etc.)
- Ignore totals rows, summary rows, page numbers
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

    // Build messages based on input type
    const userContent: any[] = [];

    if (pdf_base64) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:application/pdf;base64,${pdf_base64}`,
        },
      });
      userContent.push({
        type: "text",
        text: `Extract all tabular sales data from this PDF document (filename: ${filename || "unknown"}). Return ONLY valid JSON with headers and rows arrays.`,
      });
    } else {
      userContent.push({
        type: "text",
        text: `Extract tabular sales data from this document (filename: ${filename || "unknown"}):\n\n${text_content.slice(0, 15000)}`,
      });
    }

    // Use AbortController to enforce a 50s timeout (edge functions have ~60s limit)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50000);

    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          temperature: 0.1,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === "AbortError") {
        console.error("[sales-document-extract] AI gateway timeout after 50s");
        return new Response(
          JSON.stringify({ error: "AI extraction timed out. The PDF may be too large or complex — try exporting as CSV instead." }),
          { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw fetchErr;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const status = response.status;
      const body = await response.text();
      console.error(`[sales-document-extract] AI gateway error: ${status}`, body);

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
        JSON.stringify({ error: `AI extraction failed (status ${status})` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || "";

    console.log(`[sales-document-extract] AI response length: ${content.length}`);

    let extracted;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      console.error("[sales-document-extract] Failed to parse AI response:", e.message);
      console.error("[sales-document-extract] Raw content:", content.slice(0, 500));
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
      JSON.stringify({ error: err.message || "Unexpected error during extraction" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
