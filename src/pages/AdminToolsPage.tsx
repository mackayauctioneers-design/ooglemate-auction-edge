import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, FileSpreadsheet, Upload, RefreshCw, Wrench, Loader2 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { PicklesCatalogueImport } from '@/components/lots/PicklesCatalogueImport';
import { LotCsvImport } from '@/components/lots/LotCsvImport';
import { LifecycleTest } from '@/components/lots/LifecycleTest';
import { dataService } from '@/services/dataService';
import { Listing, shouldExcludeListing } from '@/types';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';

// Parse lot entry from PDF table format
function parsePdfLotEntry(text: string, eventId: string, auctionDate: string): Partial<Listing> | null {
  try {
    const tableMatch = text.match(/^\|\s*(\d+)\s*\|\s*CP:\s*(\d{2}\/\d{4})/);
    if (!tableMatch) return null;

    const lotNumber = tableMatch[1];
    const compDate = tableMatch[2];
    const yearMatch = compDate.match(/(\d{2})\/(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[2]) : new Date().getFullYear();
    
    const restOfText = text.replace(/^\|\s*\d+\s*\|\s*/, '');
    const parts = restOfText.split(',').map(p => p.trim());
    
    let makeModelIdx = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].match(/^CP:/i)) {
        makeModelIdx = i + 1;
        break;
      }
    }

    const make = parts[makeModelIdx] || '';
    const model = parts[makeModelIdx + 1] || '';
    const variant_raw = parts[makeModelIdx + 2] || '';

    let transmission = '', engine = '', fuel = '', km = 0, colour = '', location = '', drivetrain = '';

    for (let i = makeModelIdx + 3; i < parts.length; i++) {
      const part = parts[i];
      if (part.match(/automatic|manual|cvt|dct/i) && !transmission) {
        transmission = part.match(/auto/i) ? 'Auto' : part.match(/manual/i) ? 'Manual' : part;
      } else if (part.match(/^\d+\.?\d*\s*Ltr$/i) && !engine) {
        engine = part;
      } else if (part.match(/Diesel|Petrol|Electric|Hybrid/i) && !fuel) {
        fuel = part.match(/diesel/i) ? 'Diesel' : part.match(/petrol/i) ? 'Petrol' : part;
      } else if (part.match(/\d+\s*\(Kms/i) && !km) {
        const kmMatch = part.match(/(\d+)\s*\(Kms/);
        if (kmMatch) km = parseInt(kmMatch[1].replace(/,/g, ''));
      } else if (part.match(/^Colour:\s*/i) && !colour) {
        colour = part.replace(/^Colour:\s*/i, '');
      } else if (part.match(/\b(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b/i) && !location) {
        const stateMatch = part.match(/([A-Za-z\s]+),?\s*(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)/i);
        location = stateMatch ? stateMatch[0].trim() : part.trim();
      } else if (part.match(/4WD|AWD|2WD|RWD|FWD/i) && !drivetrain) {
        drivetrain = part.match(/4WD/i) ? '4WD' : part.match(/AWD/i) ? 'AWD' : part;
      }
    }

    const now = new Date().toISOString();
    const lot_key = `Pickles:${lotNumber}`;

    return {
      listing_id: lot_key, lot_id: lotNumber, lot_key, listing_key: lot_key,
      source: 'auction', source_site: 'Pickles', source_type: 'auction', source_name: 'Pickles Catalogue',
      event_id: eventId, auction_house: 'Pickles', location, auction_datetime: auctionDate,
      listing_url: '', make, model, variant_raw, variant_normalised: variant_raw, year, km, fuel,
      drivetrain, transmission, reserve: 0, highest_bid: 0, first_seen_price: 0, last_seen_price: 0,
      price_current: 0, price_prev: 0, price_change_pct: 0, status: 'listed', pass_count: 0,
      price_drop_count: 0, relist_count: 0, first_seen_at: now, last_seen_at: now,
      last_auction_date: auctionDate, days_listed: 0, description_score: 2, estimated_get_out: 0,
      estimated_margin: 0, confidence_score: 0, action: 'Watch', visible_to_dealers: 'Y',
      updated_at: now, last_status: 'listed', relist_group_id: '', override_enabled: 'N', invalid_source: 'N',
    };
  } catch {
    return null;
  }
}

export default function AdminToolsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  
  const [showPicklesImport, setShowPicklesImport] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showLifecycleTest, setShowLifecycleTest] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isImporting12931, setIsImporting12931] = useState(false);

  const handleImportCatalogue12931 = async () => {
    setIsImporting12931(true);
    try {
      const response = await fetch('/pickles-catalogue-12931.txt');
      const rawText = await response.text();
      
      const eventId = '12931';
      const auctionDate = '2026-01-04';
      
      const tableRowPattern = /\|\s*(\d+)\s*\|\s*(CP:[^|]+)\|/g;
      const lots: Partial<Listing>[] = [];
      let match: RegExpExecArray | null;
      
      while ((match = tableRowPattern.exec(rawText)) !== null) {
        const lotNumber = match[1];
        const description = match[2].trim();
        const lotText = `| ${lotNumber} | ${description}`;
        const parsed = parsePdfLotEntry(lotText, eventId, auctionDate);
        if (parsed) {
          const exclusionCheck = shouldExcludeListing(parsed, description);
          if (exclusionCheck.excluded) {
            parsed.excluded_reason = 'condition_risk';
            parsed.excluded_keyword = exclusionCheck.keyword;
            parsed.visible_to_dealers = 'N';
          }
          lots.push(parsed);
        }
      }
      
      if (lots.length === 0) {
        toast.error('No lots parsed from catalogue');
        return;
      }
      
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
