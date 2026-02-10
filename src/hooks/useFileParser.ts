import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  detectedFormat?: string;
}

/** Parse a CSV string into headers + rows */
function parseCSV(text: string): ParsedFile {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) throw new Error("File must have at least a header and one data row");

  // Handle quoted fields with commas inside
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

  const headers = parseLine(lines[0]).map((h) => h.replace(/^["']|["']$/g, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.length === 1 && !values[0]) continue; // skip blank lines
    const row: Record<string, string> = {};
    headers.forEach((col, idx) => {
      row[col] = (values[idx] || "").replace(/^["']|["']$/g, "");
    });
    rows.push(row);
  }

  return { headers, rows, detectedFormat: "CSV" };
}

/** Parse an Excel file buffer into headers + rows */
function parseXLSX(buffer: ArrayBuffer): ParsedFile {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("No sheets found in workbook");

  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: "",
    raw: false,
  });

  if (!json.length) throw new Error("No data rows found in spreadsheet");

  const headers = Object.keys(json[0]);
  const rows = json.map((row) => {
    const out: Record<string, string> = {};
    for (const h of headers) {
      out[h] = String(row[h] ?? "");
    }
    return out;
  });

  return { headers, rows, detectedFormat: "Excel" };
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = dataUrl.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function useFileParser() {
  const pdfExtract = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await readFileAsBase64(file);
      const { data, error } = await supabase.functions.invoke("sales-document-extract", {
        body: { pdf_base64: base64, filename: file.name },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data as ParsedFile;
    },
  });

  const parseFile = useCallback(
    async (file: File): Promise<ParsedFile> => {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";

      if (ext === "xlsx" || ext === "xls") {
        const buffer = await readFileAsArrayBuffer(file);
        return parseXLSX(buffer);
      }

      if (ext === "pdf") {
        // Send PDF as base64 for AI extraction (text extraction + chunked AI)
        const base64 = await readFileAsBase64(file);
        const sizeMB = (base64.length / 1024 / 1024).toFixed(1);
        console.log(`[useFileParser] PDF base64 size: ${sizeMB}MB, sending to extraction…`);

        let data: any;
        let error: any;
        try {
          const result = await supabase.functions.invoke("sales-document-extract", {
            body: { pdf_base64: base64, filename: file.name },
          });
          data = result.data;
          error = result.error;
        } catch (fetchErr: any) {
          console.error("[useFileParser] PDF fetch error:", fetchErr);
          throw new Error("PDF processing timed out. The file may be too large — try exporting as CSV or XLSX from your DMS.");
        }

        if (error) {
          const msg = typeof error === "object" && error.message ? error.message : String(error);
          console.error("[useFileParser] PDF extraction error:", msg);
          if (msg.includes("Failed to send") || msg.includes("FunctionsFetchError")) {
            throw new Error("PDF processing timed out. Try exporting as CSV or XLSX from your DMS instead.");
          }
          throw new Error(`PDF extraction failed: ${msg}`);
        }
        if (!data) throw new Error("No response from PDF extraction — try CSV or XLSX.");
        if (data.error) throw new Error(data.error);
        if (!data.headers?.length) throw new Error(data.error || "Could not extract data from this PDF. Try CSV or XLSX.");
        console.log(`[useFileParser] PDF extracted: ${data.rows?.length} rows, ${data.headers?.length} columns`);
        return {
          headers: data.headers,
          rows: data.rows,
          detectedFormat: data.detected_format || "PDF",
        };
      }

      // Default: treat as CSV/TSV
      const text = await readFileAsText(file);
      // Detect tab-separated
      const firstLine = text.split("\n")[0] || "";
      if (firstLine.includes("\t") && !firstLine.includes(",")) {
        const converted = text
          .split("\n")
          .map((line) =>
            line
              .split("\t")
              .map((cell) => `"${cell.replace(/"/g, '""')}"`)
              .join(",")
          )
          .join("\n");
        return parseCSV(converted);
      }

      return parseCSV(text);
    },
    []
  );

  return { parseFile, pdfExtract };
}
