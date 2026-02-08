import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Parse EasyCars description into vehicle identity */
function parseDescription(desc: string) {
  if (!desc || !desc.trim()) return null;
  const cleaned = desc.trim();

  const yearMatch = cleaned.match(/\b(19\d{2}|20\d{2})\b/);
  if (!yearMatch) return { make: null, model: null, year: null, variant: null, body_type: null, transmission: null, fuel_type: null, drive_type: null };

  const year = parseInt(yearMatch[1]);
  const yearIdx = cleaned.indexOf(yearMatch[0]);

  const prePart = cleaned.substring(0, yearIdx).trim();
  const postPart = cleaned.substring(yearIdx + 4).trim();

  const preWords = prePart.split(/\s+/);
  const make = preWords[0] || null;
  const model = preWords.slice(1).join(" ") || null;

  const bodyTypes = ["Sedan", "Wagon", "Hatchback", "Utility", "Cab Chassis", "Van", "Bus", "Coupe", "Convertible", "Troopcarrier", "Pick-up", "Ute"];
  let body_type: string | null = null;
  for (const bt of bodyTypes) {
    if (postPart.toLowerCase().includes(bt.toLowerCase())) {
      body_type = bt;
      break;
    }
  }

  let transmission: string | null = null;
  if (/\bMan\b/.test(postPart)) transmission = "Manual";
  else if (/\b(Spts Auto|Auto|Lineartronic|X-tronic|Rev-Tronic|PwrShift|9G-TRONIC)\b/i.test(postPart)) transmission = "Automatic";
  else if (/\bCVT\b/i.test(postPart)) transmission = "CVT";
  else if (/\bDSG\b/i.test(postPart)) transmission = "DSG";

  let drive_type: string | null = null;
  if (/\b4x4\b/.test(postPart) || /\b4WD\b/.test(postPart)) drive_type = "4WD";
  else if (/\bAWD\b/.test(postPart)) drive_type = "AWD";
  else if (/\b4x2\b/.test(postPart) || /\b2WD\b/.test(postPart)) drive_type = "2WD";
  else if (/\bFWD\b/.test(postPart)) drive_type = "FWD";
  else if (/\beFour\b/.test(postPart)) drive_type = "AWD";

  let fuel_type: string | null = null;
  if (/\bHybrid\b/i.test(postPart)) fuel_type = "Hybrid";
  else if (/\d+\.\d+DT/i.test(postPart)) fuel_type = "Diesel";
  else if (/\d+\.\d+[iI]\b/.test(postPart)) fuel_type = "Petrol";
  else if (/\d+\.\d+T\b/.test(postPart)) fuel_type = "Petrol Turbo";

  const variantWords = postPart.split(/\s+/).slice(0, 4).join(" ") || null;

  return { make, model, year, variant: variantWords, body_type, transmission, fuel_type, drive_type };
}

/** Parse date from DD/MM/YY format */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const m = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  const yearShort = parseInt(m[3]);
  const year = yearShort >= 50 ? 1900 + yearShort : 2000 + yearShort;
  return `${year}-${month}-${day}`;
}

/** Parse dollar amount like "$61,500.00" or "-$636.36" */
function parseMoney(str: string): number | null {
  if (!str) return null;
  const cleaned = str.replace(/[,$\s]/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : Math.round(val);
}

/** Extract table rows from markdown text */
function extractRows(markdown: string) {
  const lines = markdown.split("\n");
  const rows: any[] = [];

  for (const line of lines) {
    if (!line.startsWith("|")) continue;

    const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");

    if (cells.length < 6) continue;
    if (cells[0].includes("---") || cells[0].includes("Stock No") || cells[0].includes("Deal")) continue;
    if (cells[0].includes("Total") || cells[0].includes("AVERAGES") || cells[0].includes("Vehicles")) continue;

    const stockNo = cells[0].trim();
    if (!/^\d+$/.test(stockNo)) continue;

    const description = cells[3] || "";
    const saleDate = cells[4] || "";
    const daysInStock = cells[5] || "";

    let sellingPrice: string | null = null;
    let profit: string | null = null;

    for (let i = 6; i < cells.length; i++) {
      if (cells[i].includes("$")) {
        if (!sellingPrice) {
          sellingPrice = cells[i];
        }
        profit = cells[i];
      }
    }

    const vehicle = parseDescription(description);
    if (!vehicle) continue;

    rows.push({
      ...vehicle,
      sold_at: parseDate(saleDate),
      days_to_clear: parseInt(daysInStock) || null,
      sale_price: parseMoney(sellingPrice || ""),
      stock_no: stockNo,
      description,
    });
  }

  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { account_id, storage_path, markdown_text, content_url, clear_existing = false } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let content = markdown_text || "";

    // Priority 1: Read from Supabase Storage
    if (!content && storage_path) {
      console.log(`Downloading from storage: sales-uploads/${storage_path}`);
      const { data: fileData, error: fileErr } = await supabase
        .storage
        .from("sales-uploads")
        .download(storage_path);

      if (fileErr) throw new Error(`Storage download failed: ${fileErr.message}`);
      content = await fileData.text();
      console.log(`Downloaded ${content.length} chars from storage`);
    }

    // Priority 2: Fetch from URL (legacy support)
    if (!content && content_url) {
      const resp = await fetch(content_url);
      if (!resp.ok) throw new Error(`Failed to fetch content: ${resp.status}`);
      content = await resp.text();
    }

    if (!account_id || !content) {
      return new Response(JSON.stringify({ error: "account_id and (storage_path, markdown_text, or content_url) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse rows
    const rows = extractRows(content);
    console.log(`Parsed ${rows.length} vehicle rows from content`);

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "No vehicle rows found in content", parsed: 0 }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clear existing if requested
    if (clear_existing) {
      const { error: delErr } = await supabase
        .from("vehicle_sales_truth")
        .delete()
        .eq("account_id", account_id);
      if (delErr) console.error("Delete error:", delErr);
      else console.log("Cleared existing rows for account");
    }

    // Build insert records
    const records = rows
      .filter((r) => r.make && r.sold_at)
      .map((r) => ({
        account_id,
        make: r.make?.toUpperCase() || null,
        model: r.model?.toUpperCase() || null,
        variant: r.variant,
        year: r.year,
        sold_at: r.sold_at,
        sale_price: r.sale_price,
        days_to_clear: r.days_to_clear,
        body_type: r.body_type,
        transmission: r.transmission,
        fuel_type: r.fuel_type,
        drive_type: r.drive_type,
        source: "easycars_pdf_seed",
        confidence: "high",
        notes: `Stock #${r.stock_no}`,
      }));

    console.log(`Inserting ${records.length} valid records`);

    // Insert in batches of 100
    let inserted = 0;
    let errors: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase.from("vehicle_sales_truth").insert(batch);
      if (error) {
        console.error(`Batch ${i / batchSize} error:`, error);
        errors.push(`Batch ${Math.floor(i / batchSize)}: ${error.message}`);
      } else {
        inserted += batch.length;
      }
    }

    return new Response(JSON.stringify({
      parsed: rows.length,
      valid: records.length,
      inserted,
      storage_path: storage_path || null,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Seed error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
