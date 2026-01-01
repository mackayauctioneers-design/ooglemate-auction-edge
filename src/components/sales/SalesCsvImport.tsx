import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { dataService } from '@/services/dataService';
import { SaleLog, SalesImportRaw, SalesNormalised } from '@/types';
import { Upload, ArrowRight, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SalesCsvImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealerName: string;
  dealerWhatsapp: string;
  onImportComplete: () => void;
}

// CSV imports have relaxed validation - only core fields required
const CSV_REQUIRED_FIELDS = ['make', 'model', 'year', 'deposit_date'];

// Optional fields for CSV (engine, drivetrain, transmission create spec_only fingerprints)
const CSV_OPTIONAL_FIELDS = [
  'dealer_name', 'dealer_whatsapp', 'variant_normalised', 'km', 
  'engine', 'drivetrain', 'transmission',
  'buy_price', 'sell_price', 'days_to_deposit', 'notes'
];

const ALL_FIELDS = [...CSV_REQUIRED_FIELDS, ...CSV_OPTIONAL_FIELDS];

// Fields that can use special "use current" defaults
const DEFAULTABLE_FIELDS = ['dealer_name'];

const SETTING_KEY_PREFIX = 'csv_mapping_';

export function SalesCsvImport({ open, onOpenChange, dealerName, dealerWhatsapp, onImportComplete }: SalesCsvImportProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<'paste' | 'map' | 'result'>('paste');
  const [csvText, setCsvText] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    fingerprintsUpdated: number;
    errors: Array<{ row: number; reason: string }>;
  } | null>(null);

  // Load saved mapping for dealer from backend
  useEffect(() => {
    if (dealerName && open) {
      const loadSavedMapping = async () => {
        try {
          const saved = await dataService.getSetting(`${SETTING_KEY_PREFIX}${dealerName}`);
          if (saved) {
            setColumnMapping(JSON.parse(saved));
          }
        } catch {
          // Ignore errors loading saved mapping
        }
      };
      loadSavedMapping();
    }
  }, [dealerName, open]);

  const parseCsv = () => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      toast({
        title: 'Invalid CSV',
        description: 'CSV must have a header row and at least one data row.',
        variant: 'destructive',
      });
      return;
    }

    // Parse headers
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    setCsvHeaders(headers);

    // Parse rows
    const rows = lines.slice(1).map(line => {
      // Simple CSV parsing (handles quoted values with commas)
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      return values;
    }).filter(row => row.some(cell => cell)); // Filter empty rows

    setCsvRows(rows);

    // Auto-map columns with exact or similar names + DMS export aliases
    const DMS_COLUMN_ALIASES: Record<string, string> = {
      // DMS Sold Stock export mappings
      'odometer_km': 'km',
      'odometerKm': 'km',
      'odometer': 'km',
      'kms': 'km',
      'kilometres': 'km',
      'sale_date': 'deposit_date',
      'saleDate': 'deposit_date',
      'sold_date': 'deposit_date',
      'soldDate': 'deposit_date',
      'sale_price_gst_inc': 'sell_price',
      'salePriceGstInc': 'sell_price',
      'sale_price': 'sell_price',
      'salePrice': 'sell_price',
      'sold_price': 'sell_price',
      'soldPrice': 'sell_price',
      'total_cost_gst_inc': 'buy_price',
      'totalCostGstInc': 'buy_price',
      'total_cost': 'buy_price',
      'totalCost': 'buy_price',
      'cost_price': 'buy_price',
      'costPrice': 'buy_price',
      'cost': 'buy_price',
      'days_in_stock': 'days_to_deposit',
      'daysInStock': 'days_to_deposit',
      'description': 'variant_normalised',
      'variant': 'variant_normalised',
      'model_variant': 'variant_normalised',
      'modelVariant': 'variant_normalised',
      'rego': 'notes',
      'stock_no': 'notes',
      'stockNo': 'notes',
    };

    const newMapping: Record<string, string> = { ...columnMapping };
    headers.forEach(header => {
      const normalizedHeader = header.toLowerCase().replace(/[_\s-]/g, '');
      
      // First check DMS aliases (exact match on original header)
      const aliasKey = header.toLowerCase().replace(/\s+/g, '_');
      if (DMS_COLUMN_ALIASES[aliasKey] && !Object.values(newMapping).includes(DMS_COLUMN_ALIASES[aliasKey])) {
        newMapping[header] = DMS_COLUMN_ALIASES[aliasKey];
        return;
      }
      
      // Also check normalized version
      if (DMS_COLUMN_ALIASES[normalizedHeader] && !Object.values(newMapping).includes(DMS_COLUMN_ALIASES[normalizedHeader])) {
        newMapping[header] = DMS_COLUMN_ALIASES[normalizedHeader];
        return;
      }
      
      // Then try standard field matching
      ALL_FIELDS.forEach(field => {
        const normalizedField = field.toLowerCase().replace(/[_\s-]/g, '');
        if (normalizedHeader === normalizedField || normalizedHeader.includes(normalizedField)) {
          if (!Object.values(newMapping).includes(field)) {
            newMapping[header] = field;
          }
        }
      });
    });

    setColumnMapping(newMapping);
    setStep('map');
  };

  const handleImport = async () => {
    // Validate only CSV required fields are mapped (relaxed validation)
    const mappedFields = Object.values(columnMapping);
    
    // Check for required fields - dealer_name can be defaulted
    const missingRequired = CSV_REQUIRED_FIELDS.filter(f => {
      if (f === 'dealer_name') {
        // dealer_name is optional for CSV - defaults to current dealer
        return false;
      }
      return !mappedFields.includes(f);
    });
    
    if (missingRequired.length > 0) {
      toast({
        title: 'Missing required mappings',
        description: `Please map: ${missingRequired.join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    // Save mapping for future imports to backend
    try {
      await dataService.upsertSetting(`${SETTING_KEY_PREFIX}${dealerName}`, JSON.stringify(columnMapping));
    } catch {
      // Non-critical - continue with import even if saving mapping fails
    }

    setIsImporting(true);

    // Generate import_id for audit trail
    const importId = `IMP-${Date.now()}`;
    const uploadedAt = new Date().toISOString();

    try {
      // 1. Store raw rows in Sales_Imports_Raw (immutable audit trail)
      const rawRows: SalesImportRaw[] = csvRows.map((row, idx) => {
        const rowObj: Record<string, string> = {};
        csvHeaders.forEach((header, i) => {
          rowObj[header] = row[i] || '';
        });
        
        return {
          import_id: importId,
          uploaded_at: uploadedAt,
          dealer_name: dealerName,
          source: 'EasyCars',
          original_row_json: JSON.stringify(rowObj),
          parse_status: 'success' as const,
          parse_notes: '',
        };
      });

      await dataService.appendSalesImportsRaw(rawRows);

      // 2. Parse and normalise rows, storing in Sales_Normalised
      const normalisedRows: SalesNormalised[] = [];
      const parseErrors: Array<{ row: number; reason: string }> = [];

      csvRows.forEach((row, idx) => {
        const rowData: Record<string, any> = {};
        csvHeaders.forEach((header, i) => {
          const field = columnMapping[header];
          if (field && row[i] !== undefined) {
            const value = row[i];
            if (field === 'year' || field === 'km' || field === 'days_to_deposit') {
              rowData[field] = parseInt(value) || undefined;
            } else if (field === 'buy_price' || field === 'sell_price') {
              const parsed = parseFloat(value.replace(/[,$]/g, ''));
              rowData[field] = isNaN(parsed) ? undefined : parsed;
            } else {
              rowData[field] = value;
            }
          }
        });

        // Determine quality flag
        let qualityFlag: 'good' | 'review' | 'incomplete' = 'good';
        const requiredForGood = ['make', 'model', 'year', 'deposit_date'];
        const missingForGood = requiredForGood.filter(f => !rowData[f]);
        if (missingForGood.length > 0) {
          qualityFlag = 'incomplete';
        } else if (!rowData.km || !rowData.variant_normalised) {
          qualityFlag = 'review';
        }

        normalisedRows.push({
          sale_id: `SALE-${importId}-${idx}`,
          import_id: importId,
          dealer_name: dealerName,
          sale_date: rowData.deposit_date || '',
          make: rowData.make || '',
          model: rowData.model || '',
          variant_raw: rowData.variant_raw || rowData.variant_normalised || '',
          variant_normalised: rowData.variant_normalised || '',
          sale_price: rowData.sell_price,
          days_to_sell: rowData.days_to_deposit,
          location: rowData.location,
          km: rowData.km,
          quality_flag: qualityFlag,
          notes: rowData.notes,
          year: rowData.year,
          engine: rowData.engine,
          drivetrain: rowData.drivetrain,
          transmission: rowData.transmission,
          fingerprint_generated: 'N',
          // Calculate gross_profit if both prices available
          gross_profit: rowData.sell_price && rowData.buy_price 
            ? rowData.sell_price - rowData.buy_price 
            : undefined,
          activate: 'N',
          do_not_replicate: 'N',
          tags: undefined,
        });
      });

      await dataService.appendSalesNormalised(normalisedRows);

      // 3. Also run the legacy import for backwards compatibility with Sales_Log
      const sales: Array<Omit<SaleLog, 'sale_id' | 'created_at'>> = csvRows.map(row => {
        const sale: any = {
          source: 'CSV' as const,
          dealer_name: dealerName,
          dealer_whatsapp: dealerWhatsapp,
        };

        csvHeaders.forEach((header, index) => {
          const field = columnMapping[header];
          if (field && row[index] !== undefined) {
            const value = row[index];
            
            // Type conversion
            if (field === 'year' || field === 'km' || field === 'days_to_deposit') {
              sale[field] = parseInt(value) || 0;
            } else if (field === 'buy_price' || field === 'sell_price') {
              const parsed = parseFloat(value.replace(/[,$]/g, ''));
              sale[field] = isNaN(parsed) ? undefined : parsed;
            } else if (field === 'dealer_name' || field === 'dealer_whatsapp') {
              if (value) sale[field] = value;
            } else {
              sale[field] = value;
            }
          }
        });

        return sale as Omit<SaleLog, 'sale_id' | 'created_at'>;
      });

      const result = await dataService.importSalesWithFingerprints(sales);
      setImportResult(result);
      setStep('result');

      if (result.imported > 0) {
        toast({
          title: 'Import complete',
          description: `${result.imported} sales imported, ${result.fingerprintsUpdated} fingerprints synced. Import ID: ${importId}`,
        });
      }
    } catch (error) {
      toast({
        title: 'Import failed',
        description: 'An error occurred during import.',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setStep('paste');
    setCsvText('');
    setCsvHeaders([]);
    setCsvRows([]);
    setImportResult(null);
    onOpenChange(false);
    if (importResult && importResult.imported > 0) {
      onImportComplete();
    }
  };

  const updateMapping = (csvColumn: string, targetField: string) => {
    setColumnMapping(prev => ({
      ...prev,
      [csvColumn]: targetField === 'skip' ? '' : targetField,
    }));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Sales CSV
          </DialogTitle>
          <DialogDescription>
            {step === 'paste' && 'Paste your CSV data below. First row should be headers.'}
            {step === 'map' && 'Map your CSV columns to the required fields.'}
            {step === 'result' && 'Import complete. Review the results below.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'paste' && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="flex-1">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        const text = event.target?.result as string;
                        if (text) {
                          setCsvText(text);
                        }
                      };
                      reader.readAsText(file);
                    }
                    e.target.value = ''; // Reset for re-upload
                  }}
                />
                <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Click to upload CSV file</span>
                </div>
              </label>
            </div>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or paste data</span>
              </div>
            </div>
            <Textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="Paste CSV data here...
deposit_date,make,model,variant_normalised,year,km,engine,drivetrain,transmission
2024-01-15,Toyota,Hilux,SR5,2022,45000,Diesel,4WD,Automatic"
              className="min-h-[150px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Required: make, model, year, deposit_date (or sale_date). Dealer defaults to current dealer.
            </p>
          </div>
        )}

        {step === 'map' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Found {csvRows.length} rows. Map columns below:
            </p>
            <ScrollArea className="h-[300px] border rounded-md p-3">
              <div className="space-y-3">
                {csvHeaders.map((header) => (
                  <div key={header} className="flex items-center gap-3">
                    <div className="w-1/3 text-sm font-mono truncate" title={header}>
                      {header}
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <Select
                      value={columnMapping[header] || 'skip'}
                      onValueChange={(v) => updateMapping(header, v)}
                    >
                      <SelectTrigger className="w-1/2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">-- Skip --</SelectItem>
                        {ALL_FIELDS.map((field) => (
                          <SelectItem key={field} value={field}>
                            {field} {CSV_REQUIRED_FIELDS.includes(field) ? '*' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                * Required fields. Mapping will be saved for future imports.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Missing engine/drivetrain/transmission will create spec-only fingerprints (lower confidence matching).
              </p>
            </div>
          </div>
        )}

        {step === 'result' && importResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">{importResult.imported}</p>
                  <p className="text-sm text-muted-foreground">Sales imported</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <CheckCircle className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{importResult.fingerprintsUpdated}</p>
                  <p className="text-sm text-muted-foreground">Fingerprints synced</p>
                </div>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                  <Label>{importResult.errors.length} rows failed</Label>
                </div>
                <ScrollArea className="h-[150px] border rounded-md p-3">
                  <div className="space-y-2">
                    {importResult.errors.map((error, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <XCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                        <span>
                          <span className="font-mono">Row {error.row}:</span> {error.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'paste' && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={parseCsv} disabled={!csvText.trim()}>
                Next: Map Columns
              </Button>
            </>
          )}
          {step === 'map' && (
            <>
              <Button variant="outline" onClick={() => setStep('paste')}>Back</Button>
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting ? 'Importing...' : `Import ${csvRows.length} Sales`}
              </Button>
            </>
          )}
          {step === 'result' && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}