import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Parse Australian date DD/MM/YY or DD/MM/YYYY */
function parseDate(d: string): string | null {
  if (!d || d.trim() === "") return null;
  const m = d.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day = parseInt(m[1]);
  const month = parseInt(m[2]);
  let year = parseInt(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse currency string like "$6,100.00" or "-$6,184.79" or "($3,200)" */
function parseCurrency(s: string): number | null {
  if (!s || s.trim() === "") return null;
  let str = s.trim();
  let neg = false;
  if (str.startsWith("(") && str.endsWith(")")) {
    neg = true;
    str = str.slice(1, -1);
  }
  if (str.startsWith("-")) {
    neg = true;
    str = str.slice(1);
  }
  str = str.replace(/[$,]/g, "");
  const val = parseFloat(str);
  if (isNaN(val)) return null;
  return neg ? -val : val;
}

/** Extract year, make, model, variant from EasyCars description
 *  e.g. "Ford Ranger 2010 PK XLT Utility Crew Cab 4dr Auto 5sp 4x4 1020kg 3.0DT"
 */
function parseDescription(desc: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  body_type: string | null;
  transmission: string | null;
  drive_type: string | null;
  fuel_type: string | null;
} {
  const result = {
    year: null as number | null,
    make: null as string | null,
    model: null as string | null,
    variant: null as string | null,
    body_type: null as string | null,
    transmission: null as string | null,
    drive_type: null as string | null,
    fuel_type: null as string | null,
  };

  if (!desc) return result;

  // Clean up description - remove parenthetical notes at the end
  let clean = desc.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // Also remove trailing notes like "(Klosters)" or "(Tarek)" mid-string
  clean = clean.replace(/\s*\([^)]*\)/g, "").trim();

  // Extract year
  const yearMatch = clean.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[1]);
  }

  // Extract make and model (first two words before or after year)
  const parts = clean.split(/\s+/);
  const yearIdx = parts.findIndex(p => /^(19|20)\d{2}$/.test(p));

  if (yearIdx >= 2) {
    // "Ford Ranger 2010 ..."
    result.make = parts[0];
    // Handle multi-word makes like "Land Rover"
    const knownMultiMakes: Record<string, string> = {
      "Land": "Land Rover",
      "Mercedes-Benz": "Mercedes-Benz",
      "Audi": "Audi",
      "BMW": "BMW",
      "Great": "Great Wall",
    };
    if (knownMultiMakes[parts[0]] && parts[0] !== "BMW" && parts[0] !== "Audi" && parts[0] !== "Mercedes-Benz") {
      result.make = knownMultiMakes[parts[0]];
      result.model = parts[2] === String(result.year) ? parts[1] : parts.slice(1, yearIdx).join(" ");
    } else {
      result.model = parts.slice(1, yearIdx).join(" ");
    }
  } else if (yearIdx === -1 && parts.length >= 2) {
    result.make = parts[0];
    result.model = parts[1];
  }

  // Extract variant - everything after year and model code up to body type keywords
  if (yearIdx >= 0 && yearIdx + 1 < parts.length) {
    const afterYear = parts.slice(yearIdx + 1);
    // Skip series codes like "PK", "MY09", "Series II"
    const variantParts: string[] = [];
    const bodyTypes = ["Sedan", "Wagon", "Hatchback", "Utility", "Cab", "Van", "Coupe", "Convertible", "Hardtop", "Pickup", "Pick-up"];
    const stopWords = ["Spts", "Auto", "Man", "CVT", "DSG", "DCT"];

    for (const p of afterYear) {
      if (bodyTypes.some(b => p.startsWith(b)) || stopWords.includes(p)) break;
      variantParts.push(p);
    }
    if (variantParts.length > 0) {
      result.variant = variantParts.join(" ");
    }
  }

  // Body type
  const bodyMatch = clean.match(/\b(Sedan|Wagon|Hatchback|Utility|Cab Chassis|Van|Coupe|Convertible|Hardtop|Pick-?up)\b/i);
  if (bodyMatch) result.body_type = bodyMatch[1];

  // Transmission
  if (/\bAuto\b|\bSpts Auto\b|\bDSG\b|\bDCT\b|\bCVT\b|\bTiptronic\b|\bSteptronic\b/i.test(clean)) {
    result.transmission = "Auto";
  } else if (/\bMan\b/i.test(clean)) {
    result.transmission = "Manual";
  }

  // Drive type
  if (/\b4x4\b|\b4WD\b|\bAWD\b|\bquattro\b|\b4MOTION\b/i.test(clean)) {
    result.drive_type = "4WD";
  } else if (/\b4x2\b|\b2WD\b|\bFWD\b|\bRWD\b/i.test(clean)) {
    result.drive_type = "2WD";
  }

  // Fuel type
  if (/\bDT\b|\bDTT\b|\bDTTeC\b|\bCDI\b|\bTDI\b|\bDiesel\b/i.test(clean)) {
    result.fuel_type = "Diesel";
  } else if (/\bT\b.*sp\b|\bTurbo\b|\bTSI\b/i.test(clean) && !/DT/.test(clean)) {
    result.fuel_type = "Petrol";
  } else if (/\bi\b/.test(clean) && !/DT/.test(clean)) {
    result.fuel_type = "Petrol";
  }

  // Normalize make
  if (result.make) result.make = result.make.toUpperCase();
  if (result.model) result.model = result.model.toUpperCase();

  return result;
}

interface ParsedRow {
  description: string;
  sale_date: string | null;
  days_in_stock: number | null;
  sale_price: number | null;
  profit: number | null;
}

/** Parse all data rows from the markdown content */
function parseMarkdownRows(markdown: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const lines = markdown.split("\n");

  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (line.includes("Stock No") || line.includes("----")) continue;
    if (line.includes("EasyCars") || line.includes("Page ")) continue;

    // Instead of splitting on |, use regex to find all currency values and other fields
    // Find the description (vehicle info with year)
    const descMatch = line.match(/\|\s*([A-Z][a-zA-Z\-]+\s+[A-Za-z0-9\s\-\.\/\+\(\)\[\]&,]+(?:19|20)\d{2}[A-Za-z0-9\s\-\.\/\+\(\)\[\]&,]+?)\s*\|/);
    if (!descMatch) continue;
    const desc = descMatch[1].trim();

    // Find sale date
    const dateMatch = line.match(/\|\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*\|/);
    const saleDate = dateMatch ? parseDate(dateMatch[1]) : null;

    // Find days in stock (number right after date)
    let daysInStock: number | null = null;
    if (dateMatch) {
      const afterDate = line.substring(line.indexOf(dateMatch[0]) + dateMatch[0].length);
      const daysMatch = afterDate.match(/^\s*(\d{1,4})\s*\|/);
      if (daysMatch) {
        const d = parseInt(daysMatch[1]);
        if (d >= 0 && d < 2000) daysInStock = d;
      }
    }

    // Find ALL currency values in the line using regex
    const currencyPattern = /-?\$[\d,]+\.\d{2}/g;
    const currencies: number[] = [];
    let cm;
    while ((cm = currencyPattern.exec(line)) !== null) {
      const val = parseCurrency(cm[0]);
      if (val !== null) currencies.push(val);
    }

    // We need at least selling price + profit (2 currencies minimum)
    // Typical pattern: Selling Price | $0.00 (cost) | Actual Cost | GST | Profit
    // Or: Selling Price | $0.00 | Net Profit | GST | (no explicit profit column)
    if (currencies.length < 2) continue;

    // Selling price is the FIRST non-zero currency (or first if all zero)
    let sellingPrice = currencies[0];
    
    // Profit is ALWAYS the LAST currency value
    const profit = currencies[currencies.length - 1];

    // Sanity check: selling price should be > 0 typically
    // If first is $0.00, take the next non-zero
    if (sellingPrice === 0 && currencies.length > 2) {
      for (let i = 0; i < currencies.length - 1; i++) {
        if (currencies[i] !== 0) { sellingPrice = currencies[i]; break; }
      }
    }

    // Additional sanity: if profit > sellingPrice, columns may be shifted
    // In some rows, cost column contains a value > selling price
    // Verify: buy = sell - profit should be positive
    const derivedBuy = sellingPrice - profit;
    if (derivedBuy < 0 && currencies.length >= 4) {
      // Possible column shift - the first currency might not be selling price
      // Try: selling price might be after a $0.00
      const zeroIdx = currencies.indexOf(0);
      if (zeroIdx >= 0 && zeroIdx + 1 < currencies.length - 1) {
        const altSell = currencies[zeroIdx + 1];
        const altBuy = altSell - profit;
        if (altBuy > 0) {
          sellingPrice = altSell;
        }
      }
    }

    if (sellingPrice <= 0) continue;

    rows.push({
      description: desc,
      sale_date: saleDate,
      days_in_stock: daysInStock,
      sale_price: sellingPrice,
      profit: profit,
    });
  }

  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { markdown, account_id, dry_run } = await req.json();

    if (!markdown || !account_id) {
      return new Response(
        JSON.stringify({ error: "markdown and account_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse all rows
    const rows = parseMarkdownRows(markdown);
    console.log(`Parsed ${rows.length} rows from markdown`);

    // Build records
    const records: any[] = [];
    const errors: string[] = [];
    const dedupKeys = new Set<string>();

    for (const row of rows) {
      const identity = parseDescription(row.description);

      if (!identity.make || !identity.model) {
        errors.push(`Could not parse identity: ${row.description.substring(0, 60)}`);
        continue;
      }

      // Derive buy_price from profit
      let buy_price: number | null = null;
      let profit_pct: number | null = null;

      if (row.sale_price != null && row.profit != null) {
        buy_price = row.sale_price - row.profit;
        if (buy_price > 0) {
          profit_pct = (row.profit / buy_price) * 100;
        }
      }

      // Dedup key
      const key = `${identity.make}|${identity.model}|${identity.year}|${row.sale_date}|${row.sale_price}`;
      if (dedupKeys.has(key)) {
        continue; // Skip duplicate
      }
      dedupKeys.add(key);

      records.push({
        account_id,
        make: identity.make,
        model: identity.model,
        variant: identity.variant,
        year: identity.year,
        body_type: identity.body_type,
        transmission: identity.transmission,
        drive_type: identity.drive_type,
        fuel_type: identity.fuel_type,
        sale_price: row.sale_price,
        buy_price: buy_price,
        profit_pct: profit_pct ? parseFloat(profit_pct.toFixed(4)) : null,
        days_to_clear: row.days_in_stock,
        sold_at: row.sale_date,
        source: "easycars_pdf_upload",
        confidence: "high",
      });
    }

    console.log(`Built ${records.length} records (${errors.length} errors, ${rows.length - records.length - errors.length} deduped)`);

    // Sample output for dry run
    if (dry_run) {
      return new Response(
        JSON.stringify({
          parsed: rows.length,
          records: records.length,
          errors,
          sample: records.slice(0, 10),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert in batches of 50
    let inserted = 0;
    const batchSize = 50;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase
        .from("vehicle_sales_truth")
        .insert(batch);

      if (error) {
        console.error(`Batch ${i / batchSize + 1} error:`, error.message);
        errors.push(`Batch ${i / batchSize + 1}: ${error.message}`);
      } else {
        inserted += batch.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        parsed: rows.length,
        inserted,
        deduped: rows.length - records.length - errors.length,
        errors,
        sample: records.slice(0, 5),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
