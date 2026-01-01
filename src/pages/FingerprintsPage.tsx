import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { dataService } from '@/services/dataService';
import { SaleFingerprint, formatNumber } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { format, differenceInDays } from 'date-fns';
import { Fingerprint, XCircle, Clock, Users, RefreshCw } from 'lucide-react';

export default function FingerprintsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [fingerprints, setFingerprints] = useState<SaleFingerprint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isReactivating, setIsReactivating] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);

  const loadFingerprints = async () => {
    setIsLoading(true);
    try {
      const fps = await dataService.getFingerprints();
      setFingerprints(fps);
    } catch (error) {
      console.error('Failed to load fingerprints:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFingerprints();
  }, []);

  const handleDeactivate = async (fingerprintId: string) => {
    try {
      await dataService.deactivateFingerprint(fingerprintId);
      toast({
        title: "Fingerprint deactivated",
        description: "This fingerprint will no longer match opportunities.",
      });
      loadFingerprints();
    } catch (error) {
      toast({
        title: "Failed to deactivate",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleReactivateSelected = async () => {
    if (selectedIds.size === 0) return;
    
    setIsReactivating(true);
    try {
      const result = await dataService.reactivateFingerprints(Array.from(selectedIds));
      toast({
        title: "Fingerprints reactivated",
        description: `${result.reactivated} fingerprint(s) reactivated with 120-day expiry from today.${result.failed > 0 ? ` ${result.failed} failed.` : ''}`,
      });
      setSelectedIds(new Set());
      loadFingerprints();
    } catch (error) {
      toast({
        title: "Failed to reactivate",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsReactivating(false);
    }
  };

  const handleBackfillMinKm = async () => {
    setIsBackfilling(true);
    try {
      const result = await dataService.backfillMinKm();
      toast({
        title: "KM ranges updated",
        description: `${result.updated} fingerprint(s) updated with symmetric KM ranges.${result.skipped > 0 ? ` ${result.skipped} already correct.` : ''}`,
      });
      loadFingerprints();
    } catch (error) {
      toast({
        title: "Failed to backfill",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsBackfilling(false);
    }
  };

  const getDaysRemaining = (expiresAt: string) => {
    const days = differenceInDays(new Date(expiresAt), new Date());
    return days;
  };

  const isHistoricalImport = (fp: SaleFingerprint) => {
    // If it has import_id or source is from CSV, it's historical
    return !!fp.source_import_id;
  };

  const getStatusInfo = (fp: SaleFingerprint) => {
    const daysRemaining = getDaysRemaining(fp.expires_at);
    const isExpired = daysRemaining < 0;
    const isActive = fp.is_active === 'Y' && !isExpired;
    const isHistorical = isHistoricalImport(fp);

    if (isActive) {
      return { label: 'Active', variant: 'default' as const, canReactivate: false };
    }
    if (isExpired && isHistorical) {
      return { 
        label: 'Expired (historical)', 
        variant: 'outline' as const, 
        canReactivate: true,
        tooltip: 'This fingerprint was created from a historical CSV import and can be reactivated.'
      };
    }
    if (isExpired) {
      return { label: 'Expired', variant: 'outline' as const, canReactivate: true };
    }
    return { label: 'Inactive', variant: 'outline' as const, canReactivate: true };
  };

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    const reactivatable = fingerprints.filter(fp => getStatusInfo(fp).canReactivate);
    if (selectedIds.size === reactivatable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(reactivatable.map(fp => fp.fingerprint_id)));
    }
  };

  // Get counts
  const reactivatableFingerprints = fingerprints.filter(fp => getStatusInfo(fp).canReactivate);
  const expiredHistoricalCount = fingerprints.filter(fp => {
    const daysRemaining = getDaysRemaining(fp.expires_at);
    return daysRemaining < 0 && isHistoricalImport(fp);
  }).length;

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="p-6 flex items-center justify-center min-h-[50vh]">
          <p className="text-muted-foreground">Admin access required</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <Fingerprint className="h-6 w-6 text-primary" />
              Sale Fingerprints
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage active fingerprints for matching auction opportunities
            </p>
          </div>
          
          {/* Bulk actions */}
          <div className="flex items-center gap-3">
            {selectedIds.size > 0 && (
              <>
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size} selected
                </span>
                <Button 
                  onClick={handleReactivateSelected}
                  disabled={isReactivating}
                  size="sm"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isReactivating ? 'animate-spin' : ''}`} />
                  Reactivate Selected
                </Button>
              </>
            )}
            <Button 
              onClick={handleBackfillMinKm}
              disabled={isBackfilling}
              variant="outline"
              size="sm"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isBackfilling ? 'animate-spin' : ''}`} />
              Backfill KM Ranges
            </Button>
          </div>
        </div>

        {/* Info banner for expired historical */}
        {expiredHistoricalCount > 0 && (
          <div className="bg-muted/50 border border-border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">
              <strong>{expiredHistoricalCount}</strong> fingerprint(s) from historical CSV imports are expired. 
              Select them and click "Reactivate Selected" to set their expiry to 120 days from today.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="bg-card border border-border rounded-lg p-8 animate-pulse">
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded" />
              ))}
            </div>
          </div>
        ) : fingerprints.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-12 text-center">
            <Fingerprint className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No fingerprints yet. Log a sale to create one.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="table-header-cell w-10">
                    <Checkbox 
                      checked={selectedIds.size === reactivatableFingerprints.length && reactivatableFingerprints.length > 0}
                      onCheckedChange={toggleSelectAll}
                      disabled={reactivatableFingerprints.length === 0}
                    />
                  </TableHead>
                  <TableHead className="table-header-cell">Status</TableHead>
                  <TableHead className="table-header-cell">Dealer</TableHead>
                  <TableHead className="table-header-cell">Vehicle</TableHead>
                  <TableHead className="table-header-cell">Specs</TableHead>
                  <TableHead className="table-header-cell text-right">KM Range</TableHead>
                  <TableHead className="table-header-cell text-right">Days Left</TableHead>
                  <TableHead className="table-header-cell text-center">Shared</TableHead>
                  <TableHead className="table-header-cell text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fingerprints.map((fp) => {
                  const daysRemaining = getDaysRemaining(fp.expires_at);
                  const statusInfo = getStatusInfo(fp);
                  const isActive = statusInfo.label === 'Active';

                  return (
                    <TableRow key={fp.fingerprint_id} className="border-b border-border">
                      <TableCell>
                        <Checkbox 
                          checked={selectedIds.has(fp.fingerprint_id)}
                          onCheckedChange={() => toggleSelection(fp.fingerprint_id)}
                          disabled={!statusInfo.canReactivate}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusInfo.variant} title={statusInfo.tooltip}>
                          {statusInfo.label}
                        </Badge>
                        {fp.fingerprint_type === 'spec_only' && (
                          <Badge variant="outline" className="ml-1 text-xs">spec only</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{fp.dealer_name}</p>
                          <p className="text-xs text-muted-foreground mono">{fp.fingerprint_id}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">
                            {fp.year} {fp.make} {fp.model}
                          </p>
                          <p className="text-xs text-muted-foreground">{fp.variant_normalised}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="space-y-0.5">
                          <p>{fp.engine || '-'}</p>
                          <p>{fp.drivetrain || '-'} • {fp.transmission || '-'}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right mono text-sm">
                        {fp.fingerprint_type === 'spec_only' ? (
                          <span className="text-muted-foreground">Any</span>
                        ) : (
                          <>
                            <span className="text-muted-foreground">{formatNumber(fp.min_km)}</span>
                            <span className="text-muted-foreground mx-1">–</span>
                            <span className="text-foreground">{formatNumber(fp.max_km)}</span>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isActive ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className={`mono font-medium ${daysRemaining <= 14 ? 'text-action-watch' : 'text-foreground'}`}>
                              {daysRemaining}
                            </span>
                          </div>
                        ) : daysRemaining < 0 ? (
                          <span className="text-muted-foreground mono text-sm">
                            {daysRemaining}d
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {fp.shared_opt_in === 'Y' ? (
                          <Users className="h-4 w-4 text-primary mx-auto" />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isActive && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="iconSm" className="text-muted-foreground hover:text-destructive">
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="bg-card border-border">
                              <AlertDialogHeader>
                                <AlertDialogTitle>Deactivate Fingerprint?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will stop matching opportunities for {fp.year} {fp.make} {fp.model}. 
                                  This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeactivate(fp.fingerprint_id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Deactivate
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}