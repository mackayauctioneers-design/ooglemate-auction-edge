import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Upload, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  FileSpreadsheet,
  Plus,
  ChevronRight,
  Database
} from "lucide-react";
import { OperatorGuard } from "@/components/guards/OperatorGuard";

// Types
type VASalesTask = {
  id: string;
  dealer_id: string;
  dealer_name: string;
  task_type: string;
  status: string;
  priority: number;
  last_data_received_at: string | null;
  days_since_data: number | null;
  expected_frequency: string;
  next_due_at: string | null;
  is_overdue: boolean;
  assigned_to: string | null;
  notes: string | null;
  computed_priority: number;
};

type ImportMapping = {
  dealer_id: string;
  dealer_name: string | null;
  column_map: Record<string, string>;
};

type ParsedRow = Record<string, string | number | null>;

// Target fields for mapping
const TARGET_FIELDS = [
  { key: "sold_date", label: "Sold Date", required: true },
  { key: "year", label: "Year", required: true },
  { key: "make", label: "Make", required: true },
  { key: "model", label: "Model", required: true },
  { key: "variant_raw", label: "Variant", required: false },
  { key: "km", label: "KM", required: false },
  { key: "buy_price", label: "Buy Price", required: false },
  { key: "sell_price", label: "Sell Price", required: false },
  { key: "state", label: "State", required: false },
  { key: "source_channel", label: "Source Channel", required: false },
];

export default function VASalesDataPage() {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("queue");
  
  // Queue state
  const [tasks, setTasks] = useState<VASalesTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  
  // Import state
  const [selectedDealer, setSelectedDealer] = useState<string | null>(null);
  const [selectedDealerName, setSelectedDealerName] = useState<string>("");
  const [rawText, setRawText] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({});
  const [savedMappings, setSavedMappings] = useState<ImportMapping | null>(null);
  const [importing, setImporting] = useState(false);
  const [dealers, setDealers] = useState<{id: string; name: string}[]>([]);

  // Load task queue
  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_va_sales_task_queue");
      if (error) throw error;
      setTasks((data as VASalesTask[]) || []);
    } catch (e) {
      console.error("Failed to load tasks:", e);
      toast.error("Failed to load task queue");
    } finally {
      setTasksLoading(false);
    }
  }, []);

  // Load dealer profiles for dropdown
  const loadDealers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("dealer_profiles")
        .select("id, dealer_name")
        .order("dealer_name");
      if (error) throw error;
      setDealers((data || []).map(d => ({ id: d.id, name: d.dealer_name })));
    } catch (e) {
      console.error("Failed to load dealers:", e);
    }
  }, []);

  // Load saved mappings for a dealer
  const loadMappings = useCallback(async (dealerId: string) => {
    try {
      const { data, error } = await supabase
        .from("sales_import_mappings")
        .select("*")
        .eq("dealer_id", dealerId)
        .single();
      
      if (error && error.code !== "PGRST116") throw error;
      
      if (data) {
        setSavedMappings({
          dealer_id: data.dealer_id,
          dealer_name: data.dealer_name,
          column_map: (data.column_map as Record<string, string>) || {}
        });
        setColumnMappings((data.column_map as Record<string, string>) || {});
      } else {
        setSavedMappings(null);
        setColumnMappings({});
      }
    } catch (e) {
      console.error("Failed to load mappings:", e);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    loadDealers();
  }, [loadTasks, loadDealers]);

  useEffect(() => {
    if (selectedDealer) {
      loadMappings(selectedDealer);
    }
  }, [selectedDealer, loadMappings]);

  // Parse CSV/TSV text
  const parseText = useCallback((text: string) => {
    if (!text.trim()) {
      setParsedRows([]);
      setSourceColumns([]);
      return;
    }

    const lines = text.trim().split("\n");
    if (lines.length < 2) {
      toast.error("Need at least header row + 1 data row");
      return;
    }

    // Detect delimiter
    const delimiter = lines[0].includes("\t") ? "\t" : ",";
    const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));
    
    setSourceColumns(headers);

    const rows: ParsedRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ""));
      if (values.length === 0 || (values.length === 1 && !values[0])) continue;
      
      const row: ParsedRow = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || null;
      });
      rows.push(row);
    }

    setParsedRows(rows);
    
    // Auto-map if we have saved mappings
    if (savedMappings?.column_map) {
      setColumnMappings(savedMappings.column_map);
    } else {
      // Try auto-detection
      const autoMap: Record<string, string> = {};
      headers.forEach(h => {
        const lower = h.toLowerCase();
        if (lower.includes("date") && lower.includes("sold")) autoMap[h] = "sold_date";
        else if (lower === "year" || lower.includes("vehicle year")) autoMap[h] = "year";
        else if (lower === "make" || lower.includes("vehicle make")) autoMap[h] = "make";
        else if (lower === "model" || lower.includes("vehicle model")) autoMap[h] = "model";
        else if (lower.includes("variant") || lower.includes("trim") || lower.includes("badge")) autoMap[h] = "variant_raw";
        else if (lower === "km" || lower.includes("odometer") || lower.includes("kms")) autoMap[h] = "km";
        else if (lower.includes("buy") && lower.includes("price")) autoMap[h] = "buy_price";
        else if (lower.includes("sell") || lower.includes("sale price") || lower === "price") autoMap[h] = "sell_price";
        else if (lower === "state" || lower.includes("region")) autoMap[h] = "state";
        else if (lower.includes("source") || lower.includes("channel")) autoMap[h] = "source_channel";
      });
      setColumnMappings(autoMap);
    }

    toast.success(`Parsed ${rows.length} rows`);
  }, [savedMappings]);

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setRawText(text);
      parseText(text);
    };
    reader.readAsText(file);
  }, [parseText]);

  // Transform row using mappings
  const transformRow = useCallback((row: ParsedRow): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    
    Object.entries(columnMappings).forEach(([sourceCol, targetField]) => {
      if (!targetField || targetField === "ignore") return;
      
      let value = row[sourceCol];
      
      // Type conversions
      if (targetField === "year" || targetField === "km") {
        const num = parseInt(String(value).replace(/[^0-9]/g, ""), 10);
        value = isNaN(num) ? null : num;
      } else if (targetField === "buy_price" || targetField === "sell_price") {
        const num = parseFloat(String(value).replace(/[^0-9.]/g, ""));
        value = isNaN(num) ? null : num;
      } else if (targetField === "sold_date" && value) {
        // Try to parse date
        const d = new Date(String(value));
        if (!isNaN(d.getTime())) {
          value = d.toISOString().slice(0, 10);
        }
      }
      
      result[targetField] = value;
    });
    
    return result;
  }, [columnMappings]);

  // Preview transformed data
  const previewRows = useMemo(() => {
    return parsedRows.slice(0, 20).map(transformRow);
  }, [parsedRows, transformRow]);

  // Validation
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    const requiredFields = TARGET_FIELDS.filter(f => f.required).map(f => f.key);
    const mappedFields = new Set(Object.values(columnMappings).filter(v => v && v !== "ignore"));
    
    requiredFields.forEach(field => {
      if (!mappedFields.has(field)) {
        errors.push(`Missing required mapping: ${field}`);
      }
    });
    
    if (parsedRows.length === 0) {
      errors.push("No data rows to import");
    }
    
    if (!selectedDealer) {
      errors.push("Select a dealer");
    }
    
    return errors;
  }, [columnMappings, parsedRows, selectedDealer]);

  // Import data
  const handleImport = useCallback(async () => {
    if (validationErrors.length > 0) {
      toast.error(validationErrors[0]);
      return;
    }
    
    setImporting(true);
    try {
      // Save mappings for this dealer
      const { error: mappingError } = await supabase
        .from("sales_import_mappings")
        .upsert({
          dealer_id: selectedDealer!,
          dealer_name: selectedDealerName,
          column_map: columnMappings,
          last_used_at: new Date().toISOString()
        }, { onConflict: "dealer_id" });
      
      if (mappingError) console.error("Failed to save mappings:", mappingError);

      // Create batch record
      const { data: batch, error: batchError } = await supabase
        .from("sales_import_batches")
        .insert({
          dealer_id: selectedDealer!,
          dealer_name: selectedDealerName,
          source_type: "VA",
          row_count: parsedRows.length,
          status: "processing"
        })
        .select()
        .single();
      
      if (batchError) throw batchError;

      // Transform and insert rows
      let imported = 0;
      let rejected = 0;
      const errors: string[] = [];

      for (const row of parsedRows) {
        try {
          const transformed = transformRow(row);
          
          // Generate fingerprint
          const { data: fpData } = await supabase.rpc("generate_sale_fingerprint", {
            p_year: transformed.year as number,
            p_make: transformed.make as string,
            p_model: transformed.model as string,
            p_variant_raw: transformed.variant_raw as string || null,
            p_km: transformed.km as number || null,
            p_region_id: null
          });

          const fp = fpData?.[0];

          const { error: insertError } = await supabase
            .from("dealer_sales")
            .insert([{
              dealer_id: selectedDealer!,
              dealer_name: selectedDealerName,
              sold_date: transformed.sold_date as string,
              year: transformed.year as number,
              make: transformed.make as string,
              model: transformed.model as string,
              variant_raw: transformed.variant_raw as string | null,
              km: transformed.km as number | null,
              buy_price: transformed.buy_price as number | null,
              sell_price: transformed.sell_price as number | null,
              state: transformed.state as string | null,
              source_channel: transformed.source_channel as string | null,
              data_source: "VA" as const,
              import_batch_id: batch.id,
              fingerprint: fp?.fingerprint || null,
              fingerprint_confidence: fp?.confidence || null
            }]);
          if (insertError) {
            rejected++;
            errors.push(`Row error: ${insertError.message}`);
          } else {
            imported++;
          }
        } catch (e) {
          rejected++;
          errors.push(`Row error: ${e}`);
        }
      }

      // Update batch
      await supabase
        .from("sales_import_batches")
        .update({
          status: "complete",
          imported_count: imported,
          rejected_count: rejected,
          error_message: errors.length > 0 ? errors.slice(0, 5).join("; ") : null,
          completed_at: new Date().toISOString()
        })
        .eq("id", batch.id);

      toast.success(`Imported ${imported} sales, ${rejected} rejected`);
      
      // Clear form
      setRawText("");
      setParsedRows([]);
      setSourceColumns([]);
      
    } catch (e) {
      console.error("Import failed:", e);
      toast.error("Import failed: " + String(e));
    } finally {
      setImporting(false);
    }
  }, [validationErrors, selectedDealer, selectedDealerName, columnMappings, parsedRows, transformRow]);

  // Create task for dealer
  const createTaskForDealer = useCallback(async (dealerId: string, dealerName: string) => {
    try {
      const { error } = await supabase
        .from("va_sales_tasks")
        .insert({
          dealer_id: dealerId,
          dealer_name: dealerName,
          task_type: "REQUEST_SALES_DATA",
          status: "pending",
          priority: 50,
          expected_frequency: "monthly"
        });
      
      if (error) throw error;
      toast.success(`Task created for ${dealerName}`);
      loadTasks();
    } catch (e) {
      toast.error("Failed to create task: " + String(e));
    }
  }, [loadTasks]);

  // Start import for a task
  const startImportForTask = useCallback((task: VASalesTask) => {
    setSelectedDealer(task.dealer_id);
    setSelectedDealerName(task.dealer_name);
    setActiveTab("import");
  }, []);

  return (
    <OperatorGuard>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">VA Sales Data</h1>
            <p className="text-muted-foreground">
              Request, import, and manage dealer sales data for fingerprinting
            </p>
          </div>
          <Button variant="outline" onClick={loadTasks} disabled={tasksLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${tasksLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="queue">
              <Clock className="h-4 w-4 mr-2" />
              Task Queue
            </TabsTrigger>
            <TabsTrigger value="import">
              <Upload className="h-4 w-4 mr-2" />
              Import Data
            </TabsTrigger>
            <TabsTrigger value="stale">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Stale Dealers
            </TabsTrigger>
          </TabsList>

          {/* Task Queue Tab */}
          <TabsContent value="queue" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Sales Data Request Queue</CardTitle>
                    <CardDescription>
                      Tasks for chasing and importing dealer sales reports
                    </CardDescription>
                  </div>
                  <Button onClick={() => setActiveTab("import")}>
                    <Plus className="h-4 w-4 mr-2" />
                    New Import
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {tasksLoading ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : tasks.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No pending tasks</p>
                    <p className="text-sm">Create a task or import data directly</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tasks.map(task => (
                      <div
                        key={task.id}
                        className={`flex items-center justify-between p-4 border rounded-lg ${
                          task.is_overdue ? "border-destructive/50 bg-destructive/5" : ""
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{task.dealer_name}</span>
                            <Badge variant={task.is_overdue ? "destructive" : "secondary"}>
                              {task.status}
                            </Badge>
                            <Badge variant="outline">{task.expected_frequency}</Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {task.days_since_data !== null 
                              ? `${task.days_since_data} days since last data`
                              : "No data on file"
                            }
                            {task.notes && ` • ${task.notes}`}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startImportForTask(task)}
                        >
                          Import Data
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Import Tab */}
          <TabsContent value="import" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Left: Input */}
              <Card>
                <CardHeader>
                  <CardTitle>Upload Sales Data</CardTitle>
                  <CardDescription>
                    Paste CSV/Excel data or upload a file. Accepts messy DMS exports.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Dealer</Label>
                    <Select
                      value={selectedDealer || ""}
                      onValueChange={(v) => {
                        setSelectedDealer(v);
                        const d = dealers.find(d => d.id === v);
                        setSelectedDealerName(d?.name || "");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select dealer..." />
                      </SelectTrigger>
                      <SelectContent>
                        {dealers.map(d => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Upload File</Label>
                    <Input
                      type="file"
                      accept=".csv,.tsv,.txt"
                      onChange={handleFileUpload}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Or Paste Data</Label>
                    <Textarea
                      value={rawText}
                      onChange={(e) => {
                        setRawText(e.target.value);
                        parseText(e.target.value);
                      }}
                      placeholder="Paste CSV or tab-separated data here..."
                      rows={8}
                      className="font-mono text-xs"
                    />
                  </div>

                  {parsedRows.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileSpreadsheet className="h-4 w-4" />
                      {parsedRows.length} rows, {sourceColumns.length} columns
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Right: Mapping */}
              <Card>
                <CardHeader>
                  <CardTitle>Column Mapping</CardTitle>
                  <CardDescription>
                    Map source columns to target fields
                    {savedMappings && (
                      <Badge variant="secondary" className="ml-2">
                        Saved mapping loaded
                      </Badge>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {sourceColumns.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Upload className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>Upload or paste data to configure mapping</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[300px]">
                      <div className="space-y-3">
                        {sourceColumns.map(col => (
                          <div key={col} className="flex items-center gap-3">
                            <div className="w-1/2 text-sm font-mono truncate" title={col}>
                              {col}
                            </div>
                            <Select
                              value={columnMappings[col] || "ignore"}
                              onValueChange={(v) => setColumnMappings(prev => ({
                                ...prev,
                                [col]: v
                              }))}
                            >
                              <SelectTrigger className="w-1/2">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ignore">— Ignore —</SelectItem>
                                {TARGET_FIELDS.map(f => (
                                  <SelectItem key={f.key} value={f.key}>
                                    {f.label} {f.required && "*"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Preview */}
            {previewRows.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Preview (first 20 rows)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="w-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {TARGET_FIELDS.filter(f => 
                            Object.values(columnMappings).includes(f.key)
                          ).map(f => (
                            <TableHead key={f.key}>{f.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewRows.map((row, i) => (
                          <TableRow key={i}>
                            {TARGET_FIELDS.filter(f => 
                              Object.values(columnMappings).includes(f.key)
                            ).map(f => (
                              <TableCell key={f.key} className="text-sm">
                                {String(row[f.key] ?? "—")}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Validation & Import */}
            {parsedRows.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      {validationErrors.length > 0 ? (
                        <div className="flex items-center gap-2 text-destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <span>{validationErrors[0]}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="h-4 w-4" />
                          <span>Ready to import {parsedRows.length} rows</span>
                        </div>
                      )}
                    </div>
                    <Button
                      onClick={handleImport}
                      disabled={validationErrors.length > 0 || importing}
                      size="lg"
                    >
                      {importing ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Import {parsedRows.length} Sales
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Stale Dealers Tab */}
          <TabsContent value="stale">
            <StaleDealersPanel onCreateTask={createTaskForDealer} />
          </TabsContent>
        </Tabs>
      </div>
    </OperatorGuard>
  );
}

// Stale dealers component
function StaleDealersPanel({ onCreateTask }: { onCreateTask: (id: string, name: string) => void }) {
  const [dealers, setDealers] = useState<{
    dealer_id: string;
    dealer_name: string;
    last_sale_date: string;
    days_stale: number;
    total_sales: number;
    has_active_task: boolean;
  }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc("get_stale_dealers", { p_days_threshold: 90 });
        if (error) throw error;
        setDealers(data || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (dealers.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
          <p>All dealers have recent data (within 90 days)</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Stale Dealers ({dealers.length})
        </CardTitle>
        <CardDescription>
          Dealers with no sales data in 90+ days
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {dealers.map(d => (
            <div
              key={d.dealer_id}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div>
                <div className="font-medium">{d.dealer_name}</div>
                <div className="text-sm text-muted-foreground">
                  {d.days_stale} days stale • {d.total_sales} total sales
                  {d.last_sale_date && ` • Last: ${d.last_sale_date}`}
                </div>
              </div>
              {d.has_active_task ? (
                <Badge variant="secondary">Task exists</Badge>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCreateTask(d.dealer_id, d.dealer_name)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create Task
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
