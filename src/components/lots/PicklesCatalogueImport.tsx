import { useState } from 'react';
import { Upload, Loader2, AlertCircle, CheckCircle, FileSpreadsheet } from 'lucide-react';
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

interface ParsedLot {
  lot_number: number;
  compliance_date: string;
  make: string;
  model: string;
  variant: string;
  body_type: string;
  seats?: number;
  doors?: number;
  built_date?: string;
  transmission: string;
  engine: string;
  cylinders?: number;
  fuel: string;
  km: number;
  colour?: string;
  rego?: string;
  location: string;
  service_history?: string;
  gst?: string;
}

// Parse a Pickles catalogue text entry
function parsePicklesEntry(text: string): ParsedLot | null {
  try {
    // Split by <br/> to separate lots, then by comma
    const parts = text.split(',').map(p => p.trim());
    if (parts.length < 10) return null;

    // First part contains lot number and compliance date
    // Format: "1 CP: 08/2015" or similar
    const firstPart = parts[0];
    const lotMatch = firstPart.match(/^(\d+)\s+CP:\s*(\d{2}\/\d{4})/);
    if (!lotMatch) return null;

    const lot_number = parseInt(lotMatch[1]);
    const compliance_date = lotMatch[2];

    // Next parts: Make, Model, Variant, Body Type
    const make = parts[1] || '';
    const model = parts[2] || '';
    const variant = parts[3] || '';
    const body_type = parts[4] || '';

    // Look for key fields in remaining parts
    let transmission = '';
    let engine = '';
    let fuel = '';
    let km = 0;
    let location = '';
    let cylinders: number | undefined;
    let seats: number | undefined;
    let doors: number | undefined;
    let built_date: string | undefined;
    let colour: string | undefined;
    let rego: string | undefined;
    let service_history: string | undefined;
    let gst: string | undefined;

    for (let i = 5; i < parts.length; i++) {
      const part = parts[i];
      
      // Seats
      if (part.match(/^\d+\s+seats?$/i)) {
        seats = parseInt(part);
      }
      // Doors
      else if (part.match(/^\d+\s+doors?$/i)) {
        doors = parseInt(part);
      }
      // Built date
      else if (part.match(/^Built:\s*\d{2}\/\d{4}/i)) {
        built_date = part.replace(/^Built:\s*/i, '');
      }
      // Transmission
      else if (part.match(/automatic|manual|cvt|dct|continuously variable/i)) {
        transmission = part;
      }
      // Engine size
      else if (part.match(/^\d+\.?\d*\s*Ltr$/i)) {
        engine = part;
      }
      // Cylinders
      else if (part.match(/^\d+\s+Cyl$/i)) {
        cylinders = parseInt(part);
        if (engine) {
          engine = `${engine} ${cylinders}Cyl`;
        }
      }
      // Fuel type
      else if (part.match(/Diesel|Petrol|Electric|Hybrid|LPG/i)) {
        fuel = part;
      }
      // KMs
      else if (part.match(/\d+\s*\(Kms\.?\s*Showing/i)) {
        const kmMatch = part.match(/(\d+)\s*\(Kms/);
        if (kmMatch) km = parseInt(kmMatch[1].replace(/,/g, ''));
      }
      // Colour
      else if (part.match(/^Colour:\s*/i)) {
        colour = part.replace(/^Colour:\s*/i, '');
      }
      // Rego
      else if (part.match(/^Rego:\s*/i)) {
        rego = part.replace(/^Rego:\s*/i, '');
      }
      // Location (typically has state abbreviation)
      else if (part.match(/\b(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b/i)) {
        location = part;
      }
      // Service history
      else if (part.match(/service history/i)) {
        service_history = part;
      }
      // GST
      else if (part.match(/^GST\s/i)) {
        gst = part;
      }
    }

    return {
      lot_number,
      compliance_date,
      make,
      model,
      variant,
      body_type,
      seats,
      doors,
      built_date,
      transmission,
      engine,
      cylinders,
      fuel,
      km,
      colour,
      rego,
      location,
      service_history,
      gst,
    };
  } catch (err) {
    console.error('Failed to parse Pickles entry:', err);
    return null;
  }
}

// Parse compliance date to year
function complianceDateToYear(compDate: string): number {
  const match = compDate.match(/\d{4}/);
  if (match) return parseInt(match[0]);
  
  // Try MM/YYYY format
  const mmyyyy = compDate.match(/\d{2}\/(\d{4})/);
  if (mmyyyy) return parseInt(mmyyyy[1]);
  
  return new Date().getFullYear();
}

// Convert parsed lot to Listing format
function parsedLotToListing(parsed: ParsedLot, auctionHouse: string, eventId: string, auctionDate: string): Partial<Listing> {
  const year = complianceDateToYear(parsed.compliance_date);
  const now = new Date().toISOString();
  
  // Normalize drivetrain from variant
  let drivetrain = '';
  if (parsed.variant.match(/4x4|4WD|AWD/i)) drivetrain = '4WD';
  else if (parsed.variant.match(/2WD|RWD|FWD/i)) drivetrain = '2WD';

  // Normalize transmission
  let transmission = '';
  if (parsed.transmission.match(/auto/i)) transmission = 'Auto';
  else if (parsed.transmission.match(/manual/i)) transmission = 'Manual';
  else if (parsed.transmission.match(/cvt|continuously variable/i)) transmission = 'CVT';

  // Create lot_id and lot_key
  const lot_id = `${parsed.lot_number}`;
  const lot_key = `${auctionHouse}:${lot_id}`;
  const listing_id = `${auctionHouse}:${parsed.lot_number}`;

  return {
    listing_id,
    lot_id,
    lot_key,
    listing_key: lot_key,
    source: 'auction',
    source_site: auctionHouse,
    source_type: 'auction',
    source_name: auctionHouse,
    event_id: eventId,
    auction_house: auctionHouse,
    location: parsed.location || '',
    auction_datetime: auctionDate,
    listing_url: '', // No URL from catalogue
    make: parsed.make,
    model: parsed.model,
    variant_raw: parsed.variant,
    variant_normalised: parsed.variant,
    year,
    km: parsed.km,
    fuel: parsed.fuel,
    drivetrain,
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
    description_score: 2, // Default medium score
    estimated_get_out: 0,
    estimated_margin: 0,
    confidence_score: 0,
    action: 'Watch',
    visible_to_dealers: 'Y',
    updated_at: now,
    last_status: 'listed',
    relist_group_id: '',
    override_enabled: 'N',
    invalid_source: 'Y', // Mark as invalid since no URL
  };
}

// Parse the raw Excel text content
function parsePicklesCatalogue(rawText: string): ParsedLot[] {
  const lots: ParsedLot[] = [];
  
  // Split by lot entries - look for pattern "N CP:" where N is a number
  const lotPattern = /(\d+)\s+CP:/g;
  let matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  
  while ((match = lotPattern.exec(rawText)) !== null) {
    matches.push(match);
  }
  
  // Extract each lot's text
  for (let i = 0; i < matches.length; i++) {
    const startIdx = matches[i].index;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
    const lotText = rawText.substring(startIdx, endIdx);
    
    const parsed = parsePicklesEntry(lotText);
    if (parsed) {
      lots.push(parsed);
    }
  }
  
  return lots;
}

export function PicklesCatalogueImport({ onClose, onImported }: PicklesCatalogueImportProps) {
  const [rawText, setRawText] = useState('');
  const [auctionHouse, setAuctionHouse] = useState('Pickles');
  const [eventId, setEventId] = useState('');
  const [auctionDate, setAuctionDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isImporting, setIsImporting] = useState(false);
  const [parsedLots, setParsedLots] = useState<ParsedLot[]>([]);
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
      
      // Try to extract event ID from filename
      const eventMatch = file.name.match(/(\d{4,})/);
      if (eventMatch) {
        setEventId(eventMatch[1]);
      }
    } catch (err) {
      setError('Failed to read file');
    }
  };

  const handlePreview = () => {
    setError('');
    setResult(null);

    if (!rawText.trim()) {
      setError('No file content to parse');
      return;
    }

    const lots = parsePicklesCatalogue(rawText);
    if (lots.length === 0) {
      setError('No valid lots found in catalogue. Check file format.');
      return;
    }

    setParsedLots(lots);
  };

  const handleImport = async () => {
    if (parsedLots.length === 0) return;
    if (!eventId.trim()) {
      setError('Event ID is required');
      return;
    }

    setIsImporting(true);
    setError('');

    try {
      const listings = parsedLots.map(lot => 
        parsedLotToListing(lot, auctionHouse, eventId, auctionDate)
      );

      const result = await dataService.upsertLots(listings);
      setResult(result);
      toast({
        title: 'Import complete',
        description: `Added ${result.added} new lots, updated ${result.updated} existing lots.`,
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
      <DialogContent className="max-w-[95vw] sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Pickles Auction Catalogue
          </DialogTitle>
          <DialogDescription>
            Upload an auction catalogue Excel/CSV file to import lot data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Upload */}
          <div className="space-y-2">
            <Label>Upload Catalogue File</Label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              onChange={handleFileUpload}
            />
          </div>

          {/* Auction Details */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Auction House</Label>
              <Input
                value={auctionHouse}
                onChange={(e) => setAuctionHouse(e.target.value)}
                placeholder="Pickles"
              />
            </div>
            <div className="space-y-2">
              <Label>Event ID</Label>
              <Input
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                placeholder="12931"
              />
            </div>
            <div className="space-y-2">
              <Label>Auction Date</Label>
              <Input
                type="date"
                value={auctionDate}
                onChange={(e) => setAuctionDate(e.target.value)}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Result */}
          {result && (
            <Alert className="border-emerald-600">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <AlertDescription>
                Successfully added {result.added} new lots and updated {result.updated} existing lots.
              </AlertDescription>
            </Alert>
          )}

          {/* Preview */}
          {parsedLots.length > 0 && !result && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Preview: {parsedLots.length} lots to import</p>
              <div className="max-h-48 overflow-y-auto border rounded-lg p-2 text-xs space-y-1">
                {parsedLots.slice(0, 15).map((lot, i) => (
                  <div key={i} className="flex gap-2 items-center py-1 border-b border-border/50 last:border-0">
                    <span className="font-mono text-muted-foreground w-8">#{lot.lot_number}</span>
                    <span className="font-medium">{lot.make} {lot.model}</span>
                    <span className="text-muted-foreground">{lot.variant}</span>
                    <span className="text-muted-foreground ml-auto">{complianceDateToYear(lot.compliance_date)}</span>
                    <span className="text-muted-foreground">{lot.km?.toLocaleString()} km</span>
                  </div>
                ))}
                {parsedLots.length > 15 && (
                  <p className="text-muted-foreground py-1">...and {parsedLots.length - 15} more</p>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
              {result ? 'Close' : 'Cancel'}
            </Button>
            {!result && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handlePreview}
                  disabled={!rawText.trim() || isImporting}
                  className="w-full sm:w-auto"
                >
                  Preview
                </Button>
                <Button
                  type="button"
                  onClick={handleImport}
                  disabled={parsedLots.length === 0 || isImporting || !eventId.trim()}
                  className="w-full sm:w-auto gap-2"
                >
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
