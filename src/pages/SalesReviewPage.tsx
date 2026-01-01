import { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { dataService } from '@/services/dataService';
import { SalesNormalised, formatCurrency } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Fingerprint, RefreshCw, Filter, Check, AlertTriangle, XCircle, 
  TrendingUp, TrendingDown, Tag, Zap, Ban, BarChart3, UserCircle
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// Aggregation type for mistake detection
interface VehicleAggregation {
  key: string;
  make: string;
  model: string;
  variant_normalised: string;
  count_sold: number;
  avg_gross_profit: number;
  total_gross_profit: number;
  avg_days_to_sell: number;
}

export default function SalesReviewPage() {
  useDocumentTitle(0);
  const { toast } = useToast();
  const { currentUser } = useAuth();

  const [sales, setSales] = useState<SalesNormalised[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  // Tag dialog
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [newTag, setNewTag] = useState('');

  // Dealer name dialog
  const [dealers, setDealers] = useState<string[]>([]);
  const [dealerDialogOpen, setDealerDialogOpen] = useState(false);
  const [newDealerName, setNewDealerName] = useState('');

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
    variant: '',
    dateFrom: '',
    dateTo: '',
    activateOnly: false,
    doNotReplicateOnly: false,
  });

  // Preset filter
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ variant_normalised: string; notes: string; gross_profit: string }>({
    variant_normalised: '',
    notes: '',
    gross_profit: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [salesData, options, dealerList] = await Promise.all([
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
        dataService.getDealers(),
      ]);
      setSales(salesData);
      setFilterOptions(options);
      setDealers(dealerList.map(d => d.dealer_name));
    } catch (error) {
      toast({ title: 'Error loading data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filters.importId, filters.dealerName, filters.qualityFlag, filters.make, filters.model, filters.dateFrom, filters.dateTo]);

  // Sort and filter sales: gross_profit DESC (nulls last), days_to_sell ASC
  const sortedSales = useMemo(() => {
    let filtered = [...sales];
    
    // Apply variant filter
    if (filters.variant) {
      filtered = filtered.filter(s => s.variant_normalised === filters.variant);
    }
    
    // Apply activate/do_not_replicate filters
    if (filters.activateOnly) {
      filtered = filtered.filter(s => s.activate === 'Y');
    }
    if (filters.doNotReplicateOnly) {
      filtered = filtered.filter(s => s.do_not_replicate === 'Y');
    }
    
    // Apply presets
    if (activePreset === 'winners') {
      filtered = filtered.filter(s => s.gross_profit !== undefined && s.gross_profit > 0);
    } else if (activePreset === 'losers') {
      filtered = filtered.filter(s => s.gross_profit !== undefined && s.gross_profit < 0);
    }
    
    // Sort: gross_profit DESC (nulls last), then days_to_sell ASC
    return filtered.sort((a, b) => {
      // gross_profit DESC, nulls last
      if (a.gross_profit === undefined && b.gross_profit === undefined) {
        // Both null, sort by days_to_sell ASC
      } else if (a.gross_profit === undefined) {
        return 1;
      } else if (b.gross_profit === undefined) {
        return -1;
      } else if (a.gross_profit !== b.gross_profit) {
        return b.gross_profit - a.gross_profit;
      }
      
      // days_to_sell ASC
      const aDays = a.days_to_sell ?? 999;
      const bDays = b.days_to_sell ?? 999;
      return aDays - bDays;
    });
  }, [sales, filters.variant, filters.activateOnly, filters.doNotReplicateOnly, activePreset]);

  // Aggregation for mistake detection
  const aggregations = useMemo((): VehicleAggregation[] => {
    const groups: Record<string, SalesNormalised[]> = {};
    
    sales.forEach(s => {
      const key = `${s.make}|${s.model}|${s.variant_normalised || ''}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });
    
    return Object.entries(groups).map(([key, items]) => {
      const [make, model, variant_normalised] = key.split('|');
      const withProfit = items.filter(i => i.gross_profit !== undefined);
      const withDays = items.filter(i => i.days_to_sell !== undefined);
      
      return {
        key,
        make,
        model,
        variant_normalised,
        count_sold: items.length,
        avg_gross_profit: withProfit.length > 0 
          ? withProfit.reduce((sum, i) => sum + (i.gross_profit || 0), 0) / withProfit.length 
          : 0,
        total_gross_profit: withProfit.reduce((sum, i) => sum + (i.gross_profit || 0), 0),
        avg_days_to_sell: withDays.length > 0
          ? withDays.reduce((sum, i) => sum + (i.days_to_sell || 0), 0) / withDays.length
          : 0,
      };
    }).sort((a, b) => b.total_gross_profit - a.total_gross_profit);
  }, [sales]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(sortedSales.map(s => s.sale_id)));
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
      gross_profit: sale.gross_profit?.toString() || '',
    });
  };

  const saveEdit = async (sale: SalesNormalised) => {
    try {
      await dataService.updateSalesNormalised({
        ...sale,
        variant_normalised: editValues.variant_normalised,
        notes: editValues.notes,
        gross_profit: editValues.gross_profit ? parseFloat(editValues.gross_profit) : undefined,
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

  // Bulk actions
  const bulkSetActivate = async (value: 'Y' | 'N') => {
    if (selectedIds.size === 0) return;
    setBulkUpdating(true);
    try {
      const idsToUpdate = Array.from(selectedIds);
      
      // First update all activate flags
      for (const id of idsToUpdate) {
        const sale = sales.find(s => s.sale_id === id);
        if (sale) {
          await dataService.updateSalesNormalised({ ...sale, activate: value });
        }
      }
      
      // If setting activate=Y, auto-generate fingerprints for eligible rows
      if (value === 'Y') {
        const eligibleIds = idsToUpdate.filter(id => {
          const sale = sales.find(s => s.sale_id === id);
          return sale && sale.do_not_replicate !== 'Y' && sale.fingerprint_generated !== 'Y';
        });
        
        if (eligibleIds.length > 0) {
          const result = await dataService.generateFingerprintsFromNormalised(eligibleIds);
          const totalGenerated = result.created + result.updated;
          toast({ 
            title: `Activated ${idsToUpdate.length} rows`,
            description: totalGenerated > 0 
              ? `${totalGenerated} fingerprints generated` 
              : undefined
          });
        } else {
          toast({ title: `Set ${selectedIds.size} rows to Activate=${value}` });
        }
      } else {
        toast({ title: `Set ${selectedIds.size} rows to Activate=${value}` });
      }
      
      setSelectedIds(new Set());
      loadData();
    } catch (error) {
      toast({ title: 'Error updating', variant: 'destructive' });
    } finally {
      setBulkUpdating(false);
    }
  };

  const bulkSetDoNotReplicate = async (value: 'Y' | 'N') => {
    if (selectedIds.size === 0) return;
    setBulkUpdating(true);
    try {
      for (const id of selectedIds) {
        const sale = sales.find(s => s.sale_id === id);
        if (sale) {
          await dataService.updateSalesNormalised({ ...sale, do_not_replicate: value });
        }
      }
      toast({ title: `Set ${selectedIds.size} rows to Do Not Replicate=${value}` });
      setSelectedIds(new Set());
      loadData();
    } catch (error) {
      toast({ title: 'Error updating', variant: 'destructive' });
    } finally {
      setBulkUpdating(false);
    }
  };

  const bulkAddTag = async () => {
    if (selectedIds.size === 0 || !newTag.trim()) return;
    setBulkUpdating(true);
    try {
      for (const id of selectedIds) {
        const sale = sales.find(s => s.sale_id === id);
        if (sale) {
          const existingTags = sale.tags ? sale.tags.split(',').map(t => t.trim()) : [];
          if (!existingTags.includes(newTag.trim())) {
            existingTags.push(newTag.trim());
          }
          await dataService.updateSalesNormalised({ ...sale, tags: existingTags.join(', ') });
        }
      }
      toast({ title: `Added tag "${newTag}" to ${selectedIds.size} rows` });
      setSelectedIds(new Set());
      setNewTag('');
      setTagDialogOpen(false);
      loadData();
    } catch (error) {
      toast({ title: 'Error adding tag', variant: 'destructive' });
    } finally {
      setBulkUpdating(false);
    }
  };

  const bulkSetDealerName = async () => {
    if (selectedIds.size === 0 || !newDealerName.trim()) return;
    setBulkUpdating(true);
    try {
      for (const id of selectedIds) {
        const sale = sales.find(s => s.sale_id === id);
        if (sale) {
          await dataService.updateSalesNormalised({ ...sale, dealer_name: newDealerName.trim() });
        }
      }
      toast({ title: `Set dealer to "${newDealerName}" on ${selectedIds.size} rows` });
      setSelectedIds(new Set());
      setNewDealerName('');
      setDealerDialogOpen(false);
      loadData();
    } catch (error) {
      toast({ title: 'Error setting dealer name', variant: 'destructive' });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleGenerateFingerprints = async () => {
    // Only generate from activate=Y AND do_not_replicate!=Y
    const eligibleIds = Array.from(selectedIds).filter(id => {
      const sale = sales.find(s => s.sale_id === id);
      return sale && sale.activate === 'Y' && sale.do_not_replicate !== 'Y';
    });

    if (eligibleIds.length === 0) {
      toast({ 
        title: 'No eligible sales', 
        description: 'Select rows with Activate=Y and Do Not Replicate!=Y',
        variant: 'destructive' 
      });
      return;
    }

    setGenerating(true);
    try {
      const result = await dataService.generateFingerprintsFromNormalised(eligibleIds);
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

  const applyPreset = (preset: string | null) => {
    setActivePreset(preset);
  };

  const filterByAggregation = (agg: VehicleAggregation) => {
    setFilters(f => ({
      ...f,
      make: agg.make,
      model: agg.model,
      variant: agg.variant_normalised,
    }));
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

  const allSelected = sortedSales.length > 0 && sortedSales.every(s => selectedIds.has(s.sale_id));
  const activatedCount = sales.filter(s => s.activate === 'Y').length;
  const doNotReplicateCount = sales.filter(s => s.do_not_replicate === 'Y').length;
  const fingerprintCount = sales.filter(s => s.fingerprint_generated === 'Y').length;
  const activatedWithoutFingerprint = sales.filter(s => 
    s.activate === 'Y' && 
    s.do_not_replicate !== 'Y' && 
    s.fingerprint_generated !== 'Y'
  ).length;

  const handleBackfillFingerprints = async () => {
    setBackfilling(true);
    try {
      const result = await dataService.backfillFingerprintsFromActivated();
      const totalGenerated = result.created + result.updated;
      toast({
        title: `${totalGenerated} fingerprints generated`,
        description: result.errors.length > 0 
          ? `${result.errors.length} errors occurred` 
          : undefined,
      });
      loadData();
    } catch (error) {
      toast({ title: 'Error backfilling fingerprints', variant: 'destructive' });
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Sales Review</h1>
            <p className="text-muted-foreground">Store all, Activate selected • Review imports and generate fingerprints</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {activatedWithoutFingerprint > 0 && (
              <Button onClick={handleBackfillFingerprints} disabled={backfilling}>
                <Fingerprint className={`h-4 w-4 mr-2 ${backfilling ? 'animate-pulse' : ''}`} />
                {backfilling ? 'Generating...' : `Backfill ${activatedWithoutFingerprint} Fingerprints`}
              </Button>
            )}
            <Button variant="outline" onClick={loadData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex gap-4 text-sm flex-wrap">
          <Badge variant="outline" className="px-3 py-1">
            Total: {sales.length}
          </Badge>
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 px-3 py-1">
            <Zap className="w-3 h-3 mr-1" /> Activated: {activatedCount}
          </Badge>
          <Badge className="bg-primary/20 text-primary border-primary/30 px-3 py-1">
            <Fingerprint className="w-3 h-3 mr-1" /> Fingerprints: {fingerprintCount}
          </Badge>
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 px-3 py-1">
            <Ban className="w-3 h-3 mr-1" /> Do Not Replicate: {doNotReplicateCount}
          </Badge>
        </div>

        {/* Presets */}
        <div className="flex gap-2">
          <Button 
            variant={activePreset === 'winners' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => applyPreset(activePreset === 'winners' ? null : 'winners')}
          >
            <TrendingUp className="h-4 w-4 mr-2" />
            Replicate Winners
          </Button>
          <Button 
            variant={activePreset === 'losers' ? 'destructive' : 'outline'} 
            size="sm"
            onClick={() => applyPreset(activePreset === 'losers' ? null : 'losers')}
          >
            <TrendingDown className="h-4 w-4 mr-2" />
            Find Repeat Losers
          </Button>
          {activePreset && (
            <Button variant="ghost" size="sm" onClick={() => applyPreset(null)}>
              Clear Preset
            </Button>
          )}
        </div>

        {/* Bulk Actions */}
        {selectedIds.size > 0 && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="py-3 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Button size="sm" onClick={() => bulkSetActivate('Y')} disabled={bulkUpdating}>
                <Zap className="h-3 w-3 mr-1" /> Set Activate
              </Button>
              <Button size="sm" variant="destructive" onClick={() => bulkSetDoNotReplicate('Y')} disabled={bulkUpdating}>
                <Ban className="h-3 w-3 mr-1" /> Do Not Replicate
              </Button>
              <Button size="sm" variant="outline" onClick={() => setTagDialogOpen(true)} disabled={bulkUpdating}>
                <Tag className="h-3 w-3 mr-1" /> Add Tag
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                setNewDealerName(currentUser?.dealer_name || '');
                setDealerDialogOpen(true);
              }} disabled={bulkUpdating}>
                <UserCircle className="h-3 w-3 mr-1" /> Set Dealer
              </Button>
              <Button 
                size="sm"
                onClick={handleGenerateFingerprints} 
                disabled={generating || bulkUpdating}
              >
                <Fingerprint className="h-4 w-4 mr-1" />
                {generating ? 'Generating...' : 'Generate Fingerprints'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                Clear Selection
              </Button>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="sales" className="w-full">
          <TabsList>
            <TabsTrigger value="sales">Sales ({sortedSales.length})</TabsTrigger>
            <TabsTrigger value="aggregations">
              <BarChart3 className="h-4 w-4 mr-1" />
              Mistake Detection ({aggregations.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sales" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filters
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                  <Select value={filters.importId} onValueChange={(v) => setFilters(f => ({ ...f, importId: v === 'all' ? '' : v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Import ID" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Imports</SelectItem>
                      {filterOptions.importIds.map(id => (
                        <SelectItem key={id} value={id}>{id.slice(-12)}</SelectItem>
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

                  <Select value={filters.make} onValueChange={(v) => setFilters(f => ({ ...f, make: v === 'all' ? '' : v, model: '', variant: '' }))}>
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

                  <Select value={filters.model} onValueChange={(v) => setFilters(f => ({ ...f, model: v === 'all' ? '' : v, variant: '' }))}>
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

                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="activateOnly"
                      checked={filters.activateOnly}
                      onCheckedChange={(c) => setFilters(f => ({ ...f, activateOnly: !!c }))}
                    />
                    <label htmlFor="activateOnly" className="text-sm">Activated only</label>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="dnrOnly"
                      checked={filters.doNotReplicateOnly}
                      onCheckedChange={(c) => setFilters(f => ({ ...f, doNotReplicateOnly: !!c }))}
                    />
                    <label htmlFor="dnrOnly" className="text-sm">DNR only</label>
                  </div>
                </div>
                {(filters.variant || filters.activateOnly || filters.doNotReplicateOnly) && (
                  <div className="mt-3 flex gap-2">
                    {filters.variant && (
                      <Badge variant="secondary" className="cursor-pointer" onClick={() => setFilters(f => ({ ...f, variant: '' }))}>
                        Variant: {filters.variant} ×
                      </Badge>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setFilters(f => ({ ...f, variant: '', activateOnly: false, doNotReplicateOnly: false }))}>
                      Clear All
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox 
                            checked={allSelected}
                            onCheckedChange={handleSelectAll}
                            disabled={sortedSales.length === 0}
                          />
                        </TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead>Variant</TableHead>
                        <TableHead>KM</TableHead>
                        <TableHead>Gross Profit</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Tags</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedSales.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                            {loading ? 'Loading...' : 'No sales found. Import a CSV to get started.'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedSales.map((sale) => (
                          <TableRow 
                            key={sale.sale_id} 
                            className={`${selectedIds.has(sale.sale_id) ? 'bg-primary/5' : ''} ${sale.do_not_replicate === 'Y' ? 'opacity-50' : ''}`}
                          >
                            <TableCell>
                              <Checkbox 
                                checked={selectedIds.has(sale.sale_id)}
                                onCheckedChange={(checked) => handleSelectOne(sale.sale_id, !!checked)}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{sale.year} {sale.make} {sale.model}</div>
                              <div className="text-xs text-muted-foreground">{sale.dealer_name} • {sale.sale_date}</div>
                            </TableCell>
                            <TableCell>
                              {editingId === sale.sale_id ? (
                                <Input
                                  value={editValues.variant_normalised}
                                  onChange={(e) => setEditValues(v => ({ ...v, variant_normalised: e.target.value }))}
                                  className="h-8 w-28"
                                />
                              ) : (
                                <span className="text-sm">{sale.variant_normalised || '-'}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {sale.km ? sale.km.toLocaleString() : <span className="text-muted-foreground text-xs">spec_only</span>}
                            </TableCell>
                            <TableCell>
                              {editingId === sale.sale_id ? (
                                <Input
                                  value={editValues.gross_profit}
                                  onChange={(e) => setEditValues(v => ({ ...v, gross_profit: e.target.value }))}
                                  className="h-8 w-24"
                                  placeholder="0"
                                />
                              ) : sale.gross_profit !== undefined ? (
                                <span className={sale.gross_profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                  {formatCurrency(sale.gross_profit)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {sale.days_to_sell ?? <span className="text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1 flex-wrap">
                                {sale.activate === 'Y' && (
                                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                                    <Zap className="w-2 h-2 mr-0.5" />Active
                                  </Badge>
                                )}
                                {sale.do_not_replicate === 'Y' && (
                                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                                    <Ban className="w-2 h-2 mr-0.5" />DNR
                                  </Badge>
                                )}
                                {sale.fingerprint_generated === 'Y' && (
                                  <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                                    <Fingerprint className="w-2 h-2" />
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground truncate max-w-[100px] block">
                                {sale.tags || '-'}
                              </span>
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
          </TabsContent>

          <TabsContent value="aggregations" className="space-y-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Vehicle Performance Analysis</CardTitle>
                <p className="text-xs text-muted-foreground">Click a row to filter sales and bulk-tag</p>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead>Make</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Variant</TableHead>
                        <TableHead className="text-right">Count Sold</TableHead>
                        <TableHead className="text-right">Avg Profit</TableHead>
                        <TableHead className="text-right">Total Profit</TableHead>
                        <TableHead className="text-right">Avg Days</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aggregations.map((agg) => (
                        <TableRow 
                          key={agg.key} 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => filterByAggregation(agg)}
                        >
                          <TableCell className="font-medium">{agg.make}</TableCell>
                          <TableCell>{agg.model}</TableCell>
                          <TableCell>{agg.variant_normalised || '-'}</TableCell>
                          <TableCell className="text-right">{agg.count_sold}</TableCell>
                          <TableCell className={`text-right ${agg.avg_gross_profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {formatCurrency(agg.avg_gross_profit)}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${agg.total_gross_profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {formatCurrency(agg.total_gross_profit)}
                          </TableCell>
                          <TableCell className="text-right">{agg.avg_days_to_sell.toFixed(0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Tag Dialog */}
        <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Tag to {selectedIds.size} Sales</DialogTitle>
            </DialogHeader>
            <Input
              placeholder="Tag name (e.g., 'Repeat loser', 'Quick flip')"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setTagDialogOpen(false)}>Cancel</Button>
              <Button onClick={bulkAddTag} disabled={!newTag.trim() || bulkUpdating}>
                Add Tag
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dealer Name Dialog */}
        <Dialog open={dealerDialogOpen} onOpenChange={setDealerDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set Dealer Name for {selectedIds.size} Sales</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Select value={newDealerName} onValueChange={setNewDealerName}>
                <SelectTrigger>
                  <SelectValue placeholder="Select dealer" />
                </SelectTrigger>
                <SelectContent>
                  {dealers.map(dealer => (
                    <SelectItem key={dealer} value={dealer}>{dealer}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDealerDialogOpen(false)}>Cancel</Button>
              <Button onClick={bulkSetDealerName} disabled={!newDealerName.trim() || bulkUpdating}>
                Set Dealer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
