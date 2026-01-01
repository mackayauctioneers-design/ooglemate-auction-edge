import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { googleSheetsService } from '@/services/googleSheetsService';
import { supabase } from '@/integrations/supabase/client';
import { SavedSearch, AuctionLot, SavedSearchRunLog } from '@/types';
import { Plus, Pencil, Trash2, Play, Loader2, ExternalLink, Clock, RefreshCw, PlayCircle, AlertCircle, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function SavedSearchesPage() {
  useDocumentTitle(0);
  const { isAdmin } = useAuth();
  
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSearch, setEditingSearch] = useState<SavedSearch | null>(null);
  const [runningSearchId, setRunningSearchId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [lastRunError, setLastRunError] = useState<Record<string, string>>({});
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [searchToDelete, setSearchToDelete] = useState<SavedSearch | null>(null);
  
  // Run log drawer state
  const [runLogDrawerOpen, setRunLogDrawerOpen] = useState(false);
  const [selectedRunLog, setSelectedRunLog] = useState<SavedSearchRunLog | null>(null);
  const [selectedSearchLabel, setSelectedSearchLabel] = useState('');
  
  // Form state
  const [formData, setFormData] = useState({
    source_site: 'Pickles' as 'Pickles' | 'Manheim' | 'Other',
    label: '',
    search_url: '',
    refresh_frequency_hours: 12,
    max_pages: 2,
    enabled: true,
    notes: '',
  });

  // Redirect non-admins
  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">This page is only accessible to admins.</p>
        </div>
      </AppLayout>
    );
  }

  useEffect(() => {
    loadSearches();
  }, []);

  async function loadSearches() {
    setLoading(true);
    try {
      const data = await googleSheetsService.getSavedSearches();
      setSearches(data);
    } catch (error) {
      console.error('Failed to load saved searches:', error);
      toast.error('Failed to load saved searches');
    } finally {
      setLoading(false);
    }
  }

  function openAddDialog() {
    setEditingSearch(null);
    setFormData({
      source_site: 'Pickles',
      label: '',
      search_url: '',
      refresh_frequency_hours: 12,
      max_pages: 2,
      enabled: true,
      notes: '',
    });
    setDialogOpen(true);
  }

  function openEditDialog(search: SavedSearch) {
    setEditingSearch(search);
    setFormData({
      source_site: search.source_site,
      label: search.label,
      search_url: search.search_url,
      refresh_frequency_hours: search.refresh_frequency_hours,
      max_pages: search.max_pages,
      enabled: search.enabled === 'Y',
      notes: search.notes,
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!formData.label.trim() || !formData.search_url.trim()) {
      toast.error('Label and Search URL are required');
      return;
    }

    try {
      if (editingSearch) {
        // Update existing
        const updated: SavedSearch = {
          ...editingSearch,
          ...formData,
          enabled: formData.enabled ? 'Y' : 'N',
        };
        await googleSheetsService.updateSavedSearch(updated);
        toast.success('Saved search updated');
      } else {
        // Add new
        await googleSheetsService.addSavedSearch({
          ...formData,
          enabled: formData.enabled ? 'Y' : 'N',
          last_run_at: '',
        });
        toast.success('Saved search added');
      }
      setDialogOpen(false);
      loadSearches();
    } catch (error) {
      console.error('Failed to save search:', error);
      toast.error('Failed to save search');
    }
  }

  function confirmDelete(search: SavedSearch) {
    setSearchToDelete(search);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!searchToDelete) return;
    
    try {
      await googleSheetsService.deleteSavedSearch(searchToDelete);
      toast.success('Saved search deleted');
      setDeleteConfirmOpen(false);
      setSearchToDelete(null);
      loadSearches();
    } catch (error) {
      console.error('Failed to delete search:', error);
      toast.error('Failed to delete search');
    }
  }

  async function toggleEnabled(search: SavedSearch) {
    try {
      const updated: SavedSearch = {
        ...search,
        enabled: search.enabled === 'Y' ? 'N' : 'Y',
      };
      await googleSheetsService.updateSavedSearch(updated);
      toast.success(`Search ${updated.enabled === 'Y' ? 'enabled' : 'disabled'}`);
      loadSearches();
    } catch (error) {
      console.error('Failed to toggle search:', error);
      toast.error('Failed to update search');
    }
  }

  async function runSearchNow(search: SavedSearch): Promise<{ added: number; updated: number; error?: string; runLog?: SavedSearchRunLog }> {
    setRunningSearchId(search.search_id);
    setLastRunError(prev => ({ ...prev, [search.search_id]: '' }));
    
    try {
      // Call edge function to fetch and parse listings
      const { data: result, error } = await supabase.functions.invoke('run-saved-search', {
        body: {
          searchId: search.search_id,
          label: search.label,
          searchUrl: search.search_url,
          sourceSite: search.source_site,
          maxPages: search.max_pages,
        },
      });
      
      if (error) {
        throw new Error(error.message || 'Failed to run search');
      }
      
      // Convert parsed listings to AuctionLot format and upsert
      const listings = result.listings || [];
      let added = 0;
      let updated = 0;
      
      if (listings.length > 0) {
        const lotsToUpsert: Partial<AuctionLot>[] = listings.map((listing: any) => ({
          listing_id: `${search.source_site}:${listing.lot_id || simpleHash(listing.listing_url)}`,
          lot_id: listing.lot_id || '',
          listing_url: listing.listing_url,
          source: 'auction' as const,
          source_type: 'auction' as const,
          source_site: search.source_site,
          source_name: search.source_site,
          auction_house: search.source_site,
          make: listing.make || '',
          model: listing.model || '',
          variant_raw: listing.title || '',
          year: listing.year || 0,
          km: listing.km || 0,
          price_current: listing.price || 0,
          reserve: listing.price || 0,
          status: 'listed' as const,
        }));
        
        const upsertResult = await googleSheetsService.upsertLots(lotsToUpsert);
        added = upsertResult.added;
        updated = upsertResult.updated;
      }
      
      // Update search with diagnostics
      const diagnostics: {
        last_run_status: 'success' | 'failed';
        last_http_status: number;
        last_listings_found: number;
        last_listings_upserted: number;
        last_error_message: string;
      } = {
        last_run_status: result.success ? 'success' : 'failed',
        last_http_status: result.httpStatus || 0,
        last_listings_found: result.listingsFound || 0,
        last_listings_upserted: added + updated,
        last_error_message: result.error || '',
      };
      
      await googleSheetsService.updateSavedSearchDiagnostics(search.search_id, diagnostics);
      
      // Build run log
      const runLog: SavedSearchRunLog = result.runLog || {
        searchId: search.search_id,
        fetchedUrl: search.search_url,
        httpStatus: result.httpStatus || 0,
        responseSize: 0,
        htmlPreview: '',
        listingUrlsSample: [],
      };
      
      if (!result.success) {
        const errorMessage = result.error || 'Search returned no results';
        setLastRunError(prev => ({ ...prev, [search.search_id]: errorMessage }));
        toast.error(`Run failed: ${errorMessage}`);
        return { added: 0, updated: 0, error: errorMessage, runLog };
      }
      
      if (added > 0 || updated > 0) {
        toast.success(`Saved Search ran: ${added} listings added, ${updated} updated`);
      } else if (listings.length === 0) {
        toast.info(`Saved Search ran: no listings found`);
      } else {
        toast.info(`Saved Search ran: no new listings`);
      }
      
      await loadSearches();
      return { added, updated, runLog };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to run search:', error);
      setLastRunError(prev => ({ ...prev, [search.search_id]: errorMessage }));
      
      // Update diagnostics with error
      try {
        const errorDiagnostics: {
          last_run_status: 'success' | 'failed';
          last_http_status: number;
          last_listings_found: number;
          last_listings_upserted: number;
          last_error_message: string;
        } = {
          last_run_status: 'failed',
          last_http_status: 0,
          last_listings_found: 0,
          last_listings_upserted: 0,
          last_error_message: errorMessage,
        };
        await googleSheetsService.updateSavedSearchDiagnostics(search.search_id, errorDiagnostics);
      } catch (e) {
        console.error('Failed to update diagnostics:', e);
      }
      
      toast.error(`Run failed: ${errorMessage}`);
      return { added: 0, updated: 0, error: errorMessage };
    } finally {
      setRunningSearchId(null);
    }
  }
  
  // Simple hash for generating listing IDs from URLs
  function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
  
  async function runAllEnabled() {
    const enabledSearches = searches.filter(s => s.enabled === 'Y');
    
    if (enabledSearches.length === 0) {
      toast.info('No enabled searches to run');
      return;
    }
    
    setRunningAll(true);
    let totalAdded = 0;
    let totalUpdated = 0;
    let failedCount = 0;
    
    for (const search of enabledSearches) {
      const result = await runSearchNow(search);
      if (result.error) {
        failedCount++;
      } else {
        totalAdded += result.added;
        totalUpdated += result.updated;
      }
    }
    
    setRunningAll(false);
    
    if (failedCount > 0) {
      toast.warning(`Completed: ${totalAdded} added, ${totalUpdated} updated. ${failedCount} search(es) failed.`);
    } else {
      toast.success(`All searches complete: ${totalAdded} added, ${totalUpdated} updated`);
    }
  }

  function formatLastRun(dateStr: string): string {
    if (!dateStr) return 'Never';
    try {
      return format(new Date(dateStr), 'dd MMM yyyy HH:mm');
    } catch {
      return 'Invalid date';
    }
  }

  function openRunLogDrawer(search: SavedSearch) {
    // Build run log from last run data
    const runLog: SavedSearchRunLog = {
      searchId: search.search_id,
      fetchedUrl: search.search_url,
      httpStatus: search.last_http_status || 0,
      responseSize: 0,
      htmlPreview: search.last_run_status === 'failed' 
        ? (search.last_error_message || 'No details available')
        : 'Run log only available immediately after execution',
      listingUrlsSample: [],
    };
    
    setSelectedRunLog(runLog);
    setSelectedSearchLabel(search.label);
    setRunLogDrawerOpen(true);
  }

  function getStatusBadge(search: SavedSearch) {
    if (!search.last_run_status) {
      return <Badge variant="outline" className="text-muted-foreground">Not run</Badge>;
    }
    
    if (search.last_run_status === 'success') {
      return (
        <Badge variant="default" className="bg-green-600/10 text-green-600 hover:bg-green-600/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Success
        </Badge>
      );
    }
    
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="destructive" className="bg-destructive/10 text-destructive hover:bg-destructive/20">
              <XCircle className="h-3 w-3 mr-1" />
              Failed
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs">{search.last_error_message || 'Unknown error'}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <AppLayout>
      <div className="container max-w-7xl py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Saved Searches</h1>
            <p className="text-muted-foreground">
              Manage automated search URLs for auction ingestion
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="secondary" 
              onClick={runAllEnabled} 
              disabled={runningAll || loading || searches.filter(s => s.enabled === 'Y').length === 0}
            >
              {runningAll ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4 mr-2" />
              )}
              Run All Enabled
            </Button>
            <Button variant="outline" onClick={loadSearches} disabled={loading || runningAll}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={openAddDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Add Search
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Searches</CardDescription>
              <CardTitle className="text-3xl">{searches.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Enabled</CardDescription>
              <CardTitle className="text-3xl text-green-600">
                {searches.filter(s => s.enabled === 'Y').length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Last Run Success</CardDescription>
              <CardTitle className="text-3xl text-green-600">
                {searches.filter(s => s.last_run_status === 'success').length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Last Run Failed</CardDescription>
              <CardTitle className="text-3xl text-destructive">
                {searches.filter(s => s.last_run_status === 'failed').length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Searches Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : searches.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 space-y-3">
                <p className="text-muted-foreground">No saved searches yet</p>
                <Button onClick={openAddDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Search
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Last Run</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">HTTP</TableHead>
                      <TableHead className="text-center">Found</TableHead>
                      <TableHead className="text-center">Upserted</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searches.map((search) => (
                      <TableRow key={search.search_id}>
                        <TableCell>
                          <div className="space-y-1">
                            <span className="font-medium">{search.label}</span>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <a
                                href={search.search_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-primary flex items-center gap-1 truncate max-w-[200px]"
                              >
                                {search.search_url.length > 40 
                                  ? search.search_url.substring(0, 40) + '...' 
                                  : search.search_url}
                                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                              </a>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            search.source_site === 'Pickles' ? 'default' :
                            search.source_site === 'Manheim' ? 'secondary' : 'outline'
                          }>
                            {search.source_site}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {formatLastRun(search.last_run_at)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(search)}
                        </TableCell>
                        <TableCell className="text-center">
                          {search.last_http_status ? (
                            <Badge 
                              variant="outline" 
                              className={
                                search.last_http_status === 200 ? 'text-green-600 border-green-600/30' :
                                search.last_http_status >= 400 ? 'text-destructive border-destructive/30' : ''
                              }
                            >
                              {search.last_http_status}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {search.last_listings_found !== undefined ? (
                            <span className="font-medium">{search.last_listings_found}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {search.last_listings_upserted !== undefined ? (
                            <span className="font-medium">{search.last_listings_upserted}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={search.enabled === 'Y'}
                            onCheckedChange={() => toggleEnabled(search)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="iconSm"
                                    onClick={() => runSearchNow(search)}
                                    disabled={runningSearchId === search.search_id || runningAll}
                                    className={lastRunError[search.search_id] ? 'text-destructive' : ''}
                                  >
                                    {runningSearchId === search.search_id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : lastRunError[search.search_id] ? (
                                      <AlertCircle className="h-4 w-4" />
                                    ) : (
                                      <Play className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {lastRunError[search.search_id] 
                                    ? `Run failed: ${lastRunError[search.search_id]}`
                                    : 'Run now'
                                  }
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="iconSm"
                                    onClick={() => openRunLogDrawer(search)}
                                    disabled={!search.last_run_at}
                                  >
                                    <FileText className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>View run log</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <Button
                              variant="ghost"
                              size="iconSm"
                              onClick={() => openEditDialog(search)}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="iconSm"
                              onClick={() => confirmDelete(search)}
                              title="Delete"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">How Saved Searches Work</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              • Click <strong>Run now</strong> to fetch and parse listings from a search URL using simple HTTP fetch.
            </p>
            <p>
              • Each listing found is assigned a stable <code className="bg-muted px-1 rounded">listing_id</code> and upserted into the Listings table.
            </p>
            <p>
              • Listings participate in pass_count tracking, price monitoring, and fingerprint matching.
            </p>
            <p>
              • <strong>Run All Enabled</strong> executes all enabled searches sequentially and shows a summary.
            </p>
            <p>
              • If a page cannot be fetched (blocked/timeout), the search fails silently - use Manual Add Listing instead.
            </p>
            <p>
              • <strong>Run diagnostics</strong> show HTTP status, listings found, and upserted count for each run.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingSearch ? 'Edit Saved Search' : 'Add Saved Search'}</DialogTitle>
            <DialogDescription>
              Configure a search URL for automated auction ingestion.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="label">Label *</Label>
              <Input
                id="label"
                placeholder="e.g. Sydney Pickles - Light Commercial"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="source_site">Source Site *</Label>
              <Select
                value={formData.source_site}
                onValueChange={(v) => setFormData({ ...formData, source_site: v as any })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pickles">Pickles</SelectItem>
                  <SelectItem value="Manheim">Manheim</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="search_url">Search URL *</Label>
              <Input
                id="search_url"
                placeholder="https://www.pickles.com.au/cars/..."
                value={formData.search_url}
                onChange={(e) => setFormData({ ...formData, search_url: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="refresh_hours">Refresh Frequency (hours)</Label>
                <Input
                  id="refresh_hours"
                  type="number"
                  min="1"
                  value={formData.refresh_frequency_hours}
                  onChange={(e) => setFormData({ ...formData, refresh_frequency_hours: parseInt(e.target.value) || 12 })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="max_pages">Max Pages</Label>
                <Input
                  id="max_pages"
                  type="number"
                  min="1"
                  max="10"
                  value={formData.max_pages}
                  onChange={(e) => setFormData({ ...formData, max_pages: parseInt(e.target.value) || 2 })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any notes about this search..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="enabled"
                checked={formData.enabled}
                onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
              />
              <Label htmlFor="enabled">Enable this search</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {editingSearch ? 'Update' : 'Add'} Search
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Saved Search</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{searchToDelete?.label}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run Log Drawer */}
      <Sheet open={runLogDrawerOpen} onOpenChange={setRunLogDrawerOpen}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Run Log: {selectedSearchLabel}</SheetTitle>
            <SheetDescription>
              Diagnostic information from the last search execution
            </SheetDescription>
          </SheetHeader>
          
          {selectedRunLog && (
            <ScrollArea className="h-[calc(100vh-10rem)] mt-6">
              <div className="space-y-6 pr-4">
                {/* Fetched URL */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Fetched URL</Label>
                  <div className="mt-1 p-3 bg-muted rounded-md">
                    <a 
                      href={selectedRunLog.fetchedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline break-all"
                    >
                      {selectedRunLog.fetchedUrl}
                    </a>
                  </div>
                </div>

                {/* HTTP Status */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">HTTP Status</Label>
                  <div className="mt-1">
                    <Badge 
                      variant="outline" 
                      className={
                        selectedRunLog.httpStatus === 200 ? 'text-green-600 border-green-600/30' :
                        selectedRunLog.httpStatus >= 400 ? 'text-destructive border-destructive/30' :
                        selectedRunLog.httpStatus === 0 ? 'text-muted-foreground' : ''
                      }
                    >
                      {selectedRunLog.httpStatus || 'No response'}
                    </Badge>
                  </div>
                </div>

                {/* Response Size */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Response Size</Label>
                  <div className="mt-1 text-sm">
                    {selectedRunLog.responseSize > 0 
                      ? `${(selectedRunLog.responseSize / 1024).toFixed(1)} KB`
                      : 'Unknown'
                    }
                  </div>
                </div>

                {/* HTML Preview */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">HTML Preview (first 300 chars)</Label>
                  <div className="mt-1 p-3 bg-muted rounded-md">
                    <pre className="text-xs whitespace-pre-wrap break-all font-mono">
                      {selectedRunLog.htmlPreview || '(no content)'}
                    </pre>
                  </div>
                </div>

                {/* Listing URLs Sample */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Parsed Listing URLs (first 10)
                  </Label>
                  <div className="mt-1 space-y-1">
                    {selectedRunLog.listingUrlsSample.length > 0 ? (
                      selectedRunLog.listingUrlsSample.map((url, i) => (
                        <div key={i} className="p-2 bg-muted rounded text-xs">
                          <a 
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline break-all"
                          >
                            {url}
                          </a>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No listing URLs available. Run the search to capture this data.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
