import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { dataService } from '@/services/mockData';
import { SaleFingerprint, formatNumber } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Fingerprint, XCircle, Clock, Users } from 'lucide-react';

export default function FingerprintsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [fingerprints, setFingerprints] = useState<SaleFingerprint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

  const getDaysRemaining = (expiresAt: string) => {
    const days = differenceInDays(new Date(expiresAt), new Date());
    return Math.max(0, days);
  };

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
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Fingerprint className="h-6 w-6 text-primary" />
            Sale Fingerprints
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage active fingerprints for matching auction opportunities
          </p>
        </div>

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
                  const isExpired = daysRemaining === 0;
                  const isActive = fp.is_active === 'Y' && !isExpired;

                  return (
                    <TableRow key={fp.fingerprint_id} className="border-b border-border">
                      <TableCell>
                        <Badge variant={isActive ? 'default' : 'outline'}>
                          {isActive ? 'Active' : isExpired ? 'Expired' : 'Inactive'}
                        </Badge>
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
                          <p>{fp.engine}</p>
                          <p>{fp.drivetrain} • {fp.transmission}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right mono text-sm">
                        <span className="text-muted-foreground">{formatNumber(fp.sale_km)}</span>
                        <span className="text-muted-foreground mx-1">-</span>
                        <span className="text-foreground">{formatNumber(fp.max_km)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {isActive ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className={`mono font-medium ${daysRemaining <= 14 ? 'text-action-watch' : 'text-foreground'}`}>
                              {daysRemaining}
                            </span>
                          </div>
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
