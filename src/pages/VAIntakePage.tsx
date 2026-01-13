import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminGuard } from '@/components/guards/AdminGuard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, XCircle, AlertCircle, RefreshCw, Download, FileWarning, FileDown, ExternalLink, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface VASource {
  id: string;
  source_key: string;
  display_name: string;
  location_hint: string | null;
  enabled: boolean;
}

interface UploadBatch {
  id: string;
  created_at: string;
  source_key: string;
  auction_date: string;
  file_name: string;
  file_path: string;
  file_type: string;
  status: string;
  rows_total: number;
  rows_accepted: number;
  rows_rejected: number;
  error: string | null;
  pdf_extract_notes: string | null;
}

interface UploadRow {
  id: string;
  row_number: number;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  km: number | null;
  status: string;
  rejection_reason: string | null;
}

// CSV template header row
const CSV_TEMPLATE_HEADER = 'lot_id,year,make,model,variant_raw,km,location,vin,stock_number,reserve,asking_price,fuel,transmission,listing_url,status';
const CSV_TEMPLATE_EXAMPLE = 'LOT001,2022,TOYOTA,HILUX,SR5 4X4,45000,Sydney,JTFSC5E1234567890,STK123,35000,38000,diesel,automatic,https://example.com/lot001,listed';

function openLink(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function VAIntakePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [file, setFile] = useState<File | null>(null);
  const [sourceKey, setSourceKey] = useState('');
  const [auctionDate, setAuctionDate] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [pdfNotes, setPdfNotes] = useState('');

  // Prefill from URL params (deep-link from blocked source tasks)
  useEffect(() => {
    const src = searchParams.get("source") || "";
    const date = searchParams.get("date") || "";
    const focus = searchParams.get("focus") || "";

    if (src) setSourceKey(src);
    if (date) setAuctionDate(date);

    // Focus file input when arriving from a task
    if (focus === "file") {
      setTimeout(() => {
        const el = document.getElementById("va-file-input") as HTMLInputElement | null;
        el?.focus();
        el?.click();
      }, 250);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch VA sources for dropdown
  const { data: sources } = useQuery({
    queryKey: ['va-sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('va_sources')
        .select('id, source_key, display_name, location_hint, enabled')
        .eq('enabled', true)
        .order('display_name');
      
      if (error) throw error;
      return data as VASource[];
    },
  });

  // Fetch recent batches
  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ['va-batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('va_upload_batches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data as UploadBatch[];
    },
  });

  // Fetch rows for selected batch
  const { data: batchRows, isLoading: rowsLoading } = useQuery({
    queryKey: ['va-batch-rows', selectedBatchId],
    queryFn: async () => {
      if (!selectedBatchId) return null;
      const { data, error } = await supabase
        .from('va_upload_rows')
        .select('id, row_number, year, make, model, variant_raw, km, status, rejection_reason')
        .eq('batch_id', selectedBatchId)
        .order('row_number')
        .limit(100);
      
      if (error) throw error;
      return data as UploadRow[];
    },
    enabled: !!selectedBatchId,
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file || !sourceKey || !auctionDate) {
        throw new Error('Missing required fields');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const formData = new FormData();
      formData.append('file', file);
      formData.append('source_key', sourceKey);
      formData.append('auction_date', auctionDate);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/va-auction-upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast.success('File uploaded successfully');
      setFile(null);
      setSelectedBatchId(data.batch_id);
      queryClient.invalidateQueries({ queryKey: ['va-batches'] });
    },
    onError: (error) => {
      toast.error(`Upload failed: ${error.message}`);
    },
  });

  // Parse mutation
  const parseMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/va-auction-parse`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ batch_id: batchId }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Parse failed');
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success('File parsed successfully');
      queryClient.invalidateQueries({ queryKey: ['va-batches'] });
      queryClient.invalidateQueries({ queryKey: ['va-batch-rows'] });
    },
    onError: (error) => {
      toast.error(`Parse failed: ${error.message}`);
    },
  });

  // Ingest mutation
  const ingestMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/va-auction-ingest`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ batch_id: batchId }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Ingest failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast.success(`Ingestion complete: ${data.summary.accepted} accepted, ${data.summary.rejected} rejected`);
      queryClient.invalidateQueries({ queryKey: ['va-batches'] });
      queryClient.invalidateQueries({ queryKey: ['va-batch-rows'] });
    },
    onError: (error) => {
      toast.error(`Ingest failed: ${error.message}`);
    },
  });

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  }, []);

  // Download PDF helper
  const handleDownloadPdf = async (batch: UploadBatch) => {
    try {
      const { data, error } = await supabase.storage
        .from('va-auction-uploads')
        .createSignedUrl(batch.file_path, 60);

      if (error) throw error;
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    } catch (err) {
      toast.error('Failed to get download link');
    }
  };

  // Download CSV template
  const handleDownloadTemplate = () => {
    const csvContent = `${CSV_TEMPLATE_HEADER}\n${CSV_TEMPLATE_EXAMPLE}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'va_auction_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="secondary">Pending</Badge>;
      case 'parsing': return <Badge variant="outline" className="text-blue-600">Parsing...</Badge>;
      case 'parsed': return <Badge variant="outline" className="text-yellow-600">Ready to Ingest</Badge>;
      case 'ingesting': return <Badge variant="outline" className="text-blue-600">Ingesting...</Badge>;
      case 'completed': return <Badge className="bg-green-600">Completed</Badge>;
      case 'failed': return <Badge variant="destructive">Failed</Badge>;
      case 'received_pdf': return <Badge variant="outline" className="text-orange-600"><FileWarning className="h-3 w-3 mr-1" />PDF Received</Badge>;
      case 'pending_manual_extract': return <Badge variant="outline" className="text-orange-600">Manual Extract</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getRowStatusIcon = (status: string) => {
    switch (status) {
      case 'accepted': return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'rejected': return <XCircle className="h-4 w-4 text-red-600" />;
      default: return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const isPdfBatch = (batch: UploadBatch) => 
    batch.status === 'received_pdf' || batch.file_type === 'pdf';

  // Build deep link to upload CSV for a PDF batch
  const buildCsvUploadLink = (batch: UploadBatch) => {
    const params = new URLSearchParams({
      source: batch.source_key,
      date: batch.auction_date,
      focus: "file",
    });
    return `/admin-tools/va-intake?${params.toString()}`;
  };

  // Get selected batch object
  const selectedBatch = batches?.find(b => b.id === selectedBatchId);

  // Update pdfNotes when selecting a batch
  useEffect(() => {
    if (selectedBatch) {
      setPdfNotes(selectedBatch.pdf_extract_notes || '');
    }
  }, [selectedBatch?.id]);

  return (
    <AdminGuard>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">VA Auction Intake</h1>
            <p className="text-muted-foreground">Upload and process auction catalogue files</p>
          </div>
          <Button variant="outline" onClick={handleDownloadTemplate}>
            <FileDown className="h-4 w-4 mr-2" />
            Download Template CSV
          </Button>
        </div>

        {/* Instructions Card */}
        <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-800 dark:text-blue-200">Daily Job (10 minutes)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-blue-700 dark:text-blue-300">
            <ol className="list-decimal list-inside space-y-1">
              <li>Pick <strong>Source</strong> from dropdown</li>
              <li>Pick <strong>Auction date</strong> (today)</li>
              <li>Upload file: <strong>CSV</strong> (best), <strong>XLSX</strong> (OK), or <strong>PDF</strong> (archive only)</li>
              <li>For CSV/XLSX: Click <strong>Parse</strong> → check rejected count → Click <strong>Ingest</strong></li>
              <li>For PDF: Download, convert to CSV, then upload CSV with same Source + Date</li>
            </ol>
          </CardContent>
        </Card>

        {/* PDF → CSV Conversion Playbook */}
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              PDF → CSV (when scraping is blocked)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <ol className="list-decimal pl-5 space-y-2">
              <li>Download the auction catalogue PDF from the source site.</li>
              <li>Convert to <strong>CSV</strong> (best) or <strong>XLSX</strong> (ok) using one of the tools below.</li>
              <li>Open the file and confirm columns exist: <strong>year, make, model, km</strong> at minimum.</li>
              <li>Upload the CSV here with the same <strong>Source</strong> + <strong>Auction Date</strong>.</li>
              <li>Click <strong>Parse</strong> → check rejects → click <strong>Ingest</strong>.</li>
            </ol>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openLink("https://www.adobe.com/acrobat/online/pdf-to-excel.html")}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Adobe PDF→Excel
                <ExternalLink className="h-4 w-4 ml-2" />
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => openLink("https://smallpdf.com/pdf-to-excel")}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Smallpdf
                <ExternalLink className="h-4 w-4 ml-2" />
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => openLink("https://www.ilovepdf.com/pdf_to_excel")}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                iLovePDF
                <ExternalLink className="h-4 w-4 ml-2" />
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
              >
                <FileText className="h-4 w-4 mr-2" />
                Download template CSV
              </Button>
            </div>

            <div className="rounded-md border border-border/60 bg-muted/30 p-3">
              <strong>Rules:</strong> 10-year window ({new Date().getFullYear() - 10}+) is enforced. 
              Cars with older year will be rejected automatically after parse.
            </div>
          </CardContent>
        </Card>

        {/* Upload Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Catalogue
            </CardTitle>
            <CardDescription>
              CSV/XLSX files are parsed automatically. PDFs are stored for manual conversion.
              10-year window enforced (rows with year &lt; {new Date().getFullYear() - 10} rejected).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="source_key">Source</Label>
                <Select value={sourceKey} onValueChange={setSourceKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select auction source..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sources?.map((source) => (
                      <SelectItem key={source.source_key} value={source.source_key}>
                        {source.display_name}
                        {source.location_hint && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            ({source.location_hint})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Allow typing source key for blocked sources not in va_sources */}
                <Input
                  placeholder="Or type source key (for blocked sources)"
                  value={sourceKey}
                  onChange={(e) => setSourceKey(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="auction_date">Auction Date</Label>
                <Input
                  id="auction_date"
                  type="date"
                  value={auctionDate}
                  onChange={(e) => setAuctionDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="va-file-input">File</Label>
                <Input
                  id="va-file-input"
                  type="file"
                  accept=".csv,.xlsx,.xls,.pdf"
                  onChange={handleFileChange}
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => uploadMutation.mutate()}
                  disabled={!file || !sourceKey || !auctionDate || uploadMutation.isPending}
                  className="w-full"
                >
                  {uploadMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Upload
                </Button>
              </div>
            </div>
            {file && (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" />
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Batches */}
        <Card>
          <CardHeader>
            <CardTitle>Last 10 VA Uploads</CardTitle>
          </CardHeader>
          <CardContent>
            {batchesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : batches && batches.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Auction Date</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">Accepted</TableHead>
                    <TableHead className="text-right">Rejected</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => (
                    <TableRow 
                      key={batch.id}
                      className={selectedBatchId === batch.id ? 'bg-muted/50' : ''}
                    >
                      <TableCell>{format(new Date(batch.created_at), 'MMM d, HH:mm')}</TableCell>
                      <TableCell className="font-mono text-sm">{batch.source_key}</TableCell>
                      <TableCell>{batch.auction_date}</TableCell>
                      <TableCell className="max-w-32 truncate">{batch.file_name}</TableCell>
                      <TableCell>{getStatusBadge(batch.status)}</TableCell>
                      <TableCell className="text-right">{batch.rows_total}</TableCell>
                      <TableCell className="text-right text-green-600">{batch.rows_accepted}</TableCell>
                      <TableCell className="text-right text-red-600">{batch.rows_rejected}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {isPdfBatch(batch) ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDownloadPdf(batch)}
                              >
                                <Download className="h-3 w-3 mr-1" />
                                Download PDF
                              </Button>
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => navigate(buildCsvUploadLink(batch))}
                              >
                                <Upload className="h-3 w-3 mr-1" />
                                Upload CSV
                              </Button>
                            </>
                          ) : (
                            <>
                              {batch.status === 'pending' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => parseMutation.mutate(batch.id)}
                                  disabled={parseMutation.isPending}
                                >
                                  {parseMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Parse'}
                                </Button>
                              )}
                              {batch.status === 'parsed' && (
                                <Button
                                  size="sm"
                                  onClick={() => ingestMutation.mutate(batch.id)}
                                  disabled={ingestMutation.isPending}
                                >
                                  {ingestMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Ingest'}
                                </Button>
                              )}
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedBatchId(batch.id === selectedBatchId ? null : batch.id)}
                          >
                            {selectedBatchId === batch.id ? 'Hide' : 'View'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-8">No uploads yet</p>
            )}
          </CardContent>
        </Card>

        {/* Batch Row Details */}
        {selectedBatchId && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Batch Row Details</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['va-batch-rows', selectedBatchId] })}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </CardTitle>
              <CardDescription>First 100 rows shown</CardDescription>
            </CardHeader>
            <CardContent>
              {rowsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : batchRows && batchRows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead className="w-12">Status</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>Make</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-right">KM</TableHead>
                      <TableHead>Rejection Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchRows.map((row) => (
                      <TableRow key={row.id} className={row.status === 'rejected' ? 'bg-red-50 dark:bg-red-950/20' : ''}>
                        <TableCell className="font-mono text-xs">{row.row_number}</TableCell>
                        <TableCell>{getRowStatusIcon(row.status)}</TableCell>
                        <TableCell>{row.year || '-'}</TableCell>
                        <TableCell>{row.make || '-'}</TableCell>
                        <TableCell>{row.model || '-'}</TableCell>
                        <TableCell className="max-w-32 truncate">{row.variant_raw || '-'}</TableCell>
                        <TableCell className="text-right">{row.km?.toLocaleString() || '-'}</TableCell>
                        <TableCell>
                          {row.rejection_reason && (
                            <Badge variant="outline" className="text-red-600 text-xs">
                              {row.rejection_reason}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No rows to display (PDF files require manual conversion)
                </p>
              )}

              {/* PDF Extract Notes section for PDF batches */}
              {selectedBatch && isPdfBatch(selectedBatch) && (
                <div className="mt-6 pt-4 border-t space-y-3">
                  <Label>PDF Extract Notes</Label>
                  <Textarea
                    value={pdfNotes}
                    onChange={(e) => setPdfNotes(e.target.value)}
                    rows={2}
                    placeholder="e.g. pages 2-5 contain cars; kms column labelled 'Odometer'"
                    className="text-sm"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      await supabase
                        .from("va_upload_batches")
                        .update({ pdf_extract_notes: pdfNotes })
                        .eq("id", selectedBatch.id);
                      toast.success("Notes saved");
                      queryClient.invalidateQueries({ queryKey: ['va-batches'] });
                    }}
                  >
                    Save notes
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AdminGuard>
  );
}