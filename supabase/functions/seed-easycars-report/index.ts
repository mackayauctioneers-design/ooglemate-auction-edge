import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Known makes (order matters: multi-word first) ──
const KNOWN_MAKES = [
  "Land Rover", "Alfa Romeo", "Aston Martin", "Great Wall", "Mercedes-Benz",
  "Rolls-Royce", "Rembrandt Caravans",
  "Audi", "BMW", "Chery", "Chevrolet", "Chrysler", "Citroen", "Dodge", "Fiat",
  "Ford", "GWM", "Genesis", "Haval", "Holden", "Honda", "Hyundai", "Infiniti",
  "Isuzu", "Jaguar", "Jeep", "Kia", "LDV", "Lexus", "MG", "Maserati", "Mazda",
  "McLaren", "Mini", "Mitsubishi", "Nissan", "Peugeot", "Porsche", "Proton",
  "RAM", "Renault", "SKODA", "Skoda", "SsangYong", "Subaru", "Suzuki", "Tesla",
  "Toyota", "Volkswagen", "Volvo",
];

// ── Trim/badge patterns (longest first for greedy match) ──
const TRIM_BADGES = [
  "GR Sport", "Rugged X", "R-Dynamic", "Premium Pack", "ST-X", "ST-L",
  "SR5", "GLX+", "LS-U", "LS-T", "LS-M", "LT-R",
  "Wildtrak", "Overland", "Trailhawk", "Limited", "Laredo", "Sahara",
  "Kakadu", "Workmate", "Aspire", "Premium", "Luxury", "Active", "Sport",
  "GXL", "XLT", "XLS", "GLX", "GX", "XL", "GL", "VX", "SR", "SL", "ST",
  "Ti", "LS", "LT", "SE", "XT", "XTR", "HSE", "SRT", "AMG", "Akera",
  "Maxx", "Neo", "Elite", "GL-R",
];

/** Extract engine code (e.g. 3.0DT → 3.0L Diesel Turbo) */
function extractEngine(post: string): { engine_code: string; fuel_type: string | null } {
  // Match patterns like 3.3DTT, 3.0DT, 2.8DT, 2.5DT, 3.2i, 2.0T, 5.7V8
  const m = post.match(/\b(\d+\.\d+)(DTT|DT|D|T|i|SC|kW|V\d+)?\b/i);
  if (m) {
    const disp = m[1];
    const suffix = (m[2] || "").toUpperCase();
    if (suffix.startsWith("DT")) return { engine_code: `${disp}DT`, fuel_type: "Diesel" };
    if (suffix === "D") return { engine_code: `${disp}D`, fuel_type: "Diesel" };
    if (suffix === "T") return { engine_code: `${disp}T`, fuel_type: "Petrol Turbo" };
    if (suffix === "SC") return { engine_code: `${disp}SC`, fuel_type: "Petrol Supercharged" };
    return { engine_code: `${disp}`, fuel_type: "Petrol" };
  }
  if (/\bHybrid\b/i.test(post)) return { engine_code: "Hybrid", fuel_type: "Hybrid" };
  if (/\bElectric\b/i.test(post) || /\bEV\b/.test(post)) return { engine_code: "EV", fuel_type: "Electric" };
  return { engine_code: "", fuel_type: null };
}

/** Parse EasyCars description into vehicle identity */
function parseDescription(desc: string) {
  if (!desc?.trim()) return null;
  const cleaned = desc.trim();

  const yearMatch = cleaned.match(/\b(19\d{2}|20\d{2})\b/);
  if (!yearMatch) return { make: null, model: null, year: null, variant: null, body_type: null, transmission: null, fuel_type: null, drive_type: null, engine_code: null };

  const year = parseInt(yearMatch[1]);
  const yearIdx = cleaned.indexOf(yearMatch[0]);

  // Extract make (check multi-word makes first)
  const prePart = cleaned.substring(0, yearIdx).trim();
  const postPart = cleaned.substring(yearIdx + 4).trim();

  let make: string | null = null;
  let modelRaw = "";

  for (const km of KNOWN_MAKES) {
    if (prePart.toLowerCase().startsWith(km.toLowerCase())) {
      make = km;
      modelRaw = prePart.substring(km.length).trim();
      break;
    }
  }
  if (!make) {
    const words = prePart.split(/\s+/);
    make = words[0] || null;
    modelRaw = words.slice(1).join(" ");
  }

  const model = modelRaw || null;

  // Body types
  const bodyTypes = ["Cab Chassis", "Dual Cab", "Double Cab", "Super Cab", "Freestyle Cab", "Crew Cab",
    "Sedan", "Wagon", "Hatchback", "Utility", "Van", "Bus", "Coupe", "Convertible", "Troopcarrier", "Pick-up", "Ute", "SUV"];
  let body_type: string | null = null;
  for (const bt of bodyTypes) {
    if (postPart.toLowerCase().includes(bt.toLowerCase())) { body_type = bt; break; }
  }

  // Transmission
  let transmission: string | null = null;
  if (/\bMan\s*\d*sp\b/i.test(postPart) || /\bMan\b/.test(postPart)) transmission = "Manual";
  else if (/\b(Spts\s*Auto|Auto\s*\d*sp|Lineartronic|X-tronic|Rev-Tronic|PwrShift|9G-TRONIC|Tiptronic|Steptronic|SKYACTIV-Drive|SelectShift|SPEEDSHIFT|D-CT|EDC)\b/i.test(postPart)) transmission = "Automatic";
  else if (/\b(CVT|S-CVT|multitronic)\b/i.test(postPart)) transmission = "CVT";
  else if (/\bDSG\b/i.test(postPart)) transmission = "Automatic";
  else if (/\bSKYACTIV-MT\b/i.test(postPart)) transmission = "Manual";

  // Drivetrain
  let drive_type: string | null = null;
  if (/\b4x4\b/.test(postPart) || /\b4WD\b/.test(postPart)) drive_type = "4WD";
  else if (/\b(AWD|4MATIC|quattro|xDrive|eFour)\b/i.test(postPart)) drive_type = "AWD";
  else if (/\b(4x2|2WD)\b/.test(postPart)) drive_type = "2WD";
  else if (/\bFWD\b/.test(postPart)) drive_type = "FWD";
  else if (/\bRWD\b/.test(postPart)) drive_type = "RWD";

  // Engine + fuel
  const { engine_code, fuel_type } = extractEngine(postPart);

  // Variant / trim badge (first match wins — longest patterns first)
  let variant: string | null = null;
  for (const badge of TRIM_BADGES) {
    if (postPart.includes(badge)) { variant = badge; break; }
  }
  // If no badge found, take first 4 words of postPart as variant
  if (!variant) {
    variant = postPart.split(/\s+/).slice(0, 4).join(" ") || null;
  }

  // Build rich variant string: "XLT 3.2DT 4x4" style
  const variantParts = [variant, engine_code, drive_type].filter(Boolean);
  const richVariant = variantParts.join(" ") || null;

  return { make, model, year, variant: richVariant, body_type, transmission, fuel_type, drive_type, engine_code };
}

/** Parse date from DD/MM/YY format */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const m = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  let year: number;
  if (m[3].length <= 2) {
    const short = parseInt(m[3]);
    year = short >= 50 ? 1900 + short : 2000 + short;
  } else {
    year = parseInt(m[3]);
  }
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

    // Collect all dollar-value cells
    const moneyCells: string[] = [];
    for (let i = 6; i < cells.length; i++) {
      if (cells[i].includes("$")) moneyCells.push(cells[i]);
    }

    const sellingPrice = moneyCells[0] || null;
    const totalCost = moneyCells.length >= 3 ? moneyCells[2] : null;
    const profit = moneyCells.length >= 5 ? moneyCells[4] : (moneyCells[moneyCells.length - 1] || null);

    const vehicle = parseDescription(description);
    if (!vehicle) continue;

    rows.push({
      ...vehicle,
      sold_at: parseDate(saleDate),
      days_to_clear: parseInt(daysInStock) || null,
      sale_price: parseMoney(sellingPrice || ""),
      buy_price: parseMoney(totalCost || ""),
      profit_raw: parseMoney(profit || ""),
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
        .storage.from("sales-uploads").download(storage_path);
      if (fileErr) throw new Error(`Storage download failed: ${fileErr.message}`);
      content = await fileData.text();
      console.log(`Downloaded ${content.length} chars from storage`);
    }

    // Priority 2: Fetch from URL
    if (!content && content_url) {
      const resp = await fetch(content_url);
      if (!resp.ok) throw new Error(`Failed to fetch content: ${resp.status}`);
      content = await resp.text();
    }

    if (!account_id || !content) {
      return new Response(JSON.stringify({ error: "account_id and (storage_path, markdown_text, or content_url) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse rows
    const rows = extractRows(content);
    console.log(`Parsed ${rows.length} vehicle rows from content`);

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "No vehicle rows found in content", parsed: 0 }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clear existing if requested
    if (clear_existing) {
      const { error: delErr } = await supabase
        .from("vehicle_sales_truth").delete().eq("account_id", account_id);
      if (delErr) console.error("Delete error:", delErr);
      else console.log("Cleared existing rows for account");
    }

    // Build insert records — derive buy_price from sale_price - profit if missing
    const records = rows
      .filter((r) => r.make && r.sold_at)
      .map((r) => {
        let buy_price = r.buy_price;
        if (!buy_price && r.sale_price && r.profit_raw != null) {
          buy_price = r.sale_price - r.profit_raw;
        }

        return {
          account_id,
          make: r.make?.toUpperCase() || null,
          model: r.model?.toUpperCase() || null,
          variant: r.variant,
          year: r.year,
          sold_at: r.sold_at,
          sale_price: r.sale_price,
          buy_price: buy_price,
          days_to_clear: r.days_to_clear,
          body_type: r.body_type,
          transmission: r.transmission,
          fuel_type: r.fuel_type,
          drive_type: r.drive_type,
          source: "easycars_pdf_seed",
          confidence: "high",
          notes: `Stock #${r.stock_no}`,
        };
      });

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

    // Auto-trigger winners watchlist update
    let winnersResult = null;
    try {
      const winnersResp = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/update-winners-watchlist`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ account_id }),
        }
      );
      winnersResult = await winnersResp.json();
      console.log(`Auto-updated winners watchlist:`, winnersResult);
    } catch (e) {
      console.error("Winners watchlist auto-update failed:", e);
    }

    return new Response(JSON.stringify({
      parsed: rows.length,
      valid: records.length,
      inserted,
      storage_path: storage_path || null,
      winners_updated: winnersResult,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Seed error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
