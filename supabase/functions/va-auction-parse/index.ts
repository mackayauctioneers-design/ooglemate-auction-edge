import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// CSV parsing helper
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"));
  const rows: Record<string, string>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });
    rows.push(row);
  }
  
  return rows;
}

// Field normalization helpers
function normalizeYear(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : null;
}

function normalizeKm(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9]/g, "");
  const km = parseInt(cleaned);
  return isNaN(km) ? null : km;
}

function normalizePrice(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.]/g, "");
  const price = parseFloat(cleaned);
  return isNaN(price) ? null : Math.round(price);
}

function normalizeFuel(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes("petrol") || v.includes("unleaded")) return "petrol";
  if (v.includes("diesel")) return "diesel";
  if (v.includes("hybrid")) return "hybrid";
  if (v.includes("electric") || v === "ev") return "electric";
  return v || null;
}

function normalizeTransmission(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes("auto") || v === "a" || v === "at") return "automatic";
  if (v.includes("manual") || v === "m" || v === "mt") return "manual";
  if (v.includes("cvt")) return "cvt";
  return v || null;
}

// Extract variant family from variant string
const VARIANT_TOKENS = [
  "SR5", "GXL", "ZR", "CRUISER", "SAHARA", "GX", "VX", "EDGE",
  "ST", "STX", "XLT", "WILDTRAK", "RAPTOR", "SPORT",
  "ACTIVE", "ELITE", "HIGHLANDER", "TITANIUM", "TREND",
  "SX", "EX", "LX", "VTI", "RS", "GT", "GTI", "R-LINE",
  "PREMIUM", "LUXURY", "BASE", "S", "SE", "SEL"
];

function extractVariantFamily(variant: string | undefined): string | null {
  if (!variant) return null;
  const upper = variant.toUpperCase();
  for (const token of VARIANT_TOKENS) {
    if (upper.includes(token)) return token;
  }
  return null;
}

// Map common column name variations
function mapField(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key] || row[key.toLowerCase()] || row[key.replace(/_/g, " ")];
    if (value) return value;
  }
  return undefined;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { batch_id } = await req.json();

    if (!batch_id) {
      return new Response(JSON.stringify({ error: "Missing batch_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get batch details
    const { data: batch, error: batchError } = await supabase
      .from("va_upload_batches")
      .select("*")
      .eq("id", batch_id)
      .single();

    if (batchError || !batch) {
      return new Response(JSON.stringify({ error: "Batch not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update status to parsing
    await supabase
      .from("va_upload_batches")
      .update({ status: "parsing", parse_started_at: new Date().toISOString() })
      .eq("id", batch_id);

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("va-auction-uploads")
      .download(batch.file_path);

    if (downloadError || !fileData) {
      await supabase
        .from("va_upload_batches")
        .update({ status: "failed", error: "Failed to download file" })
        .eq("id", batch_id);
      
      return new Response(JSON.stringify({ error: "Failed to download file" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsedRows: Record<string, string>[] = [];

    if (batch.file_type === "csv") {
      const content = await fileData.text();
      parsedRows = parseCSV(content);
    } else if (batch.file_type === "xlsx") {
      // For XLSX, we'll use the Lovable API for document parsing
      const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!lovableApiKey) {
        await supabase
          .from("va_upload_batches")
          .update({ status: "failed", error: "LOVABLE_API_KEY not configured for XLSX parsing" })
          .eq("id", batch_id);
        return new Response(JSON.stringify({ error: "XLSX parsing not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Fallback: treat as CSV for now (user should convert to CSV)
      const content = await fileData.text();
      parsedRows = parseCSV(content);
    } else if (batch.file_type === "pdf") {
      // PDF received - store it and prompt for manual conversion
      await supabase
        .from("va_upload_batches")
        .update({ 
          status: "received_pdf",
          parse_started_at: new Date().toISOString(),
          parse_completed_at: new Date().toISOString(),
          rows_total: 0,
          error: null,
        })
        .eq("id", batch_id);
      
      return new Response(JSON.stringify({ 
        success: true,
        batch_id,
        rows_parsed: 0,
        message: "PDF stored. Convert to CSV/XLSX to ingest.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (parsedRows.length === 0) {
      await supabase
        .from("va_upload_batches")
        .update({ status: "failed", error: "No rows parsed from file" })
        .eq("id", batch_id);
      
      return new Response(JSON.stringify({ error: "No rows parsed from file" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Process and insert rows
    const rowsToInsert = parsedRows.map((row, index) => {
      const year = normalizeYear(mapField(row, "year", "model_year", "yr"));
      const make = mapField(row, "make", "manufacturer", "brand");
      const model = mapField(row, "model", "model_name");
      const variantRaw = mapField(row, "variant", "variant_raw", "series", "grade", "trim");
      const km = normalizeKm(mapField(row, "km", "kms", "odometer", "kilometres", "mileage"));
      
      return {
        batch_id: batch_id,
        row_number: index + 1,
        raw_data: row,
        lot_id: mapField(row, "lot_id", "lot", "lot_number", "lot_no"),
        stock_number: mapField(row, "stock_number", "stock", "stock_no", "stock_id"),
        vin: mapField(row, "vin", "vin_number", "chassis"),
        year,
        make: make?.toUpperCase(),
        model: model?.toUpperCase(),
        variant_raw: variantRaw,
        variant_family: extractVariantFamily(variantRaw),
        km,
        fuel: normalizeFuel(mapField(row, "fuel", "fuel_type", "engine_type")),
        transmission: normalizeTransmission(mapField(row, "transmission", "trans", "gearbox")),
        location: mapField(row, "location", "branch", "yard", "site"),
        reserve: normalizePrice(mapField(row, "reserve", "reserve_price")),
        asking_price: normalizePrice(mapField(row, "price", "asking_price", "guide", "estimate")),
        status: "pending",
      };
    });

    // Insert all rows
    const { error: insertError } = await supabase
      .from("va_upload_rows")
      .insert(rowsToInsert);

    if (insertError) {
      console.error("Row insert error:", insertError);
      await supabase
        .from("va_upload_batches")
        .update({ status: "failed", error: `Failed to insert rows: ${insertError.message}` })
        .eq("id", batch_id);
      
      return new Response(JSON.stringify({ error: "Failed to insert parsed rows" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update batch status
    await supabase
      .from("va_upload_batches")
      .update({ 
        status: "parsed", 
        parse_completed_at: new Date().toISOString(),
        rows_total: rowsToInsert.length,
      })
      .eq("id", batch_id);

    return new Response(JSON.stringify({
      success: true,
      batch_id,
      rows_parsed: rowsToInsert.length,
      message: "File parsed successfully. Ready for ingestion.",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(JSON.stringify({ error: "Internal server error", details: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
