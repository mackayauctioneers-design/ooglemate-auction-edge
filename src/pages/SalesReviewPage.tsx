import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { dataService } from '@/services/dataService';
import { SalesNormalised, formatCurrency } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Fingerprint, RefreshCw, Filter, Check, AlertTriangle, XCircle } from 'lucide-react';

export default function SalesReviewPage() {
  useDocumentTitle(0);
  const { toast } = useToast();

  const [sales, setSales] = useState<SalesNormalised[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);

  // Filters
  const [filterOptions, setFilterOptions] = useState<{
    importIds: string[];
    dealers: string[];
    makes: string[];
    models: string[];
    qualityFlags: string[];
  }>({ importIds: [], dealers: [], makes: [], models: [], qualityFlags: [] });

  const [filters, setFilters] = useState({
    importId: '',
    dealerName: '',
    qualityFlag: '',
    make: '',
    model: '',
    dateFrom: '',
    dateTo: '',
  });

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ variant_normalised: string; notes: string }>({
    variant_normalised: '',
    notes: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [salesData, options] = await Promise.all([
        dataService.getSalesNormalised({
          importId: filters.importId || undefined,
          dealerName: filters.dealerName || undefined,
          qualityFlag: filters.qualityFlag || undefined,
          make: filters.make || undefined,
          model: filters.model || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        }),
        dataService.getSalesNormalisedFilterOptions(),
      ]);
      setSales(salesData);
      setFilterOptions(options);
    } catch (error) {
      toast({ title: 'Error loading data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filters]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(sales.filter(s => s.fingerprint_generated !== 'Y').map(s => s.sale_id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (saleId: string, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) {
      newSet.add(saleId);
    } else {
      newSet.delete(saleId);
    }
    setSelectedIds(newSet);
  };

  const startEdit = (sale: SalesNormalised) => {
    setEditingId(sale.sale_id);
    setEditValues({
      variant_normalised: sale.variant_normalised || '',
      notes: sale.notes || '',
    });
  };

  const saveEdit = async (sale: SalesNormalised) => {
    try {
      await dataService.updateSalesNormalised({
        ...sale,
        variant_normalised: editValues.variant_normalised,
        notes: editValues.notes,
      });
      setEditingId(null);
      loadData();
      toast({ title: 'Saved' });
    } catch (error) {
      toast({ title: 'Error saving', variant: 'destructive' });
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleGenerateFingerprints = async () => {
    if (selectedIds.size === 0) {
      toast({ title: 'No sales selected', variant: 'destructive' });
      return;
    }

    setGenerating(true);
    try {
      const result = await dataService.generateFingerprintsFromNormalised(Array.from(selectedIds));
      toast({
        title: 'Fingerprints generated',
        description: `Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}${
          result.errors.length > 0 ? `, Errors: ${result.errors.length}` : ''
        }`,
      });
      setSelectedIds(new Set());
      loadData();
    } catch (error) {
      toast({ title: 'Error generating fingerprints', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const getQualityBadge = (flag: string) => {
    switch (flag) {
      case 'good':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><Check className="w-3 h-3 mr-1" />Good</Badge>;
      case 'review':
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30"><AlertTriangle className="w-3 h-3 mr-1" />Review</Badge>;
      case 'incomplete':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />Incomplete</Badge>;
      default:
        return <Badge variant="outline">{flag}</Badge>;
    }
  };

  const selectableSales = sales.filter(s => s.fingerprint_generated !== 'Y');
  const allSelected = selectableSales.length > 0 && selectableSales.every(s => selectedIds.has(s.sale_id));

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Sales Review</h1>
            <p className="text-muted-foreground">Review imported sales and generate fingerprints</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button 
              onClick={handleGenerateFingerprints} 
              disabled={selectedIds.size === 0 || generating}
            >
              <Fingerprint className="h-4 w-4 mr-2" />
              {generating ? 'Generating...' : `Generate Fingerprints (${selectedIds.size})`}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <Select value={filters.importId} onValueChange={(v) => setFilters(f => ({ ...f, importId: v === 'all' ? '' : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Import ID" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Imports</SelectItem>
                  {filterOptions.importIds.map(id => (
                    <SelectItem key={id} value={id}>{id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.dealerName} onValueChange={(v) => setFilters(f => ({ ...f, dealerName: v === 'all' ? '' : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Dealer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dealers</SelectItem>
                  {filterOptions.dealers.map(d => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.qualityFlag} onValueChange={(v) => setFilters(f => ({ ...f, qualityFlag: v === 'all' ? '' : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Quality" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Quality</SelectItem>
                  {filterOptions.qualityFlags.map(q => (
                    <SelectItem key={q} value={q}>{q}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.make} onValueChange={(v) => setFilters(f => ({ ...f, make: v === 'all' ? '' : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Make" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Makes</SelectItem>
                  {filterOptions.makes.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.model} onValueChange={(v) => setFilters(f => ({ ...f, model: v === 'all' ? '' : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Models</SelectItem>
                  {filterOptions.models.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="date"
                placeholder="From"
                value={filters.dateFrom}
                onChange={(e) => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
              />

              <Input
                type="date"
                placeholder="To"
                value={filters.dateTo}
                onChange={(e) => setFilters(f => ({ ...f, dateTo: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox 
                        checked={allSelected}
                        onCheckedChange={handleSelectAll}
                        disabled={selectableSales.length === 0}
                      />
                    </TableHead>
                    <TableHead>Import</TableHead>
                    <TableHead>Dealer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>KM</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Quality</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>FP</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                        {loading ? 'Loading...' : 'No sales found. Import a CSV to get started.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sales.map((sale) => (
                      <TableRow key={sale.sale_id} className={selectedIds.has(sale.sale_id) ? 'bg-primary/5' : ''}>
                        <TableCell>
                          <Checkbox 
                            checked={selectedIds.has(sale.sale_id)}
                            onCheckedChange={(checked) => handleSelectOne(sale.sale_id, !!checked)}
                            disabled={sale.fingerprint_generated === 'Y'}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{sale.import_id.slice(-8)}</TableCell>
                        <TableCell>{sale.dealer_name}</TableCell>
                        <TableCell>{sale.sale_date}</TableCell>
                        <TableCell>
                          <div className="font-medium">{sale.year} {sale.make} {sale.model}</div>
                        </TableCell>
                        <TableCell>
                          {editingId === sale.sale_id ? (
                            <Input
                              value={editValues.variant_normalised}
                              onChange={(e) => setEditValues(v => ({ ...v, variant_normalised: e.target.value }))}
                              className="h-8 w-32"
                            />
                          ) : (
                            <span className="text-sm">{sale.variant_normalised || '-'}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {sale.km ? sale.km.toLocaleString() : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          {sale.sale_price ? formatCurrency(sale.sale_price) : '-'}
                        </TableCell>
                        <TableCell>{getQualityBadge(sale.quality_flag)}</TableCell>
                        <TableCell>
                          {editingId === sale.sale_id ? (
                            <Input
                              value={editValues.notes}
                              onChange={(e) => setEditValues(v => ({ ...v, notes: e.target.value }))}
                              className="h-8 w-32"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground truncate max-w-[120px] block">
                              {sale.notes || '-'}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {sale.fingerprint_generated === 'Y' ? (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                              <Fingerprint className="w-3 h-3" />
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingId === sale.sale_id ? (
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => saveEdit(sale)}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => startEdit(sale)}>
                              Edit
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="text-sm text-muted-foreground">
          Showing {sales.length} sales • {selectedIds.size} selected • 
          {sales.filter(s => s.fingerprint_generated === 'Y').length} with fingerprints
        </div>
      </div>
    </AppLayout>
  );
}
