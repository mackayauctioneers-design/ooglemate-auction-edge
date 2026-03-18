import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, Search, AlertTriangle, CheckCircle2 } from "lucide-react";

interface MergedDataPreviewProps {
  rows: Record<string, string>[];
  mapping: Record<string, string>;
}

type FilterMode = "all" | "missing_km" | "no_match" | "duplicates";

export function MergedDataPreview({ rows, mapping }: MergedDataPreviewProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  // Derive canonical field → source header reverse map
  const canonicalToSource = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [src, canon] of Object.entries(mapping)) {
      if (canon) map[canon] = src;
    }
    return map;
  }, [mapping]);

  const getValue = (row: Record<string, string>, canonical: string) => {
    const src = canonicalToSource[canonical];
    return src ? row[src] ?? "" : "";
  };

  // Compute stats
  const stats = useMemo(() => {
    const stockNumbers = rows.map((r) => getValue(r, "stock_number")?.trim().toUpperCase()).filter(Boolean);
    const dupeSet = new Set<string>();
    const seen = new Set<string>();
    for (const sn of stockNumbers) {
      if (seen.has(sn)) dupeSet.add(sn);
      seen.add(sn);
    }

    let missingKm = 0;
    let noMatch = 0;
    for (const row of rows) {
      const km = getValue(row, "km");
      if (!km || km === "0" || km.trim() === "") missingKm++;
      const make = getValue(row, "make");
      const model = getValue(row, "model");
      if (!make && !model) noMatch++;
    }

    return {
      total: rows.length,
      missingKm,
      noMatch,
      duplicates: dupeSet.size,
      dupeSet,
      matched: rows.length - noMatch,
      matchPct: rows.length > 0 ? Math.round(((rows.length - noMatch) / rows.length) * 100) : 0,
    };
  }, [rows, canonicalToSource]);

  // Filtered + searched rows
  const filtered = useMemo(() => {
    let result = rows;

    if (filter === "missing_km") {
      result = result.filter((r) => {
        const km = getValue(r, "km");
        return !km || km === "0" || km.trim() === "";
      });
    } else if (filter === "no_match") {
      result = result.filter((r) => !getValue(r, "make") && !getValue(r, "model"));
    } else if (filter === "duplicates") {
      result = result.filter((r) => {
        const sn = getValue(r, "stock_number")?.trim().toUpperCase();
        return sn && stats.dupeSet.has(sn);
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((r) =>
        Object.values(r).some((v) => String(v).toLowerCase().includes(q))
      );
    }

    return result;
  }, [rows, filter, search, stats.dupeSet, canonicalToSource]);

  // Display columns
  const displayCols = ["stock_number", "make", "model", "year", "km", "sale_price", "buy_price", "gross_profit", "days_to_clear"];

  const exportCsv = () => {
    const headers = displayCols;
    const csvRows = [headers.join(",")];
    for (const row of rows) {
      csvRows.push(headers.map((h) => `"${getValue(row, h).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "merged_data_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const filters: { key: FilterMode; label: string; count: number }[] = [
    { key: "all", label: "All", count: rows.length },
    { key: "missing_km", label: "Missing KM", count: stats.missingKm },
    { key: "no_match", label: "No Match", count: stats.noMatch },
    { key: "duplicates", label: "Duplicates", count: stats.duplicates },
  ];

  return (
    <div className="space-y-4">
      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Rows</p>
          <p className="text-lg font-bold">{stats.total}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Matched</p>
          <p className="text-lg font-bold text-primary">
            {stats.matched} <span className="text-sm font-normal">({stats.matchPct}%)</span>
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Missing KM</p>
          <p className="text-lg font-bold">
            {stats.missingKm > 0 ? (
              <span className="flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-4 w-4" /> {stats.missingKm}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-primary">
                <CheckCircle2 className="h-4 w-4" /> 0
              </span>
            )}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Duplicates</p>
          <p className="text-lg font-bold">{stats.duplicates}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search rows..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-1">
          {filters.map((f) => (
            <Button
              key={f.key}
              variant={filter === f.key ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f.key)}
              className="text-xs"
            >
              {f.label}
              {f.count > 0 && filter !== f.key && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1">
                  {f.count}
                </Badge>
              )}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border max-h-[400px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {displayCols.map((col) => (
                <TableHead key={col} className="text-xs whitespace-nowrap">
                  {col.replace(/_/g, " ")}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 100).map((row, i) => {
              const missingKm = (() => {
                const km = getValue(row, "km");
                return !km || km === "0" || km.trim() === "";
              })();
              return (
                <TableRow key={i} className={missingKm ? "bg-destructive/5" : ""}>
                  {displayCols.map((col) => (
                    <TableCell key={col} className="text-xs py-2 whitespace-nowrap">
                      {getValue(row, col) || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={displayCols.length} className="text-center text-muted-foreground py-8">
                  No rows match your filters
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {filtered.length > 100 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing 100 of {filtered.length} rows
        </p>
      )}
    </div>
  );
}
