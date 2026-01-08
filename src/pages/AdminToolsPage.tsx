import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, FileSpreadsheet, Upload, RefreshCw, Wrench, Loader2, Tags, Database, Car, FileDown, Globe, UserPlus, BarChart3 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { PicklesCatalogueImport } from '@/components/lots/PicklesCatalogueImport';
import { LotCsvImport } from '@/components/lots/LotCsvImport';
import { LifecycleTest } from '@/components/lots/LifecycleTest';
import { dataService } from '@/services/dataService';
import { parsePicklesCatalogue } from '@/utils/picklesCatalogueParser';
import { ingestMackayTradersSales } from '@/utils/ingestMackayTradersSales';
import { toast } from 'sonner';
import { Navigate, Link } from 'react-router-dom';
import { DealerOnboarding } from '@/components/admin/DealerOnboarding';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function AdminToolsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  
  const [showPicklesImport, setShowPicklesImport] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showLifecycleTest, setShowLifecycleTest] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isImporting12931, setIsImporting12931] = useState(false);
  const [isBackfillingFamily, setIsBackfillingFamily] = useState(false);
  const [backfillStats, setBackfillStats] = useState<{ fingerprintsWithFamily: number; lotsWithFamily: number } | null>(null);
  const [isFixingKm, setIsFixingKm] = useState(false);
  const [kmFixStats, setKmFixStats] = useState<{ fingerprintsFixed: number; fullFingerprints: number; specOnlyFingerprints: number } | null>(null);
  const [isBackfillingStatus, setIsBackfillingStatus] = useState(false);
  const [statusBackfillStats, setStatusBackfillStats] = useState<{ lotsUpdated: number; lotsSkipped: number } | null>(null);
  const [isBackfillingMakeModel, setIsBackfillingMakeModel] = useState(false);
  const [makeModelStats, setMakeModelStats] = useState<{ 
    salesUpdated: number; 
    salesSkipped: number; 
    unresolved: Array<{ saleId: string; make: string; model: string }>;
  } | null>(null);
  const [isIngestingMackay, setIsIngestingMackay] = useState(false);
  const [mackayStats, setMackayStats] = useState<{ parsed: number; stored: number } | null>(null);
  const [latestReport, setLatestReport] = useState<{ report_date: string; report_json: Record<string, unknown> } | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [showReportJson, setShowReportJson] = useState(false);

  // Fetch latest feeding mode report
  const fetchLatestReport = async () => {
    setIsLoadingReport(true);
    try {
      const { data, error } = await supabase
        .from('feeding_mode_reports')
        .select('report_date, report_json')
        .order('report_date', { ascending: false })
        .limit(1)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        setLatestReport(data as { report_date: string; report_json: Record<string, unknown> });
      }
    } catch (error) {
      console.error('Failed to fetch report:', error);
    } finally {
      setIsLoadingReport(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchLatestReport();
    }
  }, [isAdmin]);

  const handleImportCatalogue12931 = async () => {
    setIsImporting12931(true);
    try {
      const response = await fetch('/pickles-catalogue-12931.txt');
      const rawText = await response.text();
      
      const eventId = '12931';
      const auctionDate = '2026-01-04';
      
      // Use the dedicated parser
      const parsedLots = parsePicklesCatalogue(rawText, eventId, auctionDate);
      
      if (parsedLots.length === 0) {
        toast.error('No lots parsed from catalogue');
        return;
      }
      
      const lots = parsedLots.map(p => p.lot);
      const result = await dataService.upsertLots(lots);
      toast.success(`Imported ${result.added} new, updated ${result.updated} lots from catalogue 12931`);
      queryClient.invalidateQueries({ queryKey: ['auctionLots'] });
      queryClient.invalidateQueries({ queryKey: ['lotFilterOptions'] });
    } catch (error) {
      toast.error('Failed to import catalogue: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsImporting12931(false);
    }
  };

  // Redirect non-admins
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const handleDataChanged = () => {
    queryClient.invalidateQueries({ queryKey: ['auctionLots'] });
    queryClient.invalidateQueries({ queryKey: ['lotFilterOptions'] });
    setShowPicklesImport(false);
    setShowCsvImport(false);
  };

  const handleRebuildSearchIndex = async () => {
    setIsRebuilding(true);
    try {
      // Invalidate all lot-related queries to force a fresh fetch
      await queryClient.invalidateQueries({ queryKey: ['auctionLots'] });
      await queryClient.invalidateQueries({ queryKey: ['lotFilterOptions'] });
      await queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      await queryClient.invalidateQueries({ queryKey: ['matches'] });
      toast.success('Search index rebuilt successfully');
    } catch (error) {
      toast.error('Failed to rebuild search index');
    } finally {
      setIsRebuilding(false);
    }
  };

  const handleBackfillVariantFamily = async () => {
    setIsBackfillingFamily(true);
    try {
      const result = await dataService.backfillVariantFamily();
      toast.success(
        `Variant family backfill complete: ${result.fingerprintsUpdated} fingerprints updated, ${result.lotsUpdated} lots updated`
      );
      // Refresh matches after backfill
      await queryClient.invalidateQueries({ queryKey: ['matches'] });
      await queryClient.invalidateQueries({ queryKey: ['auctionLots'] });
      
      // Verify persistence by re-reading data and counting variant_family
      const [fingerprints, lots] = await Promise.all([
        dataService.getFingerprints(),
        dataService.getLots(true),
      ]);
      const fingerprintsWithFamily = fingerprints.filter(fp => fp.variant_family).length;
      const lotsWithFamily = lots.filter(l => l.variant_family).length;
      setBackfillStats({ fingerprintsWithFamily, lotsWithFamily });
      
      if (fingerprintsWithFamily === 0 && lotsWithFamily === 0 && (result.fingerprintsUpdated > 0 || result.lotsUpdated > 0)) {
        toast.warning('Backfill reported updates but verification shows 0 records with variant_family. Check sheet headers.');
      }
    } catch (error) {
      toast.error('Failed to backfill variant family: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsBackfillingFamily(false);
    }
  };

  const handleFixSpecOnlyKm = async () => {
    setIsFixingKm(true);
    try {
      const result = await dataService.fixSpecOnlyKm();
      toast.success(
        `KM fix complete: ${result.fingerprintsFixed} fingerprints corrected`
      );
      // Refresh matches after fix
      await queryClient.invalidateQueries({ queryKey: ['matches'] });
      await queryClient.invalidateQueries({ queryKey: ['fingerprints'] });
      
      // Verify by re-reading fingerprints and counting types
      const fingerprints = await dataService.getFingerprints();
      const fullFingerprints = fingerprints.filter(fp => 
        fp.fingerprint_type !== 'spec_only' && 
        fp.sale_km && 
        fp.min_km !== null && fp.min_km !== undefined &&
        fp.max_km !== null && fp.max_km !== undefined
      ).length;
      const specOnlyFingerprints = fingerprints.filter(fp => 
        fp.fingerprint_type === 'spec_only' || 
        !fp.sale_km || 
        fp.min_km === null || fp.min_km === undefined ||
        fp.max_km === null || fp.max_km === undefined
      ).length;
      
      setKmFixStats({ 
        fingerprintsFixed: result.fingerprintsFixed,
        fullFingerprints, 
        specOnlyFingerprints 
      });
    } catch (error) {
      toast.error('Failed to fix spec-only KM: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsFixingKm(false);
    }
  };

  const handleBackfillPicklesStatus = async () => {
    setIsBackfillingStatus(true);
    try {
      const result = await dataService.backfillPicklesStatus();
      toast.success(
        `Status backfill complete: ${result.lotsUpdated} lots normalized`
      );
      setStatusBackfillStats(result);
      
      // Auto-trigger rebuild search index after backfill
      await handleRebuildSearchIndex();
      
    } catch (error) {
      toast.error('Failed to backfill Pickles status: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsBackfillingStatus(false);
    }
  };

  const handleBackfillMakeModel = async () => {
    setIsBackfillingMakeModel(true);
    try {
      const result = await dataService.backfillSalesMakeModel();
      toast.success(
        `Make/Model backfill complete: ${result.salesUpdated} sales normalized`
      );
      setMakeModelStats(result);
      
      // Refresh sales data
      await queryClient.invalidateQueries({ queryKey: ['salesNormalised'] });
      await queryClient.invalidateQueries({ queryKey: ['matches'] });
      
    } catch (error) {
      toast.error('Failed to backfill make/model: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsBackfillingMakeModel(false);
    }
  };

  const handleIngestMackayTraders = async () => {
    setIsIngestingMackay(true);
    try {
      const result = await ingestMackayTradersSales();
      if (result.errors.length > 0) {
        toast.error('Ingestion failed: ' + result.errors.join(', '));
      } else {
        toast.success(`Ingested ${result.parsed} sales from Mackay Traders, stored ${result.stored} records`);
        setMackayStats({ parsed: result.parsed, stored: result.stored });
      }
    } catch (error) {
      toast.error('Failed to ingest: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsIngestingMackay(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Wrench className="h-6 w-6" />
            Admin Tools
          </h1>
          <p className="text-sm text-muted-foreground">
            Administrative utilities for data management and testing
          </p>
        </div>

        {/* Tool Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Dealer Onboarding - First card */}
          <DealerOnboarding />
          {/* Pickles Catalogue Import */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                Pickles Catalogue Import
              </CardTitle>
              <CardDescription>
                Import lots from Pickles catalogue files (.docx, .xlsx, .csv, .txt)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => setShowPicklesImport(true)}
                className="w-full gap-2"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Open Pickles Importer
              </Button>
            </CardContent>
          </Card>

          {/* CSV Import */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Upload className="h-5 w-5 text-primary" />
                Lots CSV Import
              </CardTitle>
              <CardDescription>
                Generic CSV import for auction lots data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => setShowCsvImport(true)}
                variant="outline"
                className="w-full gap-2"
              >
                <Upload className="h-4 w-4" />
                Open CSV Importer
              </Button>
            </CardContent>
          </Card>

          {/* Lifecycle Test */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FlaskConical className="h-5 w-5 text-primary" />
                Lifecycle Test
              </CardTitle>
              <CardDescription>
                Run automated lifecycle tests on test lot data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => setShowLifecycleTest(true)}
                variant="outline"
                className="w-full gap-2"
              >
                <FlaskConical className="h-4 w-4" />
                Run Lifecycle Test
              </Button>
            </CardContent>
          </Card>

          {/* Rebuild Search Index */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <RefreshCw className="h-5 w-5 text-primary" />
                Rebuild Search Index
              </CardTitle>
              <CardDescription>
                Force refresh all cached lot data and filter options
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={handleRebuildSearchIndex}
                variant="outline"
                className="w-full gap-2"
                disabled={isRebuilding}
              >
                <RefreshCw className={`h-4 w-4 ${isRebuilding ? 'animate-spin' : ''}`} />
                {isRebuilding ? 'Rebuilding...' : 'Rebuild Search Index'}
              </Button>
            </CardContent>
          </Card>

          {/* Quick Import Catalogue 12931 */}
          <Card className="border-primary/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                Import Catalogue 12931
              </CardTitle>
              <CardDescription>
                One-click import of the pre-loaded Pickles catalogue (48 pages)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={handleImportCatalogue12931}
                className="w-full gap-2"
                disabled={isImporting12931}
              >
                {isImporting12931 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isImporting12931 ? 'Importing...' : 'Import 12931 Now'}
              </Button>
            </CardContent>
          </Card>

          {/* Backfill Variant Family */}
          <Card className="border-blue-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Tags className="h-5 w-5 text-blue-500" />
                Backfill Variant Family
              </CardTitle>
              <CardDescription>
                Derive variant_family (SR5, GXL, XLT, etc.) for fingerprints and listings to enable Tier-2 matching
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                onClick={handleBackfillVariantFamily}
                className="w-full gap-2"
                variant="outline"
                disabled={isBackfillingFamily}
              >
                {isBackfillingFamily ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tags className="h-4 w-4" />}
                {isBackfillingFamily ? 'Backfilling...' : 'Backfill Variant Family'}
              </Button>
              {backfillStats && (
                <div className="text-xs text-muted-foreground border rounded p-2 bg-muted/50">
                  <div>Fingerprints with variant_family: <span className="font-medium">{backfillStats.fingerprintsWithFamily}</span></div>
                  <div>Lots with variant_family: <span className="font-medium">{backfillStats.lotsWithFamily}</span></div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Fix Spec-Only KM */}
          <Card className="border-amber-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Wrench className="h-5 w-5 text-amber-500" />
                Fix KM for Spec-Only
              </CardTitle>
              <CardDescription>
                Clear placeholder KM ranges (≥900k) from fingerprints without source KM data. Sets fingerprint_type to spec_only.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                onClick={handleFixSpecOnlyKm}
                className="w-full gap-2"
                variant="outline"
                disabled={isFixingKm}
              >
                {isFixingKm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                {isFixingKm ? 'Fixing...' : 'Fix KM for Spec-Only Fingerprints'}
              </Button>
              {kmFixStats && (
                <div className="text-xs text-muted-foreground border rounded p-2 bg-muted/50">
                  <div>Fingerprints fixed: <span className="font-medium text-amber-500">{kmFixStats.fingerprintsFixed}</span></div>
                  <div className="mt-1 pt-1 border-t">
                    <div>Full fingerprints (KM enforced): <span className="font-medium text-emerald-500">{kmFixStats.fullFingerprints}</span></div>
                    <div>Spec-only fingerprints (KM ignored): <span className="font-medium text-amber-500">{kmFixStats.specOnlyFingerprints}</span></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Backfill Pickles Status */}
          <Card className="border-green-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5 text-green-500" />
                Backfill Pickles Status
              </CardTitle>
              <CardDescription>
                Normalize numeric status codes (0, 2) to string statuses (catalogue, passed_in) for Pickles lots
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                onClick={handleBackfillPicklesStatus}
                className="w-full gap-2"
                variant="outline"
                disabled={isBackfillingStatus}
              >
                {isBackfillingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                {isBackfillingStatus ? 'Normalizing...' : 'Backfill Pickles Status'}
              </Button>
              {statusBackfillStats && (
                <div className="text-xs text-muted-foreground border rounded p-2 bg-muted/50">
                  <div>Lots normalized: <span className="font-medium text-green-500">{statusBackfillStats.lotsUpdated}</span></div>
                  <div>Lots skipped: <span className="font-medium">{statusBackfillStats.lotsSkipped}</span></div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Backfill Sales Make/Model */}
          <Card className="border-orange-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Car className="h-5 w-5 text-orange-500" />
                Backfill Sales Make/Model
              </CardTitle>
              <CardDescription>
                Resolve numeric DMS IDs (e.g. 2438) to text labels (e.g. Toyota) for existing sales
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                onClick={handleBackfillMakeModel}
                className="w-full gap-2"
                variant="outline"
                disabled={isBackfillingMakeModel}
              >
                {isBackfillingMakeModel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Car className="h-4 w-4" />}
                {isBackfillingMakeModel ? 'Normalizing...' : 'Backfill Make/Model'}
              </Button>
              {makeModelStats && (
                <div className="text-xs text-muted-foreground border rounded p-2 bg-muted/50">
                  <div>Sales normalized: <span className="font-medium text-orange-500">{makeModelStats.salesUpdated}</span></div>
                  <div>Sales skipped: <span className="font-medium">{makeModelStats.salesSkipped}</span></div>
                  {makeModelStats.unresolved.length > 0 && (
                    <div className="mt-1 pt-1 border-t">
                      <div className="text-amber-500">Unresolved IDs ({makeModelStats.unresolved.length}):</div>
                      {makeModelStats.unresolved.slice(0, 5).map((u, i) => (
                        <div key={i} className="text-xs">Make: {u.make}, Model: {u.model}</div>
                      ))}
                      {makeModelStats.unresolved.length > 5 && (
                        <div className="text-xs">...and {makeModelStats.unresolved.length - 5} more</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ingest Mackay Traders Sales */}
          <Card className="border-purple-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileDown className="h-5 w-5 text-purple-500" />
                Ingest Mackay Traders
              </CardTitle>
              <CardDescription>
                Parse and store sales from StockSoldReport PDF into Dealer_Sales_History
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                onClick={handleIngestMackayTraders}
                className="w-full gap-2"
                variant="outline"
                disabled={isIngestingMackay}
              >
                {isIngestingMackay ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {isIngestingMackay ? 'Ingesting...' : 'Ingest Mackay Traders PDF'}
              </Button>
              {mackayStats && (
                <div className="text-xs text-muted-foreground border rounded p-2 bg-muted/50">
                  <div>Sales parsed: <span className="font-medium text-purple-500">{mackayStats.parsed}</span></div>
                  <div>Records stored: <span className="font-medium text-green-500">{mackayStats.stored}</span></div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pickles Ingestion Page Link */}
          <Card className="border-cyan-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Globe className="h-5 w-5 text-cyan-500" />
                Pickles Pagination Crawl
              </CardTitle>
              <CardDescription>
                Full crawler with run history, HTML snapshots, and status monitoring
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/pickles-ingestion">
                <Button className="w-full gap-2" variant="outline">
                  <Globe className="h-4 w-4" />
                  Open Pickles Ingestion
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Feeding Mode Report Viewer */}
          <Card className="border-indigo-500/50 md:col-span-2 lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="h-5 w-5 text-indigo-500" />
                Feeding Mode Report
              </CardTitle>
              <CardDescription>
                Daily 14-day summary of market activity (scheduled 10:45am AEST)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button 
                  onClick={fetchLatestReport}
                  variant="outline"
                  disabled={isLoadingReport}
                  className="gap-2"
                >
                  {isLoadingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </Button>
                {latestReport && (
                  <Button 
                    onClick={() => setShowReportJson(!showReportJson)}
                    variant="outline"
                    className="gap-2"
                  >
                    {showReportJson ? 'Hide JSON' : 'Show JSON'}
                  </Button>
                )}
              </div>
              
              {latestReport ? (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    Latest report: <span className="font-medium text-foreground">{latestReport.report_date}</span>
                  </div>
                  
                  {/* Quick stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2 bg-muted rounded">
                      <div className="text-muted-foreground">Top Fingerprints</div>
                      <div className="font-medium text-lg">{(latestReport.report_json?.top_fingerprints as unknown[])?.length || 0}</div>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <div className="text-muted-foreground">Clearances</div>
                      <div className="font-medium text-lg">{(latestReport.report_json?.health_summary as Record<string, number>)?.clearances_recorded || 0}</div>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <div className="text-muted-foreground">Snapshots</div>
                      <div className="font-medium text-lg">{(latestReport.report_json?.health_summary as Record<string, number>)?.snapshots_created || 0}</div>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <div className="text-muted-foreground">Ingestion Rate</div>
                      <div className="font-medium text-lg">{(latestReport.report_json?.health_summary as Record<string, number>)?.ingestion_rate || 0}%</div>
                    </div>
                  </div>
                  
                  {showReportJson && (
                    <ScrollArea className="h-[400px] border rounded p-2 bg-muted/30">
                      <pre className="text-xs whitespace-pre-wrap break-all">
                        {JSON.stringify(latestReport.report_json, null, 2)}
                      </pre>
                    </ScrollArea>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {isLoadingReport ? 'Loading...' : 'No report found. First report will be stored at 10:45am AEST.'}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Pickles Catalogue Import Dialog */}
        {showPicklesImport && (
          <PicklesCatalogueImport
            onClose={() => setShowPicklesImport(false)}
            onImported={handleDataChanged}
          />
        )}

        {/* CSV Import Dialog */}
        {showCsvImport && (
          <LotCsvImport
            onClose={() => setShowCsvImport(false)}
            onImported={handleDataChanged}
          />
        )}

        {/* Lifecycle Test Dialog */}
        <LifecycleTest
          open={showLifecycleTest}
          onOpenChange={setShowLifecycleTest}
          onComplete={handleDataChanged}
        />
      </div>
    </AppLayout>
  );
}
