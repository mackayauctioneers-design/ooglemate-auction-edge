import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Download, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useAccounts } from "@/hooks/useAccounts";
import { FileDropZone } from "@/components/sales-upload/FileDropZone";
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

type UploadStep = "idle" | "parsing" | "mapping" | "importing";

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
/** Normalise AU date formats (DD/MM/YYYY, D/M/YYYY, DD/MM/YY) → YYYY-MM-DD for Postgres.
 *  Returns null for values that are clearly not dates (e.g. "0", empty, garbage). */
function normaliseDateValue(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Reject obviously invalid values
  if (!trimmed || /^0+$/.test(trimmed) || trimmed.length < 4) return null;

  // Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) return trimmed;

  // DD/MM/YYYY or D/M/YYYY (Australian format, 4-digit year)
  const slash4 = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (slash4) {
    const day = slash4[1].padStart(2, "0");
    const month = slash4[2].padStart(2, "0");
    const year = slash4[3];
    return `${year}-${month}-${day}`;
  }

  // DD/MM/YY or D/M/YY (2-digit year — common in AU exports like EasyCars)
  const slash2 = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (slash2) {
    const day = slash2[1].padStart(2, "0");
    const month = slash2[2].padStart(2, "0");
    const shortYear = parseInt(slash2[3]);
    const year = shortYear >= 50 ? `19${slash2[3]}` : `20${slash2[3]}`;
    return `${year}-${month}-${day}`;
  }

  return trimmed;
}

export default function SalesUploadPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [step, setStep] = useState<UploadStep>("idle");
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [currentMapping, setCurrentMapping] = useState<HeaderMapping>({});
  const [aiMethod, setAiMethod] = useState<string>("");
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<string>("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const aiMapping = useAIMapping();
  const saveProfile = useSaveProfile();
  const { parseFile } = useFileParser();

  // No default — user must explicitly select a dealer account

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

  // Import mutation: normalize rows into vehicle_sales_truth
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

        // If there's a description field, extract vehicle identity from it
        if (mapped.description && (!mapped.make || !mapped.model)) {
          const extracted = parseDescription(String(mapped.description));
          if (i < 3) console.log(`[SalesUpload] Row ${i} parseDescription result:`, extracted);
          if (extracted.make && !mapped.make) mapped.make = extracted.make;
          if (extracted.model && !mapped.model) mapped.model = extracted.model;
          if (extracted.year && !mapped.year) mapped.year = String(extracted.year);
          if (extracted.variant && !mapped.variant) mapped.variant = extracted.variant;
        }

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

        // Compute days_to_clear
        let daysToCleer: number | null = null;
        if (mapped.acquired_at && mapped.sold_at) {
          try {
            const acq = new Date(mapped.acquired_at);
            const sold = new Date(mapped.sold_at);
            const diff = Math.round(
              (sold.getTime() - acq.getTime()) / (1000 * 60 * 60 * 24)
            );
            if (diff >= 0) daysToCleer = diff;
          } catch {}
        }

        truthRows.push({
          account_id: selectedAccountId,
          sold_at: mapped.sold_at || null,
          acquired_at: mapped.acquired_at || null,
          make: mapped.make || null,
          model: mapped.model || null,
          variant: mapped.variant || null,
          year: mapped.year ? parseInt(String(mapped.year)) : null,
          km: mapped.km
            ? parseInt(String(mapped.km).replace(/[^0-9]/g, ""))
            : null,
          sale_price: mapped.sale_price
            ? parseFloat(String(mapped.sale_price).replace(/[^0-9.]/g, ""))
            : null,
          transmission: mapped.transmission || null,
          fuel_type: mapped.fuel_type || null,
          body_type: mapped.body_type || null,
          notes: mapped.notes || null,
          source: "dealer",
          confidence: mapped.make && mapped.model ? "high" : "medium",
          days_to_clear: daysToCleer,
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
        const sig = [r.make, r.model, r.year, r.sold_at, r.sale_price, r.km]
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

      return { imported: insertedCount, skipped: skippedRows.length + dupsInBatch };
    },
    onSuccess: async ({ imported, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ["upload-batches"] });
      resetState();

      if (skipped > 0) {
        toast.warning(
          `Imported ${imported} records (${skipped} rows skipped — no identifiable data).`
        );
      } else {
        toast.success(`Imported ${imported} records. Building targets…`);
      }

      // Auto-run Target Conduit: build candidates then generate daily targets
      try {
        toast.info("Analysing sales truth → building target candidates…");
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

        toast.success("Targets generated — redirecting to insights.");
      } catch (e) {
        console.error("Target conduit error:", e);
      }

      setTimeout(() => navigate("/sales-insights"), 1500);
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
  };

  const downloadTemplate = () => {
    const cols = [
      "dealer_name", "sale_date", "year", "make", "model",
      "variant", "km", "sale_price", "buy_price", "location", "notes",
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
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileSpreadsheet className="h-6 w-6" />
              Sales Upload
            </h1>
            <p className="text-muted-foreground">
              Upload your sales file — we handle the rest
            </p>
          </div>
          <div className="flex gap-2">
            <AccountSelector
              value={selectedAccountId}
              onChange={setSelectedAccountId}
            />
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1" />
              Template
            </Button>
          </div>
        </div>

        {/* Guard — no account selected */}
        {!selectedAccountId && step === "idle" && (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">Select a dealer account above to begin</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Uploads are scoped to a single dealer account</p>
          </div>
        )}

        {/* Step: Idle → Drop Zone */}
        {selectedAccountId && (step === "idle" || step === "parsing") && (
          <FileDropZone
            onFileSelected={handleFileSelected}
            isProcessing={isProcessingFile}
          />
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
    </AppLayout>
  );
}
