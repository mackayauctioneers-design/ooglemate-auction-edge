import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, FileSpreadsheet, Upload, RefreshCw, Wrench, Loader2, Tags } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { PicklesCatalogueImport } from '@/components/lots/PicklesCatalogueImport';
import { LotCsvImport } from '@/components/lots/LotCsvImport';
import { LifecycleTest } from '@/components/lots/LifecycleTest';
import { dataService } from '@/services/dataService';
import { parsePicklesCatalogue } from '@/utils/picklesCatalogueParser';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';

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
