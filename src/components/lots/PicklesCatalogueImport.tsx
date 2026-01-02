import { useState } from 'react';
import { Loader2, AlertCircle, CheckCircle, FileSpreadsheet } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dataService } from '@/services/dataService';
import { Listing } from '@/types';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface PicklesCatalogueImportProps {
  onClose: () => void;
  onImported: () => void;
}

// Parse compliance date to year (MM/YYYY -> YYYY)
function complianceDateToYear(compDate: string): number {
  const match = compDate.match(/(\d{2})\/(\d{4})/);
  if (match) return parseInt(match[2]);
  return new Date().getFullYear();
}

// Parse a single lot entry from catalogue text
function parseLotEntry(text: string, eventId: string, auctionDate: string): Partial<Listing> | null {
  try {
    const parts = text.split(',').map(p => p.trim());
    if (parts.length < 5) return null;

    // First part: "N CP: MM/YYYY"
    const firstPart = parts[0];
    const lotMatch = firstPart.match(/^(\d+)\s+CP:\s*(\d{2}\/\d{4})/);
    if (!lotMatch) return null;

    const lotNumber = lotMatch[1];
    const complianceDate = lotMatch[2];
    const year = complianceDateToYear(complianceDate);

    // Core fields
    const make = parts[1] || '';
    const model = parts[2] || '';
    const variant_raw = parts[3] || '';

    // Optional fields - scan remaining parts
    let transmission = '';
    let engine = '';
    let fuel = '';
    let km = 0;
    let colour = '';
    let location = '';

    for (let i = 4; i < parts.length; i++) {
      const part = parts[i];
      
      if (part.match(/automatic|manual|cvt|dct/i) && !transmission) {
        transmission = part.match(/auto/i) ? 'Auto' : part.match(/manual/i) ? 'Manual' : part;
      }
      else if (part.match(/^\d+\.?\d*\s*Ltr$/i) && !engine) {
        engine = part;
      }
      else if (part.match(/Diesel|Petrol|Electric|Hybrid/i) && !fuel) {
        fuel = part;
      }
      else if (part.match(/\d+\s*\(Kms/i) && !km) {
        const kmMatch = part.match(/(\d+)\s*\(Kms/);
        if (kmMatch) km = parseInt(kmMatch[1].replace(/,/g, ''));
      }
      else if (part.match(/^Colour:\s*/i) && !colour) {
        colour = part.replace(/^Colour:\s*/i, '');
      }
      else if (part.match(/\b(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b/i) && !location) {
        location = part;
      }
    }

    const now = new Date().toISOString();
    const lot_key = `Pickles:${lotNumber}`;

    // Standard Listing structure - use existing upsertLots logic
    return {
      listing_id: lot_key,
      lot_id: lotNumber,
      lot_key,
      listing_key: lot_key,
      source: 'auction',
      source_site: 'Pickles',
      source_type: 'auction',
      source_name: 'Pickles Catalogue',
      event_id: eventId,
      auction_house: 'Pickles',
      location,
      auction_datetime: auctionDate,
      listing_url: '',
      make,
      model,
      variant_raw,
      variant_normalised: variant_raw,
      year,
      km,
      fuel,
      drivetrain: '',
      transmission,
      reserve: 0,
      highest_bid: 0,
      first_seen_price: 0,
      last_seen_price: 0,
      price_current: 0,
      price_prev: 0,
      price_change_pct: 0,
      status: 'listed',
      pass_count: 0,
      price_drop_count: 0,
      relist_count: 0,
      first_seen_at: now,
      last_seen_at: now,
      last_auction_date: auctionDate,
      days_listed: 0,
      description_score: 2,
      estimated_get_out: 0,
      estimated_margin: 0,
      confidence_score: 0,
      action: 'Watch',
      visible_to_dealers: 'Y',
      updated_at: now,
      last_status: 'listed',
      relist_group_id: '',
      override_enabled: 'N',
      invalid_source: 'Y',
    };
  } catch {
    return null;
  }
}

// Parse full catalogue text into lot entries
function parseCatalogue(rawText: string, eventId: string, auctionDate: string): Partial<Listing>[] {
  const lots: Partial<Listing>[] = [];
  const lotPattern = /(\d+)\s+CP:/g;
  const matches: { index: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = lotPattern.exec(rawText)) !== null) {
    matches.push({ index: match.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const startIdx = matches[i].index;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
    const lotText = rawText.substring(startIdx, endIdx);
    const parsed = parseLotEntry(lotText, eventId, auctionDate);
    if (parsed) lots.push(parsed);
  }

  return lots;
}

export function PicklesCatalogueImport({ onClose, onImported }: PicklesCatalogueImportProps) {
  const [rawText, setRawText] = useState('');
  const [eventId, setEventId] = useState('');
  const [auctionDate, setAuctionDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isImporting, setIsImporting] = useState(false);
  const [parsedLots, setParsedLots] = useState<Partial<Listing>[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setResult(null);
    setParsedLots([]);

    try {
      const text = await file.text();
      setRawText(text);
      const eventMatch = file.name.match(/(\d{4,})/);
      if (eventMatch) setEventId(eventMatch[1]);
    } catch {
      setError('Failed to read file');
    }
  };

  const handlePreview = () => {
    setError('');
    setResult(null);

    if (!rawText.trim()) {
      setError('No file content');
      return;
    }

    const lots = parseCatalogue(rawText, eventId, auctionDate);
    if (lots.length === 0) {
      setError('No valid lots found');
      return;
    }
    setParsedLots(lots);
  };

  const handleImport = async () => {
    if (parsedLots.length === 0 || !eventId.trim()) return;

    setIsImporting(true);
    setError('');

    try {
      // Use standard upsertLots - respects lot_key uniqueness, pass_count, lifecycle
      const result = await dataService.upsertLots(parsedLots);
      setResult(result);
      toast({
        title: 'Import complete',
        description: `Added ${result.added}, updated ${result.updated} lots.`,
      });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Pickles Catalogue
          </DialogTitle>
          <DialogDescription>
            Upload catalogue file. Lots will be added to Auction_Lots and become eligible for matching.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Catalogue File</Label>
            <Input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={handleFileUpload} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Event ID</Label>
              <Input value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="12931" />
            </div>
            <div className="space-y-2">
              <Label>Auction Date</Label>
              <Input type="date" value={auctionDate} onChange={(e) => setAuctionDate(e.target.value)} />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert className="border-emerald-600">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <AlertDescription>Added {result.added}, updated {result.updated} lots.</AlertDescription>
            </Alert>
          )}

          {parsedLots.length > 0 && !result && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{parsedLots.length} lots to import</p>
              <div className="max-h-40 overflow-y-auto border rounded-lg p-2 text-xs space-y-1">
                {parsedLots.slice(0, 10).map((lot, i) => (
                  <div key={i} className="flex gap-2 py-1 border-b border-border/50 last:border-0">
                    <span className="font-mono text-muted-foreground w-8">#{lot.lot_id}</span>
                    <span className="font-medium">{lot.make} {lot.model}</span>
                    <span className="text-muted-foreground">{lot.year}</span>
                    {lot.km ? <span className="text-muted-foreground ml-auto">{lot.km.toLocaleString()} km</span> : null}
                  </div>
                ))}
                {parsedLots.length > 10 && <p className="text-muted-foreground">...and {parsedLots.length - 10} more</p>}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>
            {!result && (
              <>
                <Button variant="secondary" onClick={handlePreview} disabled={!rawText.trim() || isImporting}>Preview</Button>
                <Button onClick={handleImport} disabled={parsedLots.length === 0 || isImporting || !eventId.trim()} className="gap-2">
                  {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Import {parsedLots.length} Lots
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
