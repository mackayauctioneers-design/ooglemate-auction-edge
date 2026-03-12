import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DealerLayout } from "@/components/layout/DealerLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Download, Sparkles, Merge } from "lucide-react";
import { DealerIntelligenceReport } from "@/components/onboarding/DealerIntelligenceReport";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { FileDropZone } from "@/components/sales-upload/FileDropZone";
import { DualFileUpload } from "@/components/sales-upload/DualFileUpload";
import { HeaderMappingEditor } from "@/components/sales-upload/HeaderMappingEditor";
import { UploadBatchHistory } from "@/components/sales-upload/UploadBatchHistory";
import { useFileParser } from "@/hooks/useFileParser";
import {
  type HeaderMapping,
  useAIMapping,
  useMappingProfiles,
  useSaveProfile,
  findMatchingProfile,
} from "@/hooks/useHeaderMapping";
import { derivePlatform } from "@/utils/derivePlatform";
import { mergeEasyCarsFiles, readAsWorkbook, type MergeResult } from "@/utils/easycarsmerge";

type UploadStep = "idle" | "parsing" | "mapping" | "importing" | "report";
type UploadMode = "single" | "merge";

/** Extract make/model/year/variant from a combined description string */
function parseDescription(desc: string): {
  year?: number;
  make?: string;
  model?: string;
  variant?: string;
} {
  if (!desc) return {};
  const cleaned = desc.trim();

  // Try pattern: "YEAR MAKE MODEL VARIANT..." (e.g. "2023 Ford Ranger Wildtrak")
  const yearFirst = cleaned.match(
    /^(\d{4})\s+([A-Za-z-]+)\s+([A-Za-z0-9-]+)\s*(.*)?$/
  );
  if (yearFirst) {
    return {
      year: parseInt(yearFirst[1]),
      make: yearFirst[2],
      model: yearFirst[3],
      variant: yearFirst[4]?.trim() || undefined,
    };
  }

  // Try pattern: "MAKE MODEL YEAR VARIANT..." (e.g. "Ford Ranger 2023 Wildtrak")
  const makeFirst = cleaned.match(
    /^([A-Za-z-]+)\s+([A-Za-z0-9-]+)\s+(\d{4})\s*(.*)?$/
  );
  if (makeFirst) {
    return {
      make: makeFirst[1],
      model: makeFirst[2],
      year: parseInt(makeFirst[3]),
      variant: makeFirst[4]?.trim() || undefined,
    };
  }

  // Try pattern: "MAKE MODEL VARIANT YEAR" (e.g. "Toyota Hilux SR5 2021")
  const yearLast = cleaned.match(
    /^([A-Za-z-]+)\s+([A-Za-z0-9-]+)\s+(.*?)\s+(\d{4})$/
  );
  if (yearLast) {
    return {
      make: yearLast[1],
      model: yearLast[2],
      variant: yearLast[3]?.trim() || undefined,
      year: parseInt(yearLast[4]),
    };
  }

  // Try minimal: "MAKE MODEL" with no year (e.g. "Ford Ranger")
  const makeModelOnly = cleaned.match(/^([A-Za-z-]+)\s+([A-Za-z0-9-]+)$/);
  if (makeModelOnly) {
    return {
      make: makeModelOnly[1],
      model: makeModelOnly[2],
    };
  }

  // Try DMS-style: "Make Model Year Variant Extra..." with long suffixes
  // e.g. "Toyota Landcruiser 2024 FJA300R GX Wagon 5dr ..."
  const dmsStyle = cleaned.match(
    /^([A-Za-z-]+)\s+([A-Za-z0-9-]+)\s+(\d{4})\s+(.+)$/
  );
  if (dmsStyle) {
    return {
      make: dmsStyle[1],
      model: dmsStyle[2],
      year: parseInt(dmsStyle[3]),
      variant: dmsStyle[4]?.trim() || undefined,
    };
  }

  // Fallback: extract year if present, and try first two words as make/model
  const yearMatch = cleaned.match(/\b((?:19|20)\d{2})\b/);
  const withoutYear = cleaned.replace(/\b(?:19|20)\d{2}\b/, "").trim();
  const words = withoutYear.split(/\s+/);
  if (words.length >= 2) {
    return {
      year: yearMatch ? parseInt(yearMatch[1]) : undefined,
      make: words[0],
      model: words[1],
      variant: words.slice(2).join(" ") || undefined,
    };
  }

  return { year: yearMatch ? parseInt(yearMatch[1]) : undefined };
}
import { normaliseDateValue } from "@/utils/salesUploadUtils";

export default function SalesUploadPage() {
  const { dealerProfile } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [step, setStep] = useState<UploadStep>("idle");
  const [uploadMode, setUploadMode] = useState<UploadMode>("single");
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [currentMapping, setCurrentMapping] = useState<HeaderMapping>({});
  const [aiMethod, setAiMethod] = useState<string>("");
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<string>("");
  const [mergeStats, setMergeStats] = useState<MergeResult["stats"] | null>(null);
  const [reportRows, setReportRows] = useState<Record<string, string>[]>([]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const aiMapping = useAIMapping();
  const saveProfile = useSaveProfile();
  const { parseFile } = useFileParser();

  // Auto-scope to the dealer's linked account
  useEffect(() => {
    if (dealerProfile?.account_id && !selectedAccountId) {
      setSelectedAccountId(dealerProfile.account_id);
    }
  }, [dealerProfile, selectedAccountId]);
  const { data: profiles } = useMappingProfiles(selectedAccountId);

  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ["upload-batches", selectedAccountId],
    queryFn: async () => {
      if (!selectedAccountId) return [];
      const { data, error } = await supabase
        .from("upload_batches")
        .select("*")
        .eq("account_id", selectedAccountId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedAccountId,
  });

  // Handle file selection — parse then map
  const handleFileSelected = useCallback(
    async (file: File) => {
      try {
        setCurrentFile(file);
        setStep("parsing");

        // Parse file (CSV, XLSX, or PDF via AI)
        const parsed = await parseFile(file);
        setParsedHeaders(parsed.headers);
        setParsedRows(parsed.rows);
        setDetectedFormat(parsed.detectedFormat || "");

        if (!parsed.rows.length) {
          toast.error("No data rows found in file. Try a different format.");
          setStep("idle");
          return;
        }

        // Check for saved profile match
        const matchedProfile = findMatchingProfile(profiles || [], parsed.headers);
        if (matchedProfile) {
          setCurrentMapping(matchedProfile.header_map as HeaderMapping);
          setAiMethod("saved_profile");
          setStep("mapping");
          toast.info("Applied saved mapping profile — review and confirm.");
          return;
        }

        // Call AI mapper
        setStep("mapping");
        const sampleRows = parsed.rows.slice(0, 3);
        const result = await aiMapping.mutateAsync({
          headers: parsed.headers,
          sampleRows,
        });
        setCurrentMapping(result.mapping);
        setAiMethod(result.method);
      } catch (err: any) {
        toast.error(err.message || "Failed to parse file");
        setStep("idle");
      }
    },
    [profiles, parseFile, aiMapping]
  );

  // Handle dual-file merge (EasyCars Sold + Acquisition)
  const handleMergeFiles = useCallback(
    async (soldFile: File, acqFile: File) => {
      try {
        setStep("parsing");
        setCurrentFile(soldFile);

        const soldExt = soldFile.name.split(".").pop()?.toLowerCase();
        const acqExt = acqFile.name.split(".").pop()?.toLowerCase();

        // Parse both files
        let soldData: { wb?: any; pdfRows?: Record<string, string>[] } = {};
        let acqData: { wb?: any; pdfRows?: Record<string, string>[] } = {};

        if (soldExt === "xlsx" || soldExt === "xls") {
          soldData.wb = await readAsWorkbook(soldFile);
        } else if (soldExt === "pdf") {
          const parsed = await parseFile(soldFile);
          soldData.pdfRows = parsed.rows;
        } else {
          const parsed = await parseFile(soldFile);
          soldData.pdfRows = parsed.rows;
        }

        if (acqExt === "xlsx" || acqExt === "xls") {
          acqData.wb = await readAsWorkbook(acqFile);
        } else if (acqExt === "pdf") {
          const parsed = await parseFile(acqFile);
          acqData.pdfRows = parsed.rows;
        } else {
          const parsed = await parseFile(acqFile);
          acqData.pdfRows = parsed.rows;
        }

        // Merge
        const result = mergeEasyCarsFiles(soldData, acqData);
        setParsedHeaders(result.headers);
        setParsedRows(result.rows);
        setMergeStats(result.stats);
        setDetectedFormat("EasyCars Merge");

        // Build direct mapping (headers already canonical)
        const directMapping: HeaderMapping = {};
        for (const h of result.headers) {
          directMapping[h] = h; // headers are already canonical field names
        }
        // Map our output names to the canonical import names
        directMapping["sold_at"] = "sold_at";
        directMapping["sold_to"] = "notes"; // store sold_to in notes
        directMapping["stock_no"] = "stock_no";
        setCurrentMapping(directMapping);
        setAiMethod("easycars_merge");
        setStep("mapping");

        toast.success(
          `Merged: ${result.stats.matchedCount}/${result.stats.soldCount} sales matched with acquisition data`
        );
      } catch (err: any) {
        toast.error(err.message || "Failed to merge files");
        setStep("idle");
      }
    },
    [parseFile]
  );


  const importMutation = useMutation({
    mutationFn: async () => {
      if (!parsedRows.length || !selectedAccountId) {
        throw new Error("No data to import");
      }

      // Create upload batch record
      const { data: batch, error: batchError } = await supabase
        .from("upload_batches")
        .insert({
          account_id: selectedAccountId,
          upload_type: "sales_universal",
          filename: currentFile?.name || "unknown",
          uploaded_by: "josh",
          row_count: parsedRows.length,
          raw_headers: parsedHeaders,
          status: "pending",
        } as any)
        .select()
        .single();

      if (batchError) throw batchError;

      // Map rows using confirmed mapping
      const truthRows: any[] = [];
      const skippedRows: { row: number; reason: string }[] = [];

      for (let i = 0; i < parsedRows.length; i++) {
        const raw = parsedRows[i];
        const mapped: Record<string, any> = {};

        // Debug first 3 rows
        if (i < 3) {
          console.log(`[SalesUpload] Row ${i} raw keys:`, Object.keys(raw));
          console.log(`[SalesUpload] Row ${i} raw values:`, JSON.stringify(raw).slice(0, 300));
          console.log(`[SalesUpload] Mapping:`, JSON.stringify(currentMapping));
        }

        // Apply mapping
        for (const [sourceHeader, canonicalField] of Object.entries(currentMapping)) {
          if (canonicalField && raw[sourceHeader] !== undefined) {
            mapped[canonicalField] = raw[sourceHeader];
          }
        }

        if (i < 3) {
          console.log(`[SalesUpload] Row ${i} mapped:`, JSON.stringify(mapped).slice(0, 300));
        }

        // Normalise date fields (DD/MM/YYYY → YYYY-MM-DD for Postgres)
        for (const dateField of ["sold_at", "acquired_at"]) {
          if (mapped[dateField]) {
            mapped[dateField] = normaliseDateValue(String(mapped[dateField]));
          }
        }

        // Standardise case formatting for structured fields
        if (mapped.make) mapped.make = String(mapped.make).trim().replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, ' ');
        if (mapped.model) mapped.model = String(mapped.model).trim().replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, ' ');
        if (mapped.series) mapped.series = String(mapped.series).trim();
        if (mapped.badge) mapped.badge = String(mapped.badge).trim();
        if (mapped.variant) mapped.variant = String(mapped.variant).trim();

        // Store raw description for reference only — NOT used for matching
        // Description-based parsing removed: structured fields drive replication engine

        // Require make + model + sold_at (DB NOT NULL constraints)
        if (!mapped.make || !mapped.model) {
          skippedRows.push({
            row: i + 1,
            reason: mapped.description
              ? `Could not extract make/model from "${String(mapped.description).slice(0, 60)}"`
              : `No make or model found (mapped keys: ${Object.keys(mapped).join(", ")})`,
          });
          continue;
        }

        if (!mapped.sold_at) {
          skippedRows.push({ row: i + 1, reason: "No valid sale date" });
          continue;
        }

        // Compute days_to_clear from mapped field OR from date difference
        let daysToCleer: number | null = null;
        if (mapped.days_to_clear) {
          const parsed = parseInt(String(mapped.days_to_clear).replace(/[^0-9]/g, ""));
          if (!isNaN(parsed) && parsed >= 0) daysToCleer = parsed;
        }
        if (daysToCleer == null && mapped.acquired_at && mapped.sold_at) {
          try {
            const acq = new Date(mapped.acquired_at);
            const sold = new Date(mapped.sold_at);
            const diff = Math.round(
              (sold.getTime() - acq.getTime()) / (1000 * 60 * 60 * 24)
            );
            if (diff >= 0) daysToCleer = diff;
          } catch {}
        }

        // Parse currency values robustly: strip $, commas, handle (negatives)
        const parseCurrency = (val: any): number | null => {
          if (val == null || val === "") return null;
          let s = String(val).trim();
          // Handle parenthetical negatives: (3,200) → -3200
          const isNeg = s.startsWith("(") && s.endsWith(")");
          s = s.replace(/[($,)]/g, "");
          const num = parseFloat(s);
          if (isNaN(num)) return null;
          return isNeg ? -num : num;
        };

        const salePriceVal = parseCurrency(mapped.sale_price);
        let buyPriceVal = parseCurrency(mapped.buy_price);
        const grossProfitVal = parseCurrency(mapped.gross_profit);

        // Derive buy_price from sale_price - gross_profit when buy_price is missing
        if (buyPriceVal == null && salePriceVal != null && grossProfitVal != null) {
          buyPriceVal = salePriceVal - grossProfitVal;
        }

        const profitPct =
          buyPriceVal && buyPriceVal > 0 && salePriceVal != null
            ? Math.round(((salePriceVal - buyPriceVal) / buyPriceVal) * 1000) / 10
            : null;

        truthRows.push({
          account_id: selectedAccountId,
          sold_at: mapped.sold_at || null,
          acquired_at: mapped.acquired_at || null,
          make: mapped.make || null,
          model: mapped.model || null,
          series: mapped.series || null,
          badge: mapped.badge || null,
          variant: mapped.variant || null,
          year: mapped.year ? parseInt(String(mapped.year)) : null,
          km: mapped.km ? Math.floor(parseFloat(String(mapped.km).replace(/[^0-9.]/g, ""))) || null : null,
          sale_price: salePriceVal,
          buy_price: buyPriceVal,
          profit_pct: profitPct,
          transmission: mapped.transmission || null,
          fuel_type: mapped.fuel_type || null,
          body_type: mapped.body_type || null,
          description_raw: mapped.description || null,
          notes: mapped.notes || null,
          source: "dealer",
          confidence: mapped.make && mapped.model ? "high" : "medium",
          days_to_clear: daysToCleer,
          platform_class: derivePlatform(mapped.make, mapped.model),
        });
      }

      if (!truthRows.length) {
        throw new Error(
          `No usable rows found (${skippedRows.length} rows had no identifiable data)`
        );
      }

      // Deduplicate: build a signature for each row and remove duplicates within the batch
      const seen = new Set<string>();
      const uniqueRows = truthRows.filter((r: any) => {
        const sig = [r.make, r.model, r.year, r.badge, r.sold_at, r.sale_price, r.km]
          .map((v) => String(v ?? "").toLowerCase().trim())
          .join("|");
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      });

      const dupsInBatch = truthRows.length - uniqueRows.length;
      if (dupsInBatch > 0) {
        console.log(`[SalesUpload] Removed ${dupsInBatch} duplicate rows within batch`);
      }

      // Insert in chunks of 200 to avoid payload limits
      const CHUNK = 200;
      let insertedCount = 0;
      for (let c = 0; c < uniqueRows.length; c += CHUNK) {
        const slice = uniqueRows.slice(c, c + CHUNK);
        const { error: truthError } = await supabase
          .from("vehicle_sales_truth")
          .insert(slice);
        if (truthError) throw truthError;
        insertedCount += slice.length;
      }

      // Update batch status
      await supabase
        .from("upload_batches")
        .update({
          status: "promoted",
          error_count: skippedRows.length,
          error_report: skippedRows.length ? skippedRows : null,
          promoted_at: new Date().toISOString(),
          promoted_by: "josh",
        } as any)
        .eq("id", batch.id);

      // Save the mapping profile for future use
      const profileName = currentFile?.name
        ? `Auto: ${currentFile.name.replace(/\.[^.]+$/, "")}`
        : `Auto: ${new Date().toISOString().slice(0, 10)}`;

      await saveProfile.mutateAsync({
        accountId: selectedAccountId,
        profileName,
        headerMap: currentMapping,
        sourceHeaders: parsedHeaders,
      });

      // Count outcome coverage for audit summary
      const withBuyPrice = uniqueRows.filter(
        (r: any) => r.buy_price != null && r.sale_price != null
      ).length;
      const withClearance = uniqueRows.filter(
        (r: any) => r.days_to_clear != null
      ).length;

      return {
        imported: insertedCount,
        skipped: skippedRows.length + dupsInBatch,
        withBuyPrice,
        withClearance,
      };
    },
    onSuccess: async ({ imported, skipped, withBuyPrice, withClearance }) => {
      queryClient.invalidateQueries({ queryKey: ["upload-batches"] });

      // Show detailed audit summary
      const parts = [`${imported} records imported`];
      if (withBuyPrice != null) parts.push(`${withBuyPrice} with buy + sale price`);
      if (withClearance != null) parts.push(`${withClearance} with clearance data`);
      if (skipped > 0) parts.push(`${skipped} rows skipped`);
      toast.success(parts.join(" · "));

      // Save rows for the intelligence report before resetting
      setReportRows([...parsedRows]);
      resetState();
      setStep("report");

      // Auto-run Winners Watchlist + Target Conduit in background
      try {
        const { error: winnersErr } = await supabase.functions.invoke(
          "update-winners-watchlist",
          { body: { account_id: selectedAccountId } }
        );
        if (winnersErr) console.error("update-winners-watchlist error:", winnersErr);

        const { error: buildErr } = await supabase.functions.invoke(
          "build-sales-targets",
          { body: { account_id: selectedAccountId } }
        );
        if (buildErr) console.error("build-sales-targets error:", buildErr);

        const { error: genErr } = await supabase.functions.invoke(
          "generate-daily-targets",
          { body: { account_id: selectedAccountId, n: 15 } }
        );
        if (genErr) console.error("generate-daily-targets error:", genErr);
      } catch (e) {
        console.error("Post-upload pipeline error:", e);
      }
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const resetState = () => {
    setStep("idle");
    setParsedHeaders([]);
    setParsedRows([]);
    setCurrentMapping({});
    setCurrentFile(null);
    setDetectedFormat("");
    setMergeStats(null);
  };

  const downloadTemplate = () => {
    const cols = [
      "sale_date", "year", "make", "model", "series", "badge",
      "body_type", "transmission", "fuel_type", "km", "sale_price",
      "buy_price", "location", "notes",
    ];
    const csv = cols.join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sales_log_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const isProcessingFile = step === "parsing" || aiMapping.isPending;

  return (
    <DealerLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <FileSpreadsheet className="h-6 w-6 text-primary" />
              My Sales
            </h1>
            <p className="text-sm text-muted-foreground">
              Upload your sales file — we handle the rest
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1" />
              Template
            </Button>
          </div>
        </div>

        {/* Guard — no linked account */}
        {!selectedAccountId && step === "idle" && (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">No dealer account linked</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Contact your admin to link your account</p>
          </div>
        )}

        {/* Mode toggle */}
        {selectedAccountId && step === "idle" && (
          <div className="flex gap-2">
            <Button
              variant={uploadMode === "single" ? "default" : "outline"}
              size="sm"
              onClick={() => setUploadMode("single")}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1" />
              Single File
            </Button>
            <Button
              variant={uploadMode === "merge" ? "default" : "outline"}
              size="sm"
              onClick={() => setUploadMode("merge")}
            >
              <Merge className="h-4 w-4 mr-1" />
              EasyCars Merge
            </Button>
          </div>
        )}

        {/* Step: Idle → Single file Drop Zone */}
        {selectedAccountId && uploadMode === "single" && (step === "idle" || step === "parsing") && (
          <FileDropZone
            onFileSelected={handleFileSelected}
            isProcessing={isProcessingFile}
          />
        )}

        {/* Step: Idle → Dual file merge */}
        {selectedAccountId && uploadMode === "merge" && (step === "idle" || step === "parsing") && (
          <DualFileUpload
            onFilesReady={handleMergeFiles}
            isProcessing={isProcessingFile}
          />
        )}

        {/* Merge stats banner */}
        {mergeStats && step === "mapping" && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Merge className="h-4 w-4 text-primary" />
              Merge Complete
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 text-sm">
              <div>
                <p className="text-muted-foreground">Sales</p>
                <p className="font-semibold">{mergeStats.soldCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Acquisition Records</p>
                <p className="font-semibold">{mergeStats.acqCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Matched</p>
                <p className="font-semibold text-primary">{mergeStats.matchedCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Unmatched</p>
                <p className="font-semibold">{mergeStats.unmatchedCount}</p>
              </div>
            </div>
          </div>
        )}

        {/* Step: Mapping → Header Editor */}
        {step === "mapping" && (
          <>
            {detectedFormat && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">{detectedFormat}</Badge>
                <span>
                  {parsedRows.length} rows detected with {parsedHeaders.length} columns
                </span>
              </div>
            )}
            <HeaderMappingEditor
              headers={parsedHeaders}
              mapping={currentMapping}
              sampleRow={parsedRows[0]}
              aiMethod={aiMethod}
              onMappingChange={setCurrentMapping}
              onConfirm={() => importMutation.mutate()}
              onCancel={resetState}
              isConfirming={importMutation.isPending}
            />
          </>
        )}

        {/* Step: Report — Intelligence Report after import */}
        {step === "report" && reportRows.length > 0 && (
          <DealerIntelligenceReport
            salesRows={reportRows}
            dealerName={dealerProfile?.dealer_name || "Your Dealership"}
            hasWebsite={false}
            onContinue={() => {
              setReportRows([]);
              setStep("idle");
              navigate("/sales-insights");
            }}
          />
        )}

        {/* Saved profiles info */}
        {profiles && profiles.length > 0 && step === "idle" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            <span>
              {profiles.length} saved mapping{profiles.length !== 1 ? "s" : ""} —
              matching uploads will auto-map
            </span>
          </div>
        )}

        {/* Recent uploads */}
        {step !== "report" && <UploadBatchHistory batches={batches} isLoading={batchesLoading} />}
      </div>
    </DealerLayout>
  );
}
