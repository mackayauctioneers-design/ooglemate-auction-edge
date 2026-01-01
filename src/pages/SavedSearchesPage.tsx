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
import { googleSheetsService } from '@/services/googleSheetsService';
import { SavedSearch } from '@/types';
import { Plus, Pencil, Trash2, Play, Loader2, ExternalLink, Clock, RefreshCw } from 'lucide-react';
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [searchToDelete, setSearchToDelete] = useState<SavedSearch | null>(null);
  
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

  async function runSearchNow(search: SavedSearch) {
    setRunningSearchId(search.search_id);
    try {
      // For now, just update last_run_at - actual scraping would be done by a backend job
      await googleSheetsService.updateSavedSearchLastRun(search.search_id);
      toast.success(`Search "${search.label}" marked as run. Scraping integration pending.`);
      loadSearches();
    } catch (error) {
      console.error('Failed to run search:', error);
      toast.error('Failed to run search');
    } finally {
      setRunningSearchId(null);
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

  return (
    <AppLayout>
      <div className="container max-w-6xl py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Saved Searches</h1>
            <p className="text-muted-foreground">
              Manage automated search URLs for auction ingestion
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={loadSearches} disabled={loading}>
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <CardDescription>Disabled</CardDescription>
              <CardTitle className="text-3xl text-muted-foreground">
                {searches.filter(s => s.enabled === 'N').length}
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Max Pages</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Status</TableHead>
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
                        <div className="flex items-center gap-1 text-sm">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          {search.refresh_frequency_hours}h
                        </div>
                      </TableCell>
                      <TableCell>{search.max_pages}</TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {formatLastRun(search.last_run_at)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={search.enabled === 'Y'}
                          onCheckedChange={() => toggleEnabled(search)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="iconSm"
                            onClick={() => runSearchNow(search)}
                            disabled={runningSearchId === search.search_id}
                            title="Run now"
                          >
                            {runningSearchId === search.search_id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
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
              • Enabled searches are polled automatically based on their refresh frequency.
            </p>
            <p>
              • Each listing found is assigned a stable <code className="bg-muted px-1 rounded">listing_id</code> and upserted into the Listings table.
            </p>
            <p>
              • Listings participate in pass_count tracking, price monitoring, and fingerprint matching.
            </p>
            <p>
              • Use "Run now" to trigger an immediate fetch (scraping integration pending).
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
    </AppLayout>
  );
}