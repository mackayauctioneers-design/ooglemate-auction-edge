import { useState } from 'react';
import { Loader2, AlertCircle, CheckCircle, FileSpreadsheet, ClipboardPaste } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { dataService } from '@/services/dataService';
import { Listing, shouldExcludeListing } from '@/types';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface PicklesCatalogueImportProps {
  onClose: () => void;
  onImported: () => void;
}

interface ParsedLotWithText {
  lot: Partial<Listing>;
  catalogueText: string;
}

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
    // Support both formats:
    // 1. "N CP: MM/YYYY" (txt/csv)
    // 2. "| N | CP: MM/YYYY, ..." (PDF table format)
    
    let lotNumber = '';
    let complianceDate = '';
    let restOfText = text;

    // Try table format first (from PDF): "| 1 | CP: 08/2015, Ford, ..."
    const tableMatch = text.match(/^\|\s*(\d+)\s*\|\s*CP:\s*(\d{2}\/\d{4})/);
    if (tableMatch) {
      lotNumber = tableMatch[1];
      complianceDate = tableMatch[2];
      // Remove table delimiters for easier parsing
      restOfText = text.replace(/^\|\s*\d+\s*\|\s*/, '');
    } else {
      // Try plain text format: "1 CP: 08/2015"
      const plainMatch = text.match(/^(\d+)\s+CP:\s*(\d{2}\/\d{4})/);
      if (plainMatch) {
        lotNumber = plainMatch[1];
        complianceDate = plainMatch[2];
      }
    }
    
    if (!lotNumber || !complianceDate) return null;

    const year = complianceDateToYear(complianceDate);
    
    // Split by commas for parsing
    const parts = restOfText.split(',').map(p => p.trim());
    if (parts.length < 4) return null;

    // Find first part that starts with "CP:" and extract make/model after it
    let makeModelIdx = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].match(/^CP:/i)) {
        makeModelIdx = i + 1;
        break;
      }
    }

    // Core fields
    const make = parts[makeModelIdx] || '';
    const model = parts[makeModelIdx + 1] || '';
    const variant_raw = parts[makeModelIdx + 2] || '';

    // Optional fields - scan remaining parts
    let transmission = '';
    let engine = '';
    let fuel = '';
    let km = 0;
    let colour = '';
    let location = '';
    let drivetrain = '';

    for (let i = makeModelIdx + 3; i < parts.length; i++) {
      const part = parts[i];
      
      if (part.match(/automatic|manual|cvt|dct/i) && !transmission) {
        transmission = part.match(/auto/i) ? 'Auto' : part.match(/manual/i) ? 'Manual' : part;
      }
      else if (part.match(/^\d+\.?\d*\s*Ltr$/i) && !engine) {
        engine = part;
      }
      else if (part.match(/Diesel|Petrol|Electric|Hybrid/i) && !fuel) {
        fuel = part.match(/diesel/i) ? 'Diesel' : part.match(/petrol/i) ? 'Petrol' : part;
      }
      else if (part.match(/\d+\s*\(Kms/i) && !km) {
        const kmMatch = part.match(/(\d+)\s*\(Kms/);
        if (kmMatch) km = parseInt(kmMatch[1].replace(/,/g, ''));
      }
      else if (part.match(/^Colour:\s*/i) && !colour) {
        colour = part.replace(/^Colour:\s*/i, '');
      }
      else if (part.match(/\b(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b/i) && !location) {
        // Extract just the state or full location
        const stateMatch = part.match(/([A-Za-z\s]+),?\s*(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)/i);
        if (stateMatch) {
          location = stateMatch[0].trim();
        } else {
          location = part.trim();
        }
      }
      else if (part.match(/4WD|AWD|2WD|RWD|FWD/i) && !drivetrain) {
        drivetrain = part.match(/4WD/i) ? '4WD' : part.match(/AWD/i) ? 'AWD' : part;
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

// Parse full catalogue text into lot entries with exclusion check
// Supports both plain text and PDF markdown table formats
function parseCatalogue(rawText: string, eventId: string, auctionDate: string): ParsedLotWithText[] {
  const results: ParsedLotWithText[] = [];
  
  // Detect if this is PDF markdown table format (contains "| Lot | Description")
  const isPdfTable = rawText.includes('| Lot | Description');
  
  if (isPdfTable) {
    // Parse table rows: | N | CP: MM/YYYY, Make, Model, ... |
    const tableRowPattern = /\|\s*(\d+)\s*\|\s*(CP:[^|]+)\|/g;
    let match: RegExpExecArray | null;
    
    while ((match = tableRowPattern.exec(rawText)) !== null) {
      const lotNumber = match[1];
      const description = match[2].trim();
      const lotText = `${lotNumber} ${description}`;
      const parsed = parseLotEntry(lotText, eventId, auctionDate);
      if (parsed) {
        const exclusionCheck = shouldExcludeListing(parsed, description);
        if (exclusionCheck.excluded) {
          parsed.excluded_reason = 'condition_risk';
          parsed.excluded_keyword = exclusionCheck.keyword;
          parsed.visible_to_dealers = 'N';
        }
        results.push({ lot: parsed, catalogueText: description });
      }
    }
  } else {
    // Original plain text parsing
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
      if (parsed) {
        const exclusionCheck = shouldExcludeListing(parsed, lotText);
        if (exclusionCheck.excluded) {
          parsed.excluded_reason = 'condition_risk';
          parsed.excluded_keyword = exclusionCheck.keyword;
          parsed.visible_to_dealers = 'N';
        }
        results.push({ lot: parsed, catalogueText: lotText });
      }
    }
  }

  return results;
}

// Extract event info from PDF text (e.g., "12931 - National Online Motor Vehicle Auction" and "2/1/2026")
function extractEventInfo(text: string): { eventId: string; auctionDate: string } {
  let eventId = '';
  let auctionDate = format(new Date(), 'yyyy-MM-dd');
  
  // Extract event ID from header like "# 12931 - National Online"
  const eventMatch = text.match(/^#?\s*(\d{4,})\s*-/m);
  if (eventMatch) eventId = eventMatch[1];
  
  // Extract date range like "2/1/2026 - 4/1/2026" - use the end date as auction date
  const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dateMatch) {
    // Use end date (last 3 groups)
    const day = dateMatch[4].padStart(2, '0');
    const month = dateMatch[5].padStart(2, '0');
    const year = dateMatch[6];
    auctionDate = `${year}-${month}-${day}`;
  }
  
  return { eventId, auctionDate };
}

export function PicklesCatalogueImport({ onClose, onImported }: PicklesCatalogueImportProps) {
  const [rawText, setRawText] = useState('');
  const [eventId, setEventId] = useState('');
  const [auctionDate, setAuctionDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isImporting, setIsImporting] = useState(false);
  const [parsedResults, setParsedResults] = useState<ParsedLotWithText[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);

  // Derived counts
  const excludedCount = parsedResults.filter(r => r.lot.excluded_reason).length;
  const validCount = parsedResults.length - excludedCount;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setResult(null);
    setParsedResults([]);

    try {
      const text = await file.text();
      setRawText(text);
      // Try to extract event info from file name first
      const eventMatch = file.name.match(/(\d{4,})/);
      if (eventMatch) setEventId(eventMatch[1]);
      // Then try to extract from content
      const extracted = extractEventInfo(text);
      if (extracted.eventId && !eventId) setEventId(extracted.eventId);
      if (extracted.auctionDate !== format(new Date(), 'yyyy-MM-dd')) setAuctionDate(extracted.auctionDate);
    } catch {
      setError('Failed to read file. Note: PDF files must be pasted as text.');
    }
  };

  const handleTextChange = (text: string) => {
    setRawText(text);
    setParsedResults([]);
    setResult(null);
    // Auto-extract event info from pasted text
    const extracted = extractEventInfo(text);
    if (extracted.eventId) setEventId(extracted.eventId);
    if (extracted.auctionDate !== format(new Date(), 'yyyy-MM-dd')) setAuctionDate(extracted.auctionDate);
  };

  const handlePreview = () => {
    setError('');
    setResult(null);

    if (!rawText.trim()) {
      setError('No file content');
      return;
    }

    const results = parseCatalogue(rawText, eventId, auctionDate);
    if (results.length === 0) {
      setError('No valid lots found');
      return;
    }
    setParsedResults(results);
  };

  const handleImport = async () => {
    if (parsedResults.length === 0 || !eventId.trim()) return;

    setIsImporting(true);
    setError('');

    try {
      // Use standard upsertLots - respects lot_key uniqueness, pass_count, lifecycle
      const lotsToImport = parsedResults.map(r => r.lot);
      const result = await dataService.upsertLots(lotsToImport);
      setResult(result);
      toast({
        title: 'Import complete',
        description: `Added ${result.added}, updated ${result.updated} lots.${excludedCount > 0 ? ` (${excludedCount} excluded)` : ''}`,
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
            Upload a file or paste PDF text. Lots will be imported and become eligible for matching.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs defaultValue="paste" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="paste" className="gap-2">
                <ClipboardPaste className="h-4 w-4" />
                Paste Text
              </TabsTrigger>
              <TabsTrigger value="file" className="gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Upload File
              </TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="space-y-2">
              <Label>Paste catalogue text (from PDF or document)</Label>
              <Textarea
                placeholder="Paste the catalogue content here...&#10;&#10;Example:&#10;| 1 | CP: 08/2015, Ford, Ranger, PX MkII XLT, ..."
                value={rawText}
                onChange={(e) => handleTextChange(e.target.value)}
                className="min-h-[120px] font-mono text-xs"
              />
              {rawText && (
                <p className="text-xs text-muted-foreground">{rawText.length.toLocaleString()} characters</p>
              )}
            </TabsContent>
            <TabsContent value="file" className="space-y-2">
              <Label>Upload catalogue file (.xlsx, .csv, .txt)</Label>
              <Input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={handleFileUpload} />
              <p className="text-xs text-muted-foreground">Note: PDF files cannot be uploaded directly. Use the "Paste Text" tab instead.</p>
            </TabsContent>
          </Tabs>

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

          {parsedResults.length > 0 && !result && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {parsedResults.length} lots to import
                {excludedCount > 0 && (
                  <span className="text-destructive ml-2">({excludedCount} excluded due to condition risk)</span>
                )}
              </p>
              <div className="max-h-40 overflow-y-auto border rounded-lg p-2 text-xs space-y-1">
                {parsedResults.slice(0, 10).map((item, i) => (
                  <div key={i} className={`flex gap-2 py-1 border-b border-border/50 last:border-0 ${item.lot.excluded_reason ? 'opacity-50' : ''}`}>
                    <span className="font-mono text-muted-foreground w-8">#{item.lot.lot_id}</span>
                    <span className="font-medium">{item.lot.make} {item.lot.model}</span>
                    <span className="text-muted-foreground">{item.lot.year}</span>
                    {item.lot.excluded_reason && (
                      <span className="text-destructive text-[10px] ml-auto">EXCLUDED: {item.lot.excluded_keyword}</span>
                    )}
                    {!item.lot.excluded_reason && item.lot.km ? (
                      <span className="text-muted-foreground ml-auto">{item.lot.km.toLocaleString()} km</span>
                    ) : null}
                  </div>
                ))}
                {parsedResults.length > 10 && <p className="text-muted-foreground">...and {parsedResults.length - 10} more</p>}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>
            {!result && (
              <>
                <Button variant="secondary" onClick={handlePreview} disabled={!rawText.trim() || isImporting}>Preview</Button>
                <Button onClick={handleImport} disabled={parsedResults.length === 0 || isImporting || !eventId.trim()} className="gap-2">
                  {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Import {parsedResults.length} Lots
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
