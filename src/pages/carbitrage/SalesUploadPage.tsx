import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useAccounts } from "@/hooks/useAccounts";

interface UploadBatch {
  id: string;
  account_id: string;
  upload_type: string;
  filename: string | null;
  uploaded_by: string;
  status: string;
  row_count: number;
  error_count: number;
  error_report: any;
  promoted_at: string | null;
  promoted_by: string | null;
  created_at: string;
}

const EXPECTED_COLUMNS = [
  "dealer_name",
  "sale_date",
  "year",
  "make",
  "model",
  "variant",
  "km",
  "sale_price",
  "buy_price",
  "location",
  "notes",
];

export default function SalesUploadPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [dragActive, setDragActive] = useState(false);
  const queryClient = useQueryClient();

  // Set default account when loaded
  if (!selectedAccountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    if (mackay) setSelectedAccountId(mackay.id);
    else setSelectedAccountId(accounts[0].id);
  }

  const { data: batches, isLoading } = useQuery({
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
      return data as UploadBatch[];
    },
    enabled: !!selectedAccountId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) throw new Error("File must have at least a header and one data row");

      // Parse header
      const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
      
      // Validate required columns
      const missing = ["sale_date", "year", "make", "model"].filter(
        (col) => !header.includes(col)
      );
      if (missing.length) {
        throw new Error(`Missing required columns: ${missing.join(", ")}`);
      }

      // Create batch
      const { data: batch, error: batchError } = await supabase
        .from("upload_batches")
        .insert({
          account_id: selectedAccountId,
          upload_type: "sales_log",
          filename: file.name,
          uploaded_by: "josh",
          row_count: lines.length - 1,
        })
        .select()
        .single();

      if (batchError) throw batchError;

      // Parse and insert rows
      const rows: any[] = [];
      const errors: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map((v) => v.trim().replace(/['"]/g, ""));
        const row: Record<string, any> = {};
        header.forEach((col, idx) => {
          row[col] = values[idx] || null;
        });

        // Validate row
        const rowErrors: string[] = [];
        if (!row.sale_date) rowErrors.push("sale_date required");
        if (!row.year || isNaN(parseInt(row.year))) rowErrors.push("valid year required");
        if (!row.make) rowErrors.push("make required");
        if (!row.model) rowErrors.push("model required");

        rows.push({
          batch_id: batch.id,
          row_number: i,
          raw_data: row,
          is_valid: rowErrors.length === 0,
          validation_errors: rowErrors.length ? rowErrors : null,
        });

        if (rowErrors.length) {
          errors.push({ row: i, errors: rowErrors });
        }
      }

      // Insert rows
      const { error: rowsError } = await supabase.from("upload_rows_raw").insert(rows);
      if (rowsError) throw rowsError;

      // Update batch with error count
      if (errors.length) {
        await supabase
          .from("upload_batches")
          .update({
            error_count: errors.length,
            error_report: errors,
            status: errors.length === rows.length ? "error" : "validated",
          })
          .eq("id", batch.id);
      } else {
        await supabase
          .from("upload_batches")
          .update({ status: "validated" })
          .eq("id", batch.id);
      }

      return { batch, errors };
    },
    onSuccess: ({ batch, errors }) => {
      queryClient.invalidateQueries({ queryKey: ["upload-batches"] });
      if (errors.length) {
        toast.warning(`Uploaded with ${errors.length} validation errors`);
      } else {
        toast.success("Upload validated successfully");
      }
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async (batchId: string) => {
      // Get valid rows
      const { data: rows, error: rowsError } = await supabase
        .from("upload_rows_raw")
        .select("raw_data")
        .eq("batch_id", batchId)
        .eq("is_valid", true);

      if (rowsError) throw rowsError;
      if (!rows?.length) throw new Error("No valid rows to promote");

      // Get account for dealer_name fallback
      const account = accounts?.find((a) => a.id === selectedAccountId);

      // Insert into sales_log_stage
      const stageRows = rows.map((r: any) => ({
        batch_id: batchId,
        account_id: selectedAccountId,
        dealer_name: r.raw_data.dealer_name || account?.display_name || "Unknown",
        sale_date: r.raw_data.sale_date,
        year: parseInt(r.raw_data.year),
        make: r.raw_data.make,
        model: r.raw_data.model,
        variant: r.raw_data.variant || null,
        km: r.raw_data.km ? parseInt(r.raw_data.km) : null,
        sale_price: r.raw_data.sale_price ? parseFloat(r.raw_data.sale_price) : null,
        buy_price: r.raw_data.buy_price ? parseFloat(r.raw_data.buy_price) : null,
        location: r.raw_data.location || null,
        notes: r.raw_data.notes || null,
      }));

      const { error: stageError } = await supabase.from("sales_log_stage").insert(stageRows);
      if (stageError) throw stageError;

      // Update batch
      await supabase
        .from("upload_batches")
        .update({
          status: "promoted",
          promoted_at: new Date().toISOString(),
          promoted_by: "josh",
        })
        .eq("id", batchId);

      return rows.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["upload-batches"] });
      toast.success(`Promoted ${count} records to staging`);
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files?.[0]) {
        uploadMutation.mutate(e.dataTransfer.files[0]);
      }
    },
    [uploadMutation]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      uploadMutation.mutate(e.target.files[0]);
    }
  };

  const downloadTemplate = () => {
    const csv = EXPECTED_COLUMNS.join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sales_log_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { icon: React.ReactNode; className: string }> = {
      pending: {
        icon: null,
        className: "bg-muted text-muted-foreground",
      },
      validating: {
        icon: null,
        className: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      },
      validated: {
        icon: <CheckCircle className="h-3 w-3 mr-1" />,
        className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      },
      promoted: {
        icon: <ArrowRight className="h-3 w-3 mr-1" />,
        className: "bg-purple-500/10 text-purple-600 border-purple-500/20",
      },
      error: {
        icon: <XCircle className="h-3 w-3 mr-1" />,
        className: "bg-red-500/10 text-red-600 border-red-500/20",
      },
    };
    const style = styles[status] || styles.pending;
    return (
      <Badge className={style.className}>
        {style.icon}
        {status}
      </Badge>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileSpreadsheet className="h-6 w-6" />
              Sales Log Upload
            </h1>
            <p className="text-muted-foreground">
              Import dealer sales history for analysis
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

        {/* Upload Zone */}
        <Card
          className={`border-2 border-dashed transition-colors ${
            dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <CardContent className="py-12 flex flex-col items-center justify-center text-center">
            <Upload className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Drop CSV file here</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              or click to browse
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileInput}
              className="hidden"
              id="file-upload"
            />
            <Button asChild disabled={uploadMutation.isPending}>
              <label htmlFor="file-upload" className="cursor-pointer">
                {uploadMutation.isPending ? "Uploading..." : "Select File"}
              </label>
            </Button>
          </CardContent>
        </Card>

        {/* Recent Batches */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Uploads</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : !batches?.length ? (
              <p className="text-center text-muted-foreground py-8">
                No uploads yet. Upload a CSV to get started.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Errors</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="font-medium">
                        {batch.filename || "Unknown"}
                      </TableCell>
                      <TableCell>{getStatusBadge(batch.status)}</TableCell>
                      <TableCell>{batch.row_count}</TableCell>
                      <TableCell>
                        {batch.error_count > 0 ? (
                          <span className="text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {batch.error_count}
                          </span>
                        ) : (
                          <span className="text-emerald-600">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(batch.created_at), {
                          addSuffix: true,
                        })}
                      </TableCell>
                      <TableCell>
                        {batch.status === "validated" && (
                          <Button
                            size="sm"
                            onClick={() => promoteMutation.mutate(batch.id)}
                            disabled={promoteMutation.isPending}
                          >
                            <ArrowRight className="h-4 w-4 mr-1" />
                            Promote
                          </Button>
                        )}
                        {batch.status === "promoted" && (
                          <span className="text-xs text-muted-foreground">
                            Promoted by {batch.promoted_by}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
