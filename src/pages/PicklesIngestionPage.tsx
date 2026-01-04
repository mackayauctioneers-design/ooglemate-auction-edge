import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, Play, RefreshCw, Bell, FileText, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { 
  runPicklesIngestion, 
  runPicklesAlerts, 
  getIngestionRuns, 
  getVehicleListings,
  getFingerprints,
  getAlerts,
  type IngestionRun,
  type VehicleListing,
  type DealerFingerprint,
  type AlertLog
} from '@/services/picklesIngestionService';

export default function PicklesIngestionPage() {

  const [catalogueText, setCatalogueText] = useState('');
  const [eventId, setEventId] = useState('');
  const [auctionDate, setAuctionDate] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [isProcessingAlerts, setIsProcessingAlerts] = useState(false);
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [listings, setListings] = useState<VehicleListing[]>([]);
  const [fingerprints, setFingerprints] = useState<DealerFingerprint[]>([]);
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    try {
      const [runsData, listingsData, fpData, alertsData] = await Promise.all([
        getIngestionRuns(10),
        getVehicleListings({ source: 'pickles' }),
        getFingerprints(),
        getAlerts('Dave')
      ]);
      setRuns(runsData);
      setListings(listingsData);
      setFingerprints(fpData);
      setAlerts(alertsData);
    } catch (e) {
      console.error('Failed to load data:', e);
      toast.error('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleIngest() {
    if (!catalogueText || !eventId || !auctionDate) {
      toast.error('Please fill in all fields');
      return;
    }

    setIsIngesting(true);
    try {
      const result = await runPicklesIngestion(catalogueText, eventId, auctionDate);
      if (result.success) {
        toast.success(`Ingested ${result.lotsFound} lots (${result.created} new, ${result.updated} updated)`);
        loadData();
      } else {
        toast.error(result.error || 'Ingestion failed');
      }
    } catch (e) {
      toast.error('Ingestion failed');
    } finally {
      setIsIngesting(false);
    }
  }

  async function handleProcessAlerts() {
    setIsProcessingAlerts(true);
    try {
      const result = await runPicklesAlerts('UPCOMING');
      if (result.success) {
        toast.success(`Created ${result.alertsCreated} alerts (${result.alertsSkipped} skipped)`);
        loadData();
      } else {
        toast.error(result.error || 'Alert processing failed');
      }
    } catch (e) {
      toast.error('Alert processing failed');
    } finally {
      setIsProcessingAlerts(false);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-AU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'success':
        return <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Success</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      case 'running':
        return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
      case 'partial':
        return <Badge variant="outline" className="border-orange-500 text-orange-600"><AlertTriangle className="h-3 w-3 mr-1" />Partial</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pickles Ingestion</h1>
          <p className="text-muted-foreground">Ingest Pickles catalogue data and process fingerprint alerts</p>
        </div>
        <Button variant="outline" onClick={loadData} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="ingest" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ingest">Ingestion</TabsTrigger>
          <TabsTrigger value="listings">Listings ({listings.length})</TabsTrigger>
          <TabsTrigger value="fingerprints">Fingerprints ({fingerprints.length})</TabsTrigger>
          <TabsTrigger value="alerts">Alerts ({alerts.length})</TabsTrigger>
          <TabsTrigger value="runs">Run History</TabsTrigger>
        </TabsList>

        <TabsContent value="ingest" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Catalogue Ingestion
                </CardTitle>
                <CardDescription>
                  Paste Pickles catalogue content (from PDF/DOCX) to ingest lots
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="eventId">Event ID</Label>
                    <Input
                      id="eventId"
                      placeholder="e.g., 12931"
                      value={eventId}
                      onChange={(e) => setEventId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="auctionDate">Auction Date</Label>
                    <Input
                      id="auctionDate"
                      type="date"
                      value={auctionDate}
                      onChange={(e) => setAuctionDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="catalogue">Catalogue Content</Label>
                  <Textarea
                    id="catalogue"
                    placeholder="Paste the catalogue markdown/text here..."
                    className="min-h-[200px] font-mono text-sm"
                    value={catalogueText}
                    onChange={(e) => setCatalogueText(e.target.value)}
                  />
                </div>
                <Button 
                  onClick={handleIngest} 
                  disabled={isIngesting || !catalogueText || !eventId || !auctionDate}
                  className="w-full"
                >
                  {isIngesting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Ingesting...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" />Run Ingestion</>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Alert Processing
                </CardTitle>
                <CardDescription>
                  Match ingested lots against dealer fingerprints and create alerts
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <p className="text-sm font-medium">Current Test Dealer: Dave</p>
                  <p className="text-sm text-muted-foreground">
                    Active fingerprints will be matched against Pickles listings
                  </p>
                </div>
                
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Active Fingerprints for Dave:</h4>
                  {fingerprints.filter(f => f.dealer_name === 'Dave').map(fp => (
                    <div key={fp.id} className="p-3 border rounded-lg text-sm">
                      <div className="font-medium">{fp.make} {fp.model}</div>
                      <div className="text-muted-foreground">
                        Variant: {fp.variant_family || 'Any'} | Years: {fp.year_min}-{fp.year_max}
                        {fp.is_spec_only && <Badge variant="outline" className="ml-2">Spec-Only</Badge>}
                      </div>
                    </div>
                  ))}
                  {fingerprints.filter(f => f.dealer_name === 'Dave').length === 0 && (
                    <p className="text-sm text-muted-foreground">No active fingerprints for Dave</p>
                  )}
                </div>

                <Button 
                  onClick={handleProcessAlerts} 
                  disabled={isProcessingAlerts}
                  variant="secondary"
                  className="w-full"
                >
                  {isProcessingAlerts ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                  ) : (
                    <><Bell className="h-4 w-4 mr-2" />Process UPCOMING Alerts</>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="listings">
          <Card>
            <CardHeader>
              <CardTitle>Pickles Listings</CardTitle>
              <CardDescription>Vehicle listings ingested from Pickles catalogues</CardDescription>
            </CardHeader>
            <CardContent>
              {listings.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No listings yet. Run an ingestion to populate.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lot</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Auction</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listings.map((lot) => (
                      <TableRow key={lot.id}>
                        <TableCell className="font-mono">{lot.lot_id}</TableCell>
                        <TableCell className="font-medium">{lot.make} {lot.model}</TableCell>
                        <TableCell>{lot.year}</TableCell>
                        <TableCell>{lot.variant_family || lot.variant_raw || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={lot.status === 'catalogue' ? 'default' : 'secondary'}>
                            {lot.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{lot.location || '-'}</TableCell>
                        <TableCell>{formatDate(lot.auction_datetime)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fingerprints">
          <Card>
            <CardHeader>
              <CardTitle>Dealer Fingerprints</CardTitle>
              <CardDescription>Active fingerprints for matching</CardDescription>
            </CardHeader>
            <CardContent>
              {fingerprints.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No active fingerprints</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dealer</TableHead>
                      <TableHead>Make</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead>Years</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fingerprints.map((fp) => (
                      <TableRow key={fp.id}>
                        <TableCell className="font-medium">{fp.dealer_name}</TableCell>
                        <TableCell>{fp.make}</TableCell>
                        <TableCell>{fp.model}</TableCell>
                        <TableCell>{fp.variant_family || 'Any'}</TableCell>
                        <TableCell>{fp.year_min}–{fp.year_max}</TableCell>
                        <TableCell>
                          <Badge variant={fp.is_spec_only ? 'outline' : 'default'}>
                            {fp.is_spec_only ? 'Spec-Only' : 'Full'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={fp.is_active ? 'default' : 'secondary'}>
                            {fp.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>Alert Log (Dave)</CardTitle>
              <CardDescription>Recent alerts generated for Dave from fingerprint matches</CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No alerts yet. Process alerts after ingestion.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.map((alert) => (
                      <TableRow key={alert.id}>
                        <TableCell>{formatDate(alert.created_at)}</TableCell>
                        <TableCell>
                          <Badge variant={alert.alert_type === 'UPCOMING' ? 'default' : 'secondary'}>
                            {alert.alert_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {alert.lot_year} {alert.lot_make} {alert.lot_model} {alert.lot_variant}
                        </TableCell>
                        <TableCell>{alert.location || '-'}</TableCell>
                        <TableCell className="max-w-[300px] truncate">{alert.message_text}</TableCell>
                        <TableCell>
                          <Badge variant={alert.status === 'new' ? 'destructive' : 'outline'}>
                            {alert.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs">
          <Card>
            <CardHeader>
              <CardTitle>Ingestion Run History</CardTitle>
              <CardDescription>Recent ingestion jobs and their results</CardDescription>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No ingestion runs yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Lots Found</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Errors</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>{formatDate(run.started_at)}</TableCell>
                        <TableCell>{run.source}</TableCell>
                        <TableCell>{getStatusBadge(run.status)}</TableCell>
                        <TableCell>{run.lots_found}</TableCell>
                        <TableCell>{run.lots_created}</TableCell>
                        <TableCell>{run.lots_updated}</TableCell>
                        <TableCell>
                          {run.errors?.length > 0 ? (
                            <Badge variant="destructive">{run.errors.length}</Badge>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
