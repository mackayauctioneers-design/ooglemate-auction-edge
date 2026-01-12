import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AdminGuard } from '@/components/guards/AdminGuard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, XCircle, AlertCircle, RefreshCw, Download, FileWarning } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

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

export default function VAIntakePage() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sourceKey, setSourceKey] = useState('');
  const [auctionDate, setAuctionDate] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

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
        .createSignedUrl(batch.file_path, 60); // 60 second expiry

      if (error) throw error;
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    } catch (err) {
      toast.error('Failed to get download link');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="secondary">Pending</Badge>;
      case 'parsing': return <Badge variant="outline" className="text-blue-600">Parsing...</Badge>;
      case 'parsed': return <Badge variant="outline" className="text-yellow-600">Ready to Ingest</Badge>;
      case 'ingesting': return <Badge variant="outline" className="text-blue-600">Ingesting...</Badge>;
      case 'completed': return <Badge className="bg-green-600">Completed</Badge>;
      case 'failed': return <Badge variant="destructive">Failed</Badge>;
      case 'received_pdf': return <Badge variant="outline" className="text-orange-600"><FileWarning className="h-3 w-3 mr-1" />PDF (convert)</Badge>;
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

  return (
    <AdminGuard>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">VA Auction Intake</h1>
            <p className="text-muted-foreground">Upload and process auction catalogue files</p>
          </div>
        </div>

        {/* Upload Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Catalogue
            </CardTitle>
            <CardDescription>
              Upload CSV, XLSX, or PDF files. 10-year window enforced. Row-level rejection applies.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="source_key">Source Key</Label>
                <Input
                  id="source_key"
                  placeholder="e.g., pickles_sydney"
                  value={sourceKey}
                  onChange={(e) => setSourceKey(e.target.value)}
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
                <Label htmlFor="file">File</Label>
                <Input
                  id="file"
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
                          {/* PDF: Show download only, no Parse/Ingest */}
                          {(batch.status === 'received_pdf' || batch.file_type === 'pdf') ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownloadPdf(batch)}
                            >
                              <Download className="h-3 w-3 mr-1" />
                              Download
                            </Button>
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
                        <TableCell className="text-red-600 text-sm">{row.rejection_reason || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-8">No rows to display</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AdminGuard>
  );
}
