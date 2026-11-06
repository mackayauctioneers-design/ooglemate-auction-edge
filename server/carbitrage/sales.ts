import { ServiceError } from "./domain.ts";

export const PENTANA_ADAPTER_ID = "pentana_sales_csv_v1";

export interface AdaptedSale {
  dedupeKey: string;
  stockNo: string | null;
  soldAt: string;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  odometerKm: number | null;
  price: number;
}

export interface AdaptResult {
  adapter: typeof PENTANA_ADAPTER_ID;
  rows: AdaptedSale[];
  errors: { row: number; message: string }[];
  warnings: string[];
}

const REQUIRED = ["sale_date", "make", "model", "sale_price_inc"] as const;

/**
 * Pentana-shaped CSV adapter. This is a file contract for synthetic and
 * dealer-supplied exports. It does not connect to Pentana.
 * Any dealership column in the file is ignored. The server assigns the yard.
 */
export function adaptPentanaSalesCsv(csv: string): AdaptResult {
  const table = parseCsv(csv);
  if (table.length === 0) {
    throw new ServiceError(400, "invalid_payload", "Sales file is empty");
  }
  const header = table[0].map((h) => h.trim().toLowerCase());
  for (const column of REQUIRED) {
    if (!header.includes(column)) {
      throw new ServiceError(400, "invalid_payload", `Sales file is missing ${column}`);
    }
  }
  const warnings: string[] = [];
  if (header.includes("dealership") || header.includes("yard_id") || header.includes("yard")) {
    warnings.push("Dealership column ignored. The yard is taken from your login.");
  }
  const idx = (name: string) => header.indexOf(name);
  const rows: AdaptedSale[] = [];
  const errors: { row: number; message: string }[] = [];

  for (let i = 1; i < table.length; i += 1) {
    const cells = table[i];
    if (cells.every((cell) => cell.trim() === "")) continue;
    const read = (name: string) => (cells[idx(name)] ?? "").trim();
    const make = read("make");
    const model = read("model");
    const saleDate = read("sale_date");
    const priceRaw = read("sale_price_inc").replace(/[$,]/g, "");
    const price = Number(priceRaw);
    if (!make || !model || !saleDate || !Number.isFinite(price) || price < 0) {
      errors.push({ row: i + 1, message: "Need sale_date, make, model and a numeric sale_price_inc" });
      continue;
    }
    const sold = new Date(saleDate);
    if (Number.isNaN(sold.getTime())) {
      errors.push({ row: i + 1, message: "sale_date is not a date" });
      continue;
    }
    const yearRaw = read("year");
    const year = yearRaw ? Number(yearRaw) : null;
    const kmRaw = read("odometer") || read("km");
    const odometerKm = kmRaw ? Number(kmRaw.replace(/,/g, "")) : null;
    const stockNo = read("stock_no") || null;
    const variant = read("badge") || read("variant") || null;
    const dedupeKey = stockNo
      ? `stock:${stockNo}`
      : `row:${sold.toISOString().slice(0, 10)}|${make.toLowerCase()}|${model.toLowerCase()}|${price}|${odometerKm ?? ""}`;
    rows.push({
      dedupeKey,
      stockNo,
      soldAt: sold.toISOString(),
      make,
      model,
      variant,
      year: year != null && Number.isFinite(year) ? year : null,
      odometerKm: odometerKm != null && Number.isFinite(odometerKm) ? odometerKm : null,
      price,
    });
  }

  if (rows.length === 0) {
    throw new ServiceError(400, "invalid_payload", "No usable sale rows");
  }
  return { adapter: PENTANA_ADAPTER_ID, rows, errors, warnings };
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const text = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export const SYNTHETIC_PENTANA_CSV = `stock_no,sale_date,make,model,badge,year,odometer,sale_price_inc,dealership
SYN-PA-900,2026-10-20,Isuzu,D-MAX,SX,2021,64000,44550,IGNORE-THIS-YARD
SYN-PA-901,2026-09-02,Toyota,Hilux,SR,2019,88000,41990,SOMEONE-ELSE
`;
