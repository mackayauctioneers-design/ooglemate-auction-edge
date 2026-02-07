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
import {
  type HeaderMapping,
  useAIMapping,
  useMappingProfiles,
  useSaveProfile,
  findMatchingProfile,
} from "@/hooks/useHeaderMapping";

type UploadStep = "idle" | "mapping" | "importing";

export default function SalesUploadPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [step, setStep] = useState<UploadStep>("idle");
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [currentMapping, setCurrentMapping] = useState<HeaderMapping>({});
  const [aiMethod, setAiMethod] = useState<string>("");
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const aiMapping = useAIMapping();
  const saveProfile = useSaveProfile();

  // Default to first account
  if (!selectedAccountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    if (mackay) setSelectedAccountId(mackay.id);
    else setSelectedAccountId(accounts[0].id);
  }

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

  // Parse CSV text into headers + rows
  const parseCSV = useCallback((text: string) => {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) throw new Error("File must have at least a header and one data row");

    const header = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
    const rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
      const row: Record<string, string> = {};
      header.forEach((col, idx) => {
        row[col] = values[idx] || "";
      });
      rows.push(row);
    }

    return { header, rows };
  }, []);

  // Handle file selection
  const handleFileSelected = useCallback(
    async (file: File) => {
      try {
        setCurrentFile(file);
        const text = await file.text();
        const { header, rows } = parseCSV(text);
        setParsedHeaders(header);
        setParsedRows(rows);

        // Check for saved profile match
        const matchedProfile = findMatchingProfile(profiles || [], header);
        if (matchedProfile) {
          // Auto-apply saved profile
          setCurrentMapping(matchedProfile.header_map as HeaderMapping);
          setAiMethod("saved_profile");
          setStep("mapping");
          toast.info("Applied saved mapping profile — review and confirm.");
          return;
        }

        // Call AI mapper
        setStep("mapping");
        const sampleRows = rows.slice(0, 3);
        const result = await aiMapping.mutateAsync({ headers: header, sampleRows });
        setCurrentMapping(result.mapping);
        setAiMethod(result.method);
      } catch (err: any) {
        toast.error(err.message || "Failed to parse file");
        setStep("idle");
      }
    },
    [profiles, parseCSV, aiMapping]
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
          status: "importing",
        } as any)
        .select()
        .single();

      if (batchError) throw batchError;

      // Map rows using confirmed mapping
      const truthRows: any[] = [];
      const errors: { row: number; errors: string[] }[] = [];

      for (let i = 0; i < parsedRows.length; i++) {
        const raw = parsedRows[i];
        const mapped: Record<string, any> = {};

        // Apply mapping
        for (const [sourceHeader, canonicalField] of Object.entries(currentMapping)) {
          if (canonicalField && raw[sourceHeader] !== undefined) {
            mapped[canonicalField] = raw[sourceHeader];
          }
        }

        // Validate required
        const rowErrors: string[] = [];
        if (!mapped.sold_at) rowErrors.push("sold_at required");
        if (!mapped.make) rowErrors.push("make required");
        if (!mapped.model) rowErrors.push("model required");

        if (rowErrors.length) {
          errors.push({ row: i + 1, errors: rowErrors });
          continue;
        }

        // Compute days_to_clear
        let daysToCleer: number | null = null;
        if (mapped.acquired_at && mapped.sold_at) {
          try {
            const acq = new Date(mapped.acquired_at);
            const sold = new Date(mapped.sold_at);
            const diff = Math.round((sold.getTime() - acq.getTime()) / (1000 * 60 * 60 * 24));
            if (diff >= 0) daysToCleer = diff;
          } catch {}
        }

        truthRows.push({
          account_id: selectedAccountId,
          sold_at: mapped.sold_at,
          acquired_at: mapped.acquired_at || null,
          make: mapped.make,
          model: mapped.model,
          variant: mapped.variant || null,
          year: mapped.year ? parseInt(mapped.year) : null,
          km: mapped.km ? parseInt(String(mapped.km).replace(/[^0-9]/g, "")) : null,
          sale_price: mapped.sale_price
            ? parseFloat(String(mapped.sale_price).replace(/[^0-9.]/g, ""))
            : null,
          transmission: mapped.transmission || null,
          fuel_type: mapped.fuel_type || null,
          body_type: mapped.body_type || null,
          notes: mapped.notes || null,
          source: "dealer",
          confidence: "high",
          days_to_clear: daysToCleer,
        });
      }

      if (!truthRows.length) {
        throw new Error(`No valid rows to import (${errors.length} errors)`);
      }

      // Insert into vehicle_sales_truth
      const { error: truthError } = await supabase
        .from("vehicle_sales_truth")
        .insert(truthRows);
      if (truthError) throw truthError;

      // Update batch status
      await supabase
        .from("upload_batches")
        .update({
          status: "imported",
          error_count: errors.length,
          error_report: errors.length ? errors : null,
          promoted_at: new Date().toISOString(),
          promoted_by: "josh",
        } as any)
        .eq("id", batch.id);

      // Save the mapping profile for future use
      const account = accounts?.find((a) => a.id === selectedAccountId);
      const profileName = currentFile?.name
        ? `Auto: ${currentFile.name.replace(/\.[^.]+$/, "")}`
        : `Auto: ${new Date().toISOString().slice(0, 10)}`;

      await saveProfile.mutateAsync({
        accountId: selectedAccountId,
        profileName,
        headerMap: currentMapping,
        sourceHeaders: parsedHeaders,
      });

      return { imported: truthRows.length, errors: errors.length };
    },
    onSuccess: ({ imported, errors }) => {
      queryClient.invalidateQueries({ queryKey: ["upload-batches"] });
      setStep("idle");
      setParsedHeaders([]);
      setParsedRows([]);
      setCurrentMapping({});
      setCurrentFile(null);

      if (errors > 0) {
        toast.warning(`Imported ${imported} records (${errors} rows skipped). Redirecting…`);
      } else {
        toast.success(`Imported ${imported} records. Here's what your history tells you.`);
      }
      setTimeout(() => navigate("/sales-insights"), 1500);
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const handleCancel = () => {
    setStep("idle");
    setParsedHeaders([]);
    setParsedRows([]);
    setCurrentMapping({});
    setCurrentFile(null);
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
              Import sales from any system — we'll handle the mapping
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

        {/* Step: Idle → Drop Zone */}
        {step === "idle" && (
          <FileDropZone
            onFileSelected={handleFileSelected}
            isProcessing={aiMapping.isPending}
          />
        )}

        {/* Step: Mapping → Header Editor */}
        {step === "mapping" && (
          <HeaderMappingEditor
            headers={parsedHeaders}
            mapping={currentMapping}
            sampleRow={parsedRows[0]}
            aiMethod={aiMethod}
            onMappingChange={setCurrentMapping}
            onConfirm={() => importMutation.mutate()}
            onCancel={handleCancel}
            isConfirming={importMutation.isPending}
          />
        )}

        {/* Saved profiles info */}
        {profiles && profiles.length > 0 && step === "idle" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            <span>
              {profiles.length} saved mapping{profiles.length !== 1 ? "s" : ""} — matching uploads will auto-map
            </span>
          </div>
        )}

        {/* Recent uploads */}
        <UploadBatchHistory batches={batches} isLoading={batchesLoading} />
      </div>
    </AppLayout>
  );
}
