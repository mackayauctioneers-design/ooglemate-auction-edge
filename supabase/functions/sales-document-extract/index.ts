import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Extract readable text from raw PDF bytes.
 * Works by finding text-rendering operators (Tj, TJ, BT/ET blocks) in the PDF stream.
 * This is a lightweight heuristic — handles most text-based PDFs (DMS exports, EasyCars, etc.)
 * but won't work on scanned/image-only PDFs.
 */
function extractTextFromPdfBytes(bytes: Uint8Array): string {
  // Decode the raw bytes to a string (Latin-1 to preserve byte values)
  let raw = "";
  for (let i = 0; i < bytes.length; i++) {
    raw += String.fromCharCode(bytes[i]);
  }

  const textChunks: string[] = [];

  // Strategy 1: Extract from text streams between BT...ET blocks
  // Match parenthesised strings inside BT/ET (the Tj/TJ operators)
  const btBlocks = raw.match(/BT[\s\S]*?ET/g) || [];
  for (const block of btBlocks) {
    // Extract strings from Tj operator: (text) Tj
    const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g) || [];
    for (const m of tjMatches) {
      const inner = m.match(/\(([^)]*)\)/);
      if (inner?.[1]) textChunks.push(inner[1]);
    }

    // Extract strings from TJ operator: [(text) num (text)] TJ
    const tjArrays = block.match(/\[([^\]]*)\]\s*TJ/g) || [];
    for (const arr of tjArrays) {
      const parts = arr.match(/\(([^)]*)\)/g) || [];
      const line = parts.map(p => p.slice(1, -1)).join("");
      if (line.trim()) textChunks.push(line);
    }
  }

  // Strategy 2: If no BT/ET blocks found, try to find any readable text patterns
  // This catches some PDFs where text is in different stream formats
  if (textChunks.length === 0) {
    // Look for sequences of printable ASCII characters (likely table data)
    const readable = raw.match(/[\x20-\x7E]{8,}/g) || [];
    for (const chunk of readable) {
      // Skip PDF internal operators/keywords
      if (/^(stream|endstream|endobj|obj|xref|trailer|startxref)/.test(chunk)) continue;
      if (/^\d+ \d+ R$/.test(chunk)) continue;
      if (chunk.includes("/Type") || chunk.includes("/Font") || chunk.includes("/Page")) continue;
      textChunks.push(chunk);
    }
  }

  // Clean up: unescape PDF string escapes
  const cleaned = textChunks
    .map(s => s
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\")
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

/**
 * Recover partial data from truncated JSON responses.
 * The AI sometimes runs out of tokens mid-JSON. This tries to salvage
 * complete rows from the truncated output.
 */
function recoverTruncatedJson(content: string): { headers: string[]; rows: Record<string, string>[]; detected_format: string } | null {
  try {
    // Strip markdown fences
    let str = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    
    // Extract headers array
    const headersMatch = str.match(/"headers"\s*:\s*\[([^\]]*)\]/);
    if (!headersMatch) return null;
    
    const headers: string[] = JSON.parse(`[${headersMatch[1]}]`);
    if (!headers.length) return null;

    // Find the rows array start
    const rowsStart = str.indexOf('"rows"');
    if (rowsStart === -1) return null;
    
    const arrayStart = str.indexOf("[", rowsStart);
    if (arrayStart === -1) return null;
    
    // Try to find complete row objects {...}
    const rowsSection = str.slice(arrayStart);
    const rows: Record<string, string>[] = [];
    const rowRegex = /\{[^{}]*\}/g;
    let match;
    
    while ((match = rowRegex.exec(rowsSection)) !== null) {
      try {
        const row = JSON.parse(match[0]);
        rows.push(row);
      } catch {
        // Skip malformed rows
      }
    }

    if (rows.length > 0) {
      console.log(`[sales-document-extract] Recovered ${rows.length} rows from truncated JSON`);
      
      // Try to extract detected_format
      const formatMatch = str.match(/"detected_format"\s*:\s*"([^"]*)"/);
      const detected_format = formatMatch?.[1] || "Unknown (recovered)";
      
      return { headers, rows, detected_format };
    }
  } catch (e) {
    console.error("[sales-document-extract] Recovery also failed:", e.message);
  }
  return null;
}

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
- Return ONLY valid JSON — NO markdown fences, NO trailing commas
- Use COMPACT JSON with NO unnecessary whitespace (minimised)
- If there are many rows, include ALL of them

Response format (compact, no whitespace):
{"headers":["Col1","Col2"],"rows":[{"Col1":"v1","Col2":"v2"}],"detected_format":"EasyCars PDF"}

If you cannot extract tabular data, return:
{"headers":[],"rows":[],"detected_format":"unrecognised","error":"Could not identify tabular data"}`;

    // Build messages based on input type
    const userContent: any[] = [];

    if (pdf_base64) {
      // Try extracting readable text from the PDF binary first
      const rawBytes = Uint8Array.from(atob(pdf_base64), c => c.charCodeAt(0));
      const pdfText = extractTextFromPdfBytes(rawBytes);
      
      if (pdfText && pdfText.length > 100) {
        // We got usable text from the PDF — send as text (much faster & more reliable)
        console.log(`[sales-document-extract] Extracted ${pdfText.length} chars of text from PDF`);
        userContent.push({
          type: "text",
          text: `Extract tabular sales data from this dealer report PDF (filename: ${filename || "unknown"}):\n\n${pdfText.slice(0, 30000)}`,
        });
      } else {
        // Fallback: send PDF as file for multimodal processing
        console.log(`[sales-document-extract] No text extracted, sending as multimodal file`);
        userContent.push({
          type: "file",
          file: {
            filename: filename || "document.pdf",
            file_data: `data:application/pdf;base64,${pdf_base64}`,
          },
        });
        userContent.push({
          type: "text",
          text: `Extract all tabular sales data from this PDF document. Return ONLY valid JSON with headers and rows arrays.`,
        });
      }
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
      // Strip markdown fences if present
      let jsonStr = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      console.warn("[sales-document-extract] JSON parse failed, attempting truncated recovery:", e.message);
      // Try to recover partial data from truncated JSON
      extracted = recoverTruncatedJson(content);
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
