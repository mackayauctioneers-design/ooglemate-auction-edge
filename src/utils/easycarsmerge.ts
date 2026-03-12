import * as XLSX from "xlsx";

export interface MergedVehicle {
  stock_number: string;
  rego: string;
  make: string;
  model: string;
  variant: string;
  year: string;
  km: string;
  vin: string;
  transmission: string;
  purchase_price: string;
  sale_price: string;
  gross_profit: string;
  days_in_stock: string;
  sale_date: string;
  sold_to: string;
  description: string;
}

interface SoldRow {
  stockNo: number;
  rego: string;
  description: string;
  saleDate: string;
  daysInStock: string;
  soldTo: string;
  salePrice: string;
  profit: string;
  totalCost: string;
}

interface AcqRow {
  stockNo: number;
  rego: string;
  odometerRaw: string;
  description: string;
  vin: string;
  purchasePrice: string;
  totalCost: string;
  transmission: string;
}

/** Extract kilometres from EasyCars odometer field like "72,800Km\n0" */
function extractKm(raw: string): string {
  if (!raw) return "";
  const m = raw.match(/([\d,]+)\s*[Kk][Mm]/);
  if (m) return m[1].replace(/,/g, "");
  // Try plain number
  const n = raw.replace(/[^0-9]/g, "");
  return n || "";
}

/** Parse Make/Model/Year/Variant from EasyCars description
 *  e.g. "TOYOTA LANDCRUISER 2007 LANDCRUISER PRADO GXL (4x4) KDJ120R ..." 
 *  or  "BMW X3 2012 X3 xDRIVE20d F25 DIESEL TURBO ..."
 */
function parseDescription(desc: string) {
  if (!desc) return { make: "", model: "", year: "", variant: "" };
  const tokens = desc.trim().split(/\s+/);
  
  // Make = first token
  const make = tokens[0] || "";
  
  // Find year (first 4-digit number that looks like a year)
  let yearIdx = -1;
  let year = "";
  for (let i = 1; i < tokens.length; i++) {
    if (/^(19|20)\d{2}$/.test(tokens[i])) {
      yearIdx = i;
      year = tokens[i];
      break;
    }
  }
  
  // Model = tokens between make and year
  let model = "";
  if (yearIdx > 1) {
    model = tokens.slice(1, yearIdx).join(" ");
  } else if (tokens.length > 1) {
    model = tokens[1];
  }
  
  // Variant = tokens after year, look for badge-like patterns
  let variant = "";
  if (yearIdx > 0 && yearIdx + 1 < tokens.length) {
    // Skip the repeated model name after year, look for variant keywords
    const afterYear = tokens.slice(yearIdx + 1);
    // Find variant by skipping repeated model tokens
    const modelTokens = model.toUpperCase().split(/\s+/);
    let variantStart = 0;
    for (let i = 0; i < afterYear.length; i++) {
      if (modelTokens.includes(afterYear[i].toUpperCase())) {
        variantStart = i + 1;
      } else {
        break;
      }
    }
    // Take next 1-3 tokens as variant, skip engine/body specs
    const variantTokens = afterYear.slice(variantStart);
    const specKeywords = ["DIESEL", "TURBO", "MULTI", "POINT", "F/INJ", "DIRECT", "MPFI", "CDI", "SUPERCHARGED", "HYBRID", "SP", "AUTOMATIC", "MANUAL", "GEARTRONIC", "TIPTRONIC", "DUAL", "CLUTCH", "CONTINUOUS", "VARIABLE", "SEQUENTIAL"];
    const variantParts: string[] = [];
    for (const t of variantTokens) {
      if (specKeywords.includes(t.toUpperCase()) || /^\d+\.\d+L$/.test(t)) break;
      // Stop at chassis codes like F25, G01, etc (2-3 chars starting with letter + digits)
      if (/^[A-Z]{1,3}\d{2,3}$/.test(t) && t.length <= 5) break;
      // Stop at MY codes like MY17
      if (/^MY\d{2}$/i.test(t)) break;
      variantParts.push(t);
    }
    variant = variantParts.join(" ");
  }
  
  return { make, model, year, variant };
}

/** Find column index by matching key phrases (case-insensitive, handles newlines) */
function findCol(headers: string[], ...phrases: string[]): number {
  for (const phrase of phrases) {
    const lower = phrase.toLowerCase();
    const idx = headers.findIndex(h => 
      h.toLowerCase().replace(/\n/g, " ").includes(lower)
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Parse the Sold Stock Profit Report from XLSX workbook */
function parseSoldReport(wb: XLSX.WorkBook): SoldRow[] {
  // Find sheet with "Stock No" header
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
    
    // Find header row
    for (let r = 0; r < Math.min(20, data.length); r++) {
      const row = data[r];
      if (!row) continue;
      const stockIdx = row.findIndex(c => 
        String(c).trim().toLowerCase() === "stock no" || 
        String(c).trim().toLowerCase() === "stock number"
      );
      if (stockIdx < 0) continue;
      
      const headers = row.map(c => String(c).trim());
      const dealNoIdx = findCol(headers, "deal no");
      const regoIdx = findCol(headers, "rego");
      const descIdx = findCol(headers, "description");
      const saleDateIdx = findCol(headers, "sale date");
      const daysIdx = findCol(headers, "days in stock");
      const soldToIdx = findCol(headers, "sold to");
      const priceIdx = findCol(headers, "total selling price", "selling price");
      const costIdx = findCol(headers, "total cost", "expenses, warranty");
      const profitIdx = findCol(headers, "profit");
      
      const rows: SoldRow[] = [];
      for (let i = r + 1; i < data.length; i++) {
        const d = data[i];
        if (!d || !d[stockIdx]) continue;
        const sn = parseInt(String(d[stockIdx]).replace(/[^0-9]/g, ""), 10);
        if (isNaN(sn)) continue;
        
        rows.push({
          stockNo: sn,
          rego: regoIdx >= 0 ? String(d[regoIdx] || "") : "",
          description: descIdx >= 0 ? String(d[descIdx] || "") : "",
          saleDate: saleDateIdx >= 0 ? String(d[saleDateIdx] || "") : "",
          daysInStock: daysIdx >= 0 ? String(d[daysIdx] || "") : "",
          soldTo: soldToIdx >= 0 ? String(d[soldToIdx] || "") : "",
          salePrice: priceIdx >= 0 ? String(d[priceIdx] || "") : "",
          profit: profitIdx >= 0 ? String(d[profitIdx] || "") : "",
          totalCost: costIdx >= 0 ? String(d[costIdx] || "") : "",
        });
      }
      
      if (rows.length > 0) return rows;
    }
  }
  return [];
}

/** Parse the Acquisition/Stock List Report from XLSX workbook */
function parseAcquisitionReport(wb: XLSX.WorkBook): AcqRow[] {
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
    
    for (let r = 0; r < Math.min(20, data.length); r++) {
      const row = data[r];
      if (!row) continue;
      const stockIdx = row.findIndex(c => {
        const v = String(c).trim().toLowerCase().replace(/\n/g, " ");
        return v === "stock #" || v === "stock no" || v === "stock number";
      });
      if (stockIdx < 0) continue;
      
      const headers = row.map(c => String(c).trim());
      const regoIdx = findCol(headers, "rego");
      const odoIdx = findCol(headers, "odometer", "odo");
      const descIdx = findCol(headers, "description");
      const vinIdx = findCol(headers, "vin", "chassis");
      const purchIdx = findCol(headers, "purchase price");
      const totalCostIdx = findCol(headers, "total cost");
      const transIdx = findCol(headers, "transmission", "transmisson");
      
      const rows: AcqRow[] = [];
      for (let i = r + 1; i < data.length; i++) {
        const d = data[i];
        if (!d || !d[stockIdx]) continue;
        const sn = parseInt(String(d[stockIdx]).replace(/[^0-9]/g, ""), 10);
        if (isNaN(sn)) continue;
        
        rows.push({
          stockNo: sn,
          rego: regoIdx >= 0 ? String(d[regoIdx] || "") : "",
          odometerRaw: odoIdx >= 0 ? String(d[odoIdx] || "") : "",
          description: descIdx >= 0 ? String(d[descIdx] || "") : "",
          vin: vinIdx >= 0 ? String(d[vinIdx] || "") : "",
          purchasePrice: purchIdx >= 0 ? String(d[purchIdx] || "") : "",
          totalCost: totalCostIdx >= 0 ? String(d[totalCostIdx] || "") : "",
          transmission: transIdx >= 0 ? String(d[transIdx] || "") : "",
        });
      }
      
      if (rows.length > 0) return rows;
    }
  }
  return [];
}

/** PDF tables come as parsed markdown — extract structured rows */
function parseSoldFromPDFRows(rows: Record<string, string>[]): SoldRow[] {
  if (!rows.length) return [];
  const result: SoldRow[] = [];
  
  for (const r of rows) {
    // Try to find stock number from various key patterns
    const stockRaw = r["Stock No"] || r["Stock Number"] || r["Deal Stock No"] || r["stock_no"] || "";
    const sn = parseInt(String(stockRaw).replace(/[^0-9]/g, ""), 10);
    if (isNaN(sn)) continue;
    
    result.push({
      stockNo: sn,
      rego: r["Rego"] || r["rego"] || "",
      description: r["Description"] || r["description"] || "",
      saleDate: r["Sale Date"] || r["sale_date"] || "",
      daysInStock: r["Days in Stock"] || r["days_in_stock"] || "",
      soldTo: r["Sold to"] || r["sold_to"] || "",
      salePrice: r["Total Selling Price inc Extras and GST"] || r["Total Price inc Extras and GST"] || r["sale_price"] || "",
      profit: r["Profit"] || r["profit"] || "",
      totalCost: r["Expenses, Warranty Allowance and GST"] || r["Total Cost Inc Expenses, Warranty Allowance and GST"] || r["total_cost"] || "",
    });
  }
  return result;
}

function parseAcqFromPDFRows(rows: Record<string, string>[]): AcqRow[] {
  if (!rows.length) return [];
  const result: AcqRow[] = [];
  
  for (const r of rows) {
    const stockRaw = r["Stock #"] || r["Stock No"] || r["stock_no"] || "";
    const sn = parseInt(String(stockRaw).replace(/[^0-9]/g, ""), 10);
    if (isNaN(sn)) continue;
    
    result.push({
      stockNo: sn,
      rego: r["Rego/"] || r["Rego"] || r["rego"] || "",
      odometerRaw: r["Odometer/"] || r["Odometer"] || r["odometer"] || "",
      description: r["Description"] || r["description"] || "",
      vin: r["VIN/ Chassis"] || r["VIN/"] || r["VIN"] || r["vin"] || "",
      purchasePrice: r["Purchase Price"] || r["purchase_price"] || "",
      totalCost: r["Total Cost"] || r["total_cost"] || "",
      transmission: r["Transmission"] || r["Transmisson"] || r["transmission"] || "",
    });
  }
  return result;
}

export interface MergeResult {
  headers: string[];
  rows: Record<string, string>[];
  stats: {
    soldCount: number;
    acqCount: number;
    matchedCount: number;
    unmatchedCount: number;
  };
}

/** Merge two EasyCars files (XLSX or parsed PDF data) into a unified dataset */
export function mergeEasyCarsFiles(
  soldData: { wb?: XLSX.WorkBook; pdfRows?: Record<string, string>[] },
  acqData: { wb?: XLSX.WorkBook; pdfRows?: Record<string, string>[] }
): MergeResult {
  // Parse both reports
  const soldRows = soldData.wb 
    ? parseSoldReport(soldData.wb) 
    : parseSoldFromPDFRows(soldData.pdfRows || []);
  
  const acqRows = acqData.wb 
    ? parseAcquisitionReport(acqData.wb) 
    : parseAcqFromPDFRows(acqData.pdfRows || []);
  
  if (!soldRows.length) throw new Error("No sold stock data found — check the file contains a 'Stock No' column");
  
  // Build acquisition lookup by stock number
  const acqByStock = new Map<number, AcqRow>();
  // Also build rego lookup as fallback
  const acqByRego = new Map<string, AcqRow>();
  for (const a of acqRows) {
    acqByStock.set(a.stockNo, a);
    if (a.rego) acqByRego.set(a.rego.toUpperCase().trim(), a);
  }
  
  // Merge
  const outputHeaders = [
    "stock_no", "rego", "make", "model", "variant", "year",
    "km", "vin", "transmission", "buy_price", "sale_price",
    "gross_profit", "days_to_clear", "sold_at", "sold_to", "description"
  ];
  
  let matchedCount = 0;
  const outputRows: Record<string, string>[] = [];
  
  for (const sold of soldRows) {
    // Try match by stock number, then by rego
    let acq = acqByStock.get(sold.stockNo);
    if (!acq && sold.rego) {
      acq = acqByRego.get(sold.rego.toUpperCase().trim());
    }
    
    if (acq) matchedCount++;
    
    // Parse description from sold report (richer usually)
    const desc = sold.description || acq?.description || "";
    const parsed = parseDescription(desc);
    
    // Extract KMs from acquisition odometer
    const km = acq ? extractKm(acq.odometerRaw) : "";
    
    // Use acquisition purchase price, fall back to sold total cost
    const buyPrice = acq?.purchasePrice || acq?.totalCost || sold.totalCost || "";
    
    // Clean transmission
    const trans = acq?.transmission || "";
    const transClean = trans.toLowerCase().includes("manual") ? "Manual" 
      : trans.toLowerCase().includes("auto") || trans.toLowerCase().includes("sp a") ? "Automatic"
      : trans.toLowerCase().includes("variable") ? "CVT"
      : trans;
    
    outputRows.push({
      stock_no: String(sold.stockNo),
      rego: sold.rego || acq?.rego || "",
      make: parsed.make,
      model: parsed.model,
      variant: parsed.variant,
      year: parsed.year,
      km,
      vin: acq?.vin || "",
      transmission: transClean,
      buy_price: buyPrice,
      sale_price: sold.salePrice,
      gross_profit: sold.profit,
      days_to_clear: sold.daysInStock,
      sold_at: sold.saleDate,
      sold_to: sold.soldTo,
      description: desc,
    });
  }
  
  // Sort by stock number
  outputRows.sort((a, b) => parseInt(a.stock_no) - parseInt(b.stock_no));
  
  return {
    headers: outputHeaders,
    rows: outputRows,
    stats: {
      soldCount: soldRows.length,
      acqCount: acqRows.length,
      matchedCount,
      unmatchedCount: soldRows.length - matchedCount,
    },
  };
}

/** Read a File as XLSX workbook */
export async function readAsWorkbook(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result as ArrayBuffer, { type: "array" });
        resolve(wb);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}
