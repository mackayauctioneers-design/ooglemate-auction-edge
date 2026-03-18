import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Download, Sparkles, Merge } from "lucide-react";
import { toast } from "sonner";
import { useAccounts } from "@/hooks/useAccounts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileDropZone } from "@/components/sales-upload/FileDropZone";
import { DualFileUpload } from "@/components/sales-upload/DualFileUpload";
import { HeaderMappingEditor } from "@/components/sales-upload/HeaderMappingEditor";
import { UploadBatchHistory } from "@/components/sales-upload/UploadBatchHistory";
import { MergedDataPreview } from "@/components/sales-upload/MergedDataPreview";
import { MergeAnalysisPanel } from "@/components/sales-upload/MergeAnalysisPanel";
import { useFileParser } from "@/hooks/useFileParser";
import {
  type HeaderMapping,
  useAIMapping,
  useMappingProfiles,
  useSaveProfile,
  findMatchingProfile,
} from "@/hooks/useHeaderMapping";
import { normaliseDateValue } from "@/utils/salesUploadUtils";
import { derivePlatform } from "@/utils/derivePlatform";
import { mergeEasyCarsFiles, readAsWorkbook, parseDescription, type MergeResult } from "@/utils/easycarsmerge";

type UploadStep = "idle" | "parsing" | "mapping" | "importing";
type UploadMode = "single" | "merge";

export default function OperatorDealerUploadPage() {
  const { data: accounts } = useAccounts();
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const aiMapping = useAIMapping();
  const saveProfile = useSaveProfile();
  const { parseFile } = useFileParser();

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

  const handleFileSelected = useCallback(
    async (file: File) => {
      try {
        setCurrentFile(file);
        setStep("parsing");

        const parsed = await parseFile(file);
        setParsedHeaders(parsed.headers);
        setParsedRows(parsed.rows);
        setDetectedFormat(parsed.detectedFormat || "");

        if (!parsed.rows.length) {
          toast.error("No data rows found in file.");
          setStep("idle");
          return;
        }

        const matchedProfile = findMatchingProfile(profiles || [], parsed.headers);
        if (matchedProfile) {
          setCurrentMapping(matchedProfile.header_map as HeaderMapping);
          setAiMethod("saved_profile");
          setStep("mapping");
          toast.info("Applied saved mapping profile — review and confirm.");
          return;
        }

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

        let soldData: { wb?: any; pdfRows?: Record<string, string>[] } = {};
        let acqData: { wb?: any; pdfRows?: Record<string, string>[] } = {};

        if (soldExt === "xlsx" || soldExt === "xls") {
          soldData.wb = await readAsWorkbook(soldFile);
        } else {
          const parsed = await parseFile(soldFile);
          soldData.pdfRows = parsed.rows;
        }

        if (acqExt === "xlsx" || acqExt === "xls") {
          acqData.wb = await readAsWorkbook(acqFile);
        } else {
          const parsed = await parseFile(acqFile);
          acqData.pdfRows = parsed.rows;
        }

        const result = mergeEasyCarsFiles(soldData, acqData);
        setParsedHeaders(result.headers);
        setParsedRows(result.rows);
        setMergeStats(result.stats);
        setDetectedFormat("EasyCars Merge");

        const directMapping: HeaderMapping = {};
        for (const h of result.headers) {
          directMapping[h] = h;
        }
        directMapping["sold_to"] = "notes";
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

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      if (!parsedRows.length || !selectedAccountId) {
        throw new Error("No data to import");
      }

      const { data: batch, error: batchError } = await supabase
        .from("upload_batches")
        .insert({
          account_id: selectedAccountId,
          upload_type: "sales_universal",
          filename: currentFile?.name || "unknown",
          uploaded_by: "operator",
          row_count: parsedRows.length,
          raw_headers: parsedHeaders,
          status: "pending",
        } as any)
        .select()
        .single();

      if (batchError) throw batchError;

      const truthRows: any[] = [];
      const skippedRows: { row: number; reason: string }[] = [];

      for (let i = 0; i < parsedRows.length; i++) {
        const raw = parsedRows[i];
        const mapped: Record<string, any> = {};

        for (const [sourceHeader, canonicalField] of Object.entries(currentMapping)) {
          if (canonicalField && raw[sourceHeader] !== undefined) {
            mapped[canonicalField] = raw[sourceHeader];
          }
        }

        for (const dateField of ["sold_at", "acquired_at"]) {
          if (mapped[dateField]) {
            mapped[dateField] = normaliseDateValue(String(mapped[dateField]));
          }
        }

        if (mapped.make) mapped.make = String(mapped.make).trim().replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, ' ');
        if (mapped.model) mapped.model = String(mapped.model).trim().replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, ' ');
        if (mapped.series) mapped.series = String(mapped.series).trim();
        if (mapped.badge) mapped.badge = String(mapped.badge).trim();
        if (mapped.variant) mapped.variant = String(mapped.variant).trim();

        // If make/model missing but description present, parse from description
        if ((!mapped.make || !mapped.model) && mapped.description) {
          const parsed = parseDescription(String(mapped.description));
          if (!mapped.make && parsed.make) mapped.make = parsed.make;
          if (!mapped.model && parsed.model) mapped.model = parsed.model;
          if (!mapped.year && parsed.year) mapped.year = parsed.year;
          if (!mapped.variant && parsed.variant) mapped.variant = parsed.variant;
        }

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

        let daysToCleer: number | null = null;
        if (mapped.days_to_clear) {
          const parsed = parseInt(String(mapped.days_to_clear).replace(/[^0-9]/g, ""));
          if (!isNaN(parsed) && parsed >= 0) daysToCleer = parsed;
        }
        if (daysToCleer == null && mapped.acquired_at && mapped.sold_at) {
          try {
            const acq = new Date(mapped.acquired_at);
            const sold = new Date(mapped.sold_at);
            const diff = Math.round((sold.getTime() - acq.getTime()) / (1000 * 60 * 60 * 24));
            if (diff >= 0) daysToCleer = diff;
          } catch {}
        }

        const parseCurrency = (val: any): number | null => {
          if (val == null || val === "") return null;
          let s = String(val).trim();
          const isNeg = s.startsWith("(") && s.endsWith(")");
          s = s.replace(/[($,)]/g, "");
          const num = parseFloat(s);
          if (isNaN(num)) return null;
          return Math.round(isNeg ? -num : num);
        };

        const salePriceVal = parseCurrency(mapped.sale_price);
        let buyPriceVal = parseCurrency(mapped.buy_price);
        const grossProfitVal = parseCurrency(mapped.gross_profit);

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
          source: "operator",
          confidence: mapped.make && mapped.model ? "high" : "medium",
          days_to_clear: daysToCleer,
          platform_class: derivePlatform(mapped.make, mapped.model),
        });
      }

      if (!truthRows.length) {
        throw new Error(`No usable rows (${skippedRows.length} skipped)`);
      }

      const seen = new Set<string>();
      const uniqueRows = truthRows.filter((r: any) => {
        const sig = [r.make, r.model, r.year, r.badge, r.sold_at, r.sale_price, r.km]
          .map((v) => String(v ?? "").toLowerCase().trim())
          .join("|");
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      });

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

      await supabase
        .from("upload_batches")
        .update({
          status: "promoted",
          error_count: skippedRows.length,
          error_report: skippedRows.length ? skippedRows : null,
          promoted_at: new Date().toISOString(),
          promoted_by: "operator",
        } as any)
        .eq("id", batch.id);

      await saveProfile.mutateAsync({
        accountId: selectedAccountId,
        profileName: currentFile?.name
          ? `Auto: ${currentFile.name.replace(/\.[^.]+$/, "")}`
          : `Auto: ${new Date().toISOString().slice(0, 10)}`,
        headerMap: currentMapping,
        sourceHeaders: parsedHeaders,
      });

      const dupsInBatch = truthRows.length - uniqueRows.length;
      return {
        imported: insertedCount,
        skipped: skippedRows.length + dupsInBatch,
      };
    },
    onSuccess: ({ imported, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ["upload-batches"] });
      resetState();
      const msg = `${imported} records imported` + (skipped > 0 ? ` · ${skipped} skipped` : "");
      toast.success(msg);
      navigate(`/sales-insights?account=${selectedAccountId}`);
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
  const selectedAccount = accounts?.find(a => a.id === selectedAccountId);

  return (
    <OperatorLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <FileSpreadsheet className="h-6 w-6 text-primary" />
              Dealer Sales Upload
            </h1>
            <p className="text-sm text-muted-foreground">
              Upload sales data on behalf of a dealer
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" />
            Template
          </Button>
        </div>

        {/* Account selector */}
        <Select value={selectedAccountId} onValueChange={(v) => { setSelectedAccountId(v); resetState(); }}>
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue placeholder="Select dealer account" />
          </SelectTrigger>
          <SelectContent>
            {accounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Context banner */}
        {selectedAccount && (
          <div className="text-sm text-muted-foreground bg-muted/30 px-3 py-2 rounded-md">
            Uploading for: <span className="font-medium text-foreground">{selectedAccount.display_name}</span>
          </div>
        )}

        {/* Guard — no account selected */}
        {!selectedAccountId && step === "idle" && (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">Select a dealer account above to begin</p>
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
            {detectedFormat && !mergeStats && (
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
        <UploadBatchHistory batches={batches} isLoading={batchesLoading} />
      </div>
    </OperatorLayout>
  );
}
