import { useState } from 'react';
import { Upload, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { dataService } from '@/services/dataService';
import { AuctionLot } from '@/types';
import { toast } from '@/hooks/use-toast';

interface LotCsvImportProps {
  onClose: () => void;
  onImported: () => void;
}

const CSV_HEADERS = [
  'lot_id', 'event_id', 'auction_house', 'location', 'auction_datetime', 'listing_url',
  'make', 'model', 'variant_raw', 'variant_normalised', 'year', 'km', 'fuel', 'drivetrain',
  'transmission', 'reserve', 'highest_bid', 'status', 'pass_count', 'description_score',
  'estimated_get_out', 'estimated_margin', 'confidence_score', 'action', 'visible_to_dealers', 'updated_at'
];

function parseCSV(csvText: string): Partial<AuctionLot>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
  const lots: Partial<AuctionLot>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const lot: any = {};

    headers.forEach((header, index) => {
      const value = values[index] || '';
      
      // Map header to our schema
      const normalizedHeader = header.replace(/\s+/g, '_');
      
      // Type conversions
      if (['year', 'km', 'pass_count', 'description_score', 'confidence_score'].includes(normalizedHeader)) {
        lot[normalizedHeader] = parseInt(value) || 0;
      } else if (['reserve', 'highest_bid', 'estimated_get_out', 'estimated_margin'].includes(normalizedHeader)) {
        lot[normalizedHeader] = parseFloat(value.replace(/[^0-9.-]/g, '')) || 0;
      } else {
        lot[normalizedHeader] = value;
      }
    });

    // Only include if lot_id is present
    if (lot.lot_id) {
      lots.push(lot as Partial<AuctionLot>);
    }
  }

  return lots;
}

export function LotCsvImport({ onClose, onImported }: LotCsvImportProps) {
  const [csvText, setCsvText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [previewLots, setPreviewLots] = useState<Partial<AuctionLot>[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);

  const handlePreview = () => {
    setError('');
    setResult(null);
    
    try {
      const lots = parseCSV(csvText);
      if (lots.length === 0) {
        setError('No valid lots found in CSV. Ensure lot_id column is present.');
        return;
      }
      setPreviewLots(lots);
    } catch (err) {
      setError('Failed to parse CSV. Check format.');
    }
  };

  const handleImport = async () => {
    if (previewLots.length === 0) return;
    
    setIsImporting(true);
    setError('');

    try {
      const result = await dataService.upsertLots(previewLots);
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
            <Upload className="h-5 w-5" />
            Import Lots from CSV
          </DialogTitle>
          <DialogDescription>
            Paste CSV data below. Must include a <code className="bg-muted px-1 rounded">lot_id</code> column. 
            Existing lots will be updated (upsert on lot_id).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Expected Headers */}
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Expected headers:</p>
            <p className="text-xs font-mono break-all">{CSV_HEADERS.join(', ')}</p>
          </div>

          {/* CSV Input */}
          <Textarea
            placeholder="Paste CSV here..."
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={8}
            className="font-mono text-xs"
          />

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
          {previewLots.length > 0 && !result && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Preview: {previewLots.length} lots to import</p>
              <div className="max-h-40 overflow-y-auto border rounded-lg p-2 text-xs space-y-1">
                {previewLots.slice(0, 10).map((lot, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="font-mono text-muted-foreground">{lot.lot_id}</span>
                    <span>{lot.make} {lot.model}</span>
                    <span className="text-muted-foreground">{lot.year}</span>
                  </div>
                ))}
                {previewLots.length > 10 && (
                  <p className="text-muted-foreground">...and {previewLots.length - 10} more</p>
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
                  disabled={!csvText.trim() || isImporting}
                  className="w-full sm:w-auto"
                >
                  Preview
                </Button>
                <Button
                  type="button"
                  onClick={handleImport}
                  disabled={previewLots.length === 0 || isImporting}
                  className="w-full sm:w-auto gap-2"
                >
                  {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Import {previewLots.length} Lots
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}