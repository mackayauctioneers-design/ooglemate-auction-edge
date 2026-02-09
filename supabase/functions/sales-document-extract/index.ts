import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Extract readable text from raw PDF bytes.
 * Works by finding text-rendering operators (Tj, TJ, BT/ET blocks) in the PDF stream.
 */
function extractTextFromPdfBytes(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i++) {
    raw += String.fromCharCode(bytes[i]);
  }

  const textChunks: string[] = [];

  const btBlocks = raw.match(/BT[\s\S]*?ET/g) || [];
  for (const block of btBlocks) {
    const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g) || [];
    for (const m of tjMatches) {
      const inner = m.match(/\(([^)]*)\)/);
      if (inner?.[1]) textChunks.push(inner[1]);
    }

    const tjArrays = block.match(/\[([^\]]*)\]\s*TJ/g) || [];
    for (const arr of tjArrays) {
      const parts = arr.match(/\(([^)]*)\)/g) || [];
      const line = parts.map(p => p.slice(1, -1)).join("");
      if (line.trim()) textChunks.push(line);
    }
  }

  if (textChunks.length === 0) {
    const readable = raw.match(/[\x20-\x7E]{8,}/g) || [];
    for (const chunk of readable) {
      if (/^(stream|endstream|endobj|obj|xref|trailer|startxref)/.test(chunk)) continue;
      if (/^\d+ \d+ R$/.test(chunk)) continue;
      if (chunk.includes("/Type") || chunk.includes("/Font") || chunk.includes("/Page")) continue;
      textChunks.push(chunk);
    }
  }

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
 * Parse a CSV string (from AI output) into headers + rows.
 */
function parseCSVOutput(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = csvText.split("\n").filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]).map(h => h.replace(/^["']|["']$/g, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.length === 1 && !values[0]) continue;
    const row: Record<string, string> = {};
    headers.forEach((col, idx) => {
      row[col] = (values[idx] || "").replace(/^["']|["']$/g, "");
    });
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Recover partial data from truncated JSON responses.
 */
function recoverTruncatedJson(content: string): { headers: string[]; rows: Record<string, string>[]; detected_format: string } | null {
  try {
    let str = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    
    const headersMatch = str.match(/"headers"\s*:\s*\[([^\]]*)\]/);
    if (!headersMatch) return null;
    
    const headers: string[] = JSON.parse(`[${headersMatch[1]}]`);
    if (!headers.length) return null;

    const rowsStart = str.indexOf('"rows"');
    if (rowsStart === -1) return null;
    
    const arrayStart = str.indexOf("[", rowsStart);
    if (arrayStart === -1) return null;
    
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
      const formatMatch = str.match(/"detected_format"\s*:\s*"([^"]*)"/);
      const detected_format = formatMatch?.[1] || "Unknown (recovered)";
      return { headers, rows, detected_format };
    }
  } catch (e) {
    console.error("[sales-document-extract] Recovery also failed:", e.message);
  }
  return null;
}

/**
 * Split text into chunks of roughly maxChars, splitting on line boundaries.
 */
function splitTextChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }
    // Find a good split point (space/period near the boundary)
    let splitAt = maxChars;
    const searchFrom = Math.max(0, maxChars - 500);
    const lastSpace = remaining.lastIndexOf(" ", maxChars);
    if (lastSpace > searchFrom) splitAt = lastSpace;
    
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trim();
  }
  return chunks;
}

/**
 * Call AI to extract rows from a text chunk, requesting CSV output.
 */
async function extractChunk(
  apiKey: string,
  textChunk: string,
  headerHint: string | null,
  filename: string,
  isFirstChunk: boolean
): Promise<{ headers: string[]; rows: Record<string, string>[]; detected_format: string }> {
  const systemPrompt = `You are a data extraction specialist for automotive dealer sales reports.

Given content from a dealer sales export document, extract the tabular sales data as CSV.

Rules:
- Identify column headers from the document structure
- Extract EVERY row of vehicle sale data — do not skip or summarise
- If there's a combined "Description" or "Vehicle" field, keep it as-is — do NOT split it
- Clean up any formatting artefacts (page breaks, repeated headers, footers, page numbers)
- Ignore totals rows, summary rows, page numbers, report headers/footers
- Return the data as CSV format with the FIRST LINE being the header row
- Quote fields that contain commas
- Include ALL rows, no matter how many there are

${headerHint ? `Use these exact column headers (from the first chunk): ${headerHint}` : ""}

After the CSV data, on a new line write: FORMAT: <detected format name>

Example output:
Stock No,Description,Sale Date,Days in Stock,Selling Price,Profit
642,"Ford Ranger 2010 PK XLT Utility",05/06/25,629,"$6,100.00","-$6,184.79"
FORMAT: EasyCars PDF`;

  const userText = isFirstChunk
    ? `Extract ALL tabular sales data from this dealer report (filename: ${filename}):\n\n${textChunk}`
    : `Continue extracting rows from the same report. Use the same column headers. Here is the next section:\n\n${textChunk}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        temperature: 0.1,
        max_tokens: 16000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const status = response.status;
      const body = await response.text();
      console.error(`[sales-document-extract] AI error: ${status}`, body.slice(0, 500));
      throw new Error(`AI extraction failed (status ${status})`);
    }

    const aiResult = await response.json();
    const content: string = aiResult.choices?.[0]?.message?.content || "";
    console.log(`[sales-document-extract] Chunk response length: ${content.length}`);

    // Try to extract detected format
    const formatMatch = content.match(/FORMAT:\s*(.+)/i);
    const detected_format = formatMatch?.[1]?.trim() || "Unknown";

    // Remove the FORMAT line and any markdown fences
    let csvContent = content
      .replace(/FORMAT:\s*.+/gi, "")
      .replace(/```csv\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    // Try CSV parse first
    const csvResult = parseCSVOutput(csvContent);
    if (csvResult.headers.length > 0 && csvResult.rows.length > 0) {
      return { ...csvResult, detected_format };
    }

    // Fallback: try JSON parse (in case AI returned JSON anyway)
    try {
      const jsonStr = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.headers?.length && parsed.rows?.length) {
          return { headers: parsed.headers, rows: parsed.rows, detected_format: parsed.detected_format || detected_format };
        }
      }
    } catch {}

    // Fallback: try truncated JSON recovery
    const recovered = recoverTruncatedJson(content);
    if (recovered) return recovered;

    return { headers: [], rows: [], detected_format };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("AI extraction timed out for this chunk.");
    }
    throw err;
  }
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

    // Reject excessively large PDFs (>12MB base64 ≈ ~9MB raw)
    if (payloadSizeKB > 12288) {
      console.warn(`[sales-document-extract] PDF too large: ${payloadSizeKB}KB`);
      return new Response(
        JSON.stringify({ error: "PDF is too large for AI extraction. Please export as CSV or XLSX instead." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let fullText = "";

    if (pdf_base64) {
      const rawBytes = Uint8Array.from(atob(pdf_base64), c => c.charCodeAt(0));
      const pdfText = extractTextFromPdfBytes(rawBytes);
      
      if (pdfText && pdfText.length > 100) {
        console.log(`[sales-document-extract] Extracted ${pdfText.length} chars of text from PDF`);
        fullText = pdfText;
      } else {
        // Fallback: send PDF as file for multimodal processing (small PDFs only)
        console.log(`[sales-document-extract] No text extracted, sending as multimodal file`);
        
        const userContent: any[] = [
          {
            type: "file",
            file: {
              filename: filename || "document.pdf",
              file_data: `data:application/pdf;base64,${pdf_base64}`,
            },
          },
          {
            type: "text",
            text: `Extract all tabular sales data from this PDF document. Return as CSV with header row first, then all data rows. After the CSV, write FORMAT: <detected format>`,
          },
        ];

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 55000);

        try {
          const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: "You are a data extraction specialist. Extract tabular sales data as CSV." },
                { role: "user", content: userContent },
              ],
              temperature: 0.1,
              max_tokens: 16000,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const status = response.status;
            return new Response(
              JSON.stringify({ error: `AI extraction failed (status ${status})` }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const aiResult = await response.json();
          const content = aiResult.choices?.[0]?.message?.content || "";
          
          // Parse the response
          const formatMatch = content.match(/FORMAT:\s*(.+)/i);
          const detected_format = formatMatch?.[1]?.trim() || "PDF";
          let csvContent = content.replace(/FORMAT:\s*.+/gi, "").replace(/```csv\s*/gi, "").replace(/```\s*/g, "").trim();
          
          const csvResult = parseCSVOutput(csvContent);
          if (csvResult.headers.length > 0) {
            console.log(`[sales-document-extract] Multimodal extracted ${csvResult.rows.length} rows`);
            return new Response(
              JSON.stringify({ ...csvResult, detected_format }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Try JSON fallback
          try {
            const jsonStr = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
            const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.headers?.length) {
                return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }
            }
          } catch {}

          return new Response(
            JSON.stringify({ headers: [], rows: [], detected_format: "unrecognised", error: "Could not extract data." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (fetchErr: any) {
          clearTimeout(timeoutId);
          if (fetchErr.name === "AbortError") {
            return new Response(
              JSON.stringify({ error: "AI extraction timed out." }),
              { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          throw fetchErr;
        }
      }
    } else {
      fullText = text_content || "";
    }

    // ── Chunked text extraction ──
    // Split into manageable chunks (~60k chars each, well within Gemini's context)
    const MAX_CHUNK_CHARS = 60000;
    const chunks = splitTextChunks(fullText, MAX_CHUNK_CHARS);
    console.log(`[sales-document-extract] Text length: ${fullText.length}, chunks: ${chunks.length}`);

    let allHeaders: string[] = [];
    let allRows: Record<string, string>[] = [];
    let detectedFormat = "";

    for (let i = 0; i < chunks.length; i++) {
      const headerHint = i > 0 && allHeaders.length > 0 ? allHeaders.join(",") : null;
      
      console.log(`[sales-document-extract] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
      
      const result = await extractChunk(
        LOVABLE_API_KEY,
        chunks[i],
        headerHint,
        filename || "document",
        i === 0
      );

      if (i === 0) {
        allHeaders = result.headers;
        detectedFormat = result.detected_format;
      }
      
      if (result.rows.length > 0) {
        allRows = allRows.concat(result.rows);
      }
      
      console.log(`[sales-document-extract] Chunk ${i + 1}: ${result.rows.length} rows (total: ${allRows.length})`);
    }

    if (!allHeaders.length) {
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

    console.log(`[sales-document-extract] Total extracted: ${allRows.length} rows with ${allHeaders.length} columns`);

    return new Response(
      JSON.stringify({ headers: allHeaders, rows: allRows, detected_format: detectedFormat }),
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
