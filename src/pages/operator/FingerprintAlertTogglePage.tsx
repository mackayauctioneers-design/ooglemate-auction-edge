import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Fingerprint, Loader2, Search, Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// FINGERPRINT ALERT TOGGLE — Operator page to manage which fingerprints
// generate alerts for each dealer. Controls the alert_enabled flag.
// ============================================================================

interface DealerFingerprint {
  id: string;
  dealer_name: string;
  make: string;
  model: string;
  variant_family: string | null;
  year_min: number;
  year_max: number;
  min_km: number | null;
  max_km: number | null;
  sales_count: number | null;
  avg_profit: number | null;
  fingerprint_priority: string;
  alert_enabled: boolean;
  is_active: boolean;
}

export default function FingerprintAlertTogglePage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [dealerFilter, setDealerFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  const { data: fingerprints, isLoading } = useQuery({
    queryKey: ['fingerprint-alert-toggles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dealer_fingerprints')
        .select('id, dealer_name, make, model, variant_family, year_min, year_max, min_km, max_km, sales_count, avg_profit, fingerprint_priority, alert_enabled, is_active')
        .eq('is_active', true)
        .order('dealer_name')
        .order('fingerprint_priority')
        .order('sales_count', { ascending: false });
      if (error) throw error;
      return data as DealerFingerprint[];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('dealer_fingerprints')
        .update({ alert_enabled: enabled })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fingerprint-alert-toggles'] });
    },
    onError: (err) => {
      toast.error('Failed to toggle alert: ' + (err instanceof Error ? err.message : String(err)));
    },
  });

  const dealers = [...new Set(fingerprints?.map(f => f.dealer_name) || [])];

  const filtered = (fingerprints || []).filter(f => {
    if (dealerFilter !== 'all' && f.dealer_name !== dealerFilter) return false;
    if (priorityFilter !== 'all' && f.fingerprint_priority !== priorityFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const label = `${f.make} ${f.model} ${f.variant_family || ''}`.toLowerCase();
      if (!label.includes(q)) return false;
    }
    return true;
  });

  const enabledCount = filtered.filter(f => f.alert_enabled).length;
  const totalCount = filtered.length;

  const priorityColor = (p: string) => {
    if (p === 'HIGH') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    if (p === 'MEDIUM') return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    return 'bg-muted text-muted-foreground border-border';
  };

  return (
    <OperatorLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Fingerprint className="h-5 w-5" />
              Fingerprint Alert Controls
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Toggle which fingerprints generate sourcing alerts for each dealer.
            </p>
          </div>
          <Badge variant="outline" className="text-sm gap-1">
            <Bell className="h-3 w-3" />
            {enabledCount}/{totalCount} alerts on
          </Badge>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search make/model..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={dealerFilter} onValueChange={setDealerFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Dealers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Dealers</SelectItem>
                {dealers.map(d => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="All Priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="HIGH">HIGH</SelectItem>
                <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                <SelectItem value="LOW">LOW</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dealer</TableHead>
                    <TableHead>Segment</TableHead>
                    <TableHead className="text-center">Years</TableHead>
                    <TableHead className="text-center">KM Band</TableHead>
                    <TableHead className="text-center">Sales</TableHead>
                    <TableHead className="text-center">Avg Profit</TableHead>
                    <TableHead className="text-center">Priority</TableHead>
                    <TableHead className="text-center">Alerts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                        No fingerprints found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map(fp => {
                      const segment = [fp.make, fp.model, fp.variant_family].filter(Boolean).join(' ');
                      const kmBand = fp.min_km != null && fp.max_km != null
                        ? `${Math.round(fp.min_km / 1000)}k–${Math.round(fp.max_km / 1000)}k`
                        : '—';
                      return (
                        <TableRow key={fp.id} className={fp.alert_enabled ? '' : 'opacity-60'}>
                          <TableCell className="text-sm font-medium">{fp.dealer_name}</TableCell>
                          <TableCell className="text-sm">{segment}</TableCell>
                          <TableCell className="text-center text-sm font-mono">
                            {fp.year_min}–{fp.year_max}
                          </TableCell>
                          <TableCell className="text-center text-sm font-mono">{kmBand}</TableCell>
                          <TableCell className="text-center text-sm font-mono">{fp.sales_count ?? 0}</TableCell>
                          <TableCell className="text-center text-sm font-mono">
                            {fp.avg_profit != null ? `$${fp.avg_profit.toLocaleString()}` : '—'}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={`text-xs ${priorityColor(fp.fingerprint_priority)}`}>
                              {fp.fingerprint_priority}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Switch
                                checked={fp.alert_enabled}
                                onCheckedChange={(checked) => {
                                  toggleMutation.mutate({ id: fp.id, enabled: checked });
                                  toast.success(`Alerts ${checked ? 'enabled' : 'disabled'} for ${fp.make} ${fp.model}`);
                                }}
                              />
                              {fp.alert_enabled ? (
                                <Bell className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </OperatorLayout>
  );
}
