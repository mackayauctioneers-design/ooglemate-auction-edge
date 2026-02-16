import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshCw, Search, Plus, Play, Power, Activity, Radio, Zap, AlertTriangle } from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';
import { TrapCrawlPreviewDrawer } from '@/components/operator/TrapCrawlPreviewDrawer';
import { QuickAddTrapModal } from '@/components/operator/QuickAddTrapModal';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';

interface Trap {
  id: string;
  trap_slug: string;
  dealer_name: string;
  region_id: string;
  enabled: boolean;
  validation_status: string;
  parser_mode: string;
  anchor_trap: boolean;
  last_crawl_at: string | null;
  last_vehicle_count: number | null;
  consecutive_failures: number;
  trap_mode: string;
}

export default function TrapsRegistryPage() {
  const [traps, setTraps] = useState<Trap[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [crawlDrawerOpen, setCrawlDrawerOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedTrap, setSelectedTrap] = useState<{ slug: string; name: string; parserMode?: string } | null>(null);
  const [quickFilter, setQuickFilter] = useState<'all' | 'failing'>('all');
  const [hasShownReset, setHasShownReset] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => { document.title = 'Traps Registry | Operator'; }, []);

  const fetchTraps = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('dealer_traps')
        .select('id, trap_slug, dealer_name, region_id, enabled, validation_status, parser_mode, anchor_trap, last_crawl_at, last_vehicle_count, consecutive_failures, trap_mode')
        .eq('trap_mode', 'auto')
        .eq('enabled', true)
        .order('dealer_name', { ascending: true })
        .limit(50);
      if (error) throw error;
      setTraps((data as Trap[]) || []);
    } catch (err) {
      console.error('Failed to fetch traps:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTraps(); }, [fetchTraps]);

  useEffect(() => {
    if (!loading && traps.length > 0 && !hasShownReset) {
      setHasShownReset(true);
      toast.success('Traps reset to 3 core sources', {
        description: 'Pickles · Toyota · EasyAuto123. Add more only when needed.',
      });
    }
  }, [loading, traps.length, hasShownReset]);

  const handleDisable = async (trapId: string) => {
    try {
      const { error } = await supabase.from('dealer_traps').update({ enabled: false, trap_mode: 'dormant' }).eq('id', trapId);
      if (error) throw error;
      setTraps(prev => prev.filter(t => t.id !== trapId));
      toast.success('Trap disabled');
    } catch { toast.error('Failed to disable'); }
  };

  // Metrics
  const sevenDaysAgo = subDays(new Date(), 7).toISOString();
  const operationalCount = traps.filter(t => t.enabled && t.consecutive_failures === 0).length;
  const failingCount = traps.filter(t => t.consecutive_failures > 0).length;
  const vehiclesLast7d = traps
    .filter(t => t.last_crawl_at && t.last_crawl_at > sevenDaysAgo && t.last_vehicle_count)
    .reduce((sum, t) => sum + (t.last_vehicle_count || 0), 0);

  const filtered = traps.filter(t => {
    const matchesSearch = t.dealer_name.toLowerCase().includes(search.toLowerCase()) || t.trap_slug.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (quickFilter === 'failing') return t.consecutive_failures > 0;
    return true;
  });

  return (
    <OperatorLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Traps Registry</h1>
            <p className="text-sm text-muted-foreground">High-signal inventory sources</p>
          </div>
          <Button variant="outline" size="icon" onClick={fetchTraps} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={<Activity className="h-4 w-4 text-muted-foreground" />} label="Total" value={traps.length} sub={`${traps.length} active`} onClick={() => setQuickFilter('all')} />
          <KpiCard icon={<Radio className="h-4 w-4 text-emerald-500" />} label="Operational" value={operationalCount} sub="crawling OK" className="border-emerald-500/20" />
          <KpiCard icon={<Zap className="h-4 w-4 text-blue-500" />} label="Vehicles 7d" value={vehiclesLast7d} sub="ingested" className="border-blue-500/20" />
          <KpiCard
            icon={<AlertTriangle className={`h-4 w-4 ${failingCount > 0 ? 'text-red-500' : 'text-muted-foreground'}`} />}
            label="Failing"
            value={failingCount}
            sub={failingCount > 0 ? 'tap to filter' : 'none'}
            className={failingCount > 0 ? 'border-red-500/30' : ''}
            valueClassName={failingCount > 0 ? 'text-red-500' : 'text-muted-foreground'}
            onClick={() => setQuickFilter(quickFilter === 'failing' ? 'all' : 'failing')}
          />
        </div>

        {/* Guardrail banner */}
        {traps.length > 5 && (
          <div className="text-sm bg-amber-500/10 border border-amber-500/20 rounded-md p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <span className="text-muted-foreground">
              <span className="font-medium text-amber-600 dark:text-amber-400">Keep traps minimal (3–5 high-value sources)</span> for best signal. Add only when needed.
            </span>
          </div>
        )}

        {/* Active filter chip */}
        {quickFilter !== 'all' && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Failing ({filtered.length})</Badge>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setQuickFilter('all')}>Clear</Button>
          </div>
        )}

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search traps..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>

        {/* Trap list */}
        <Card>
          <CardContent className="p-0">
            {/* Desktop */}
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-3 px-4 font-medium">Dealer</th>
                    <th className="text-left py-3 px-3 font-medium">Mode</th>
                    <th className="text-left py-3 px-3 font-medium">Status</th>
                    <th className="text-right py-3 px-3 font-medium">Vehicles</th>
                    <th className="text-right py-3 px-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(trap => {
                    const isCritical = trap.consecutive_failures >= 3;
                    return (
                      <tr key={trap.id} className={`border-b last:border-b-0 ${isCritical ? 'bg-red-500/5' : ''}`}>
                        <td className="py-3 px-4">
                          <div className="font-medium">{trap.dealer_name}</div>
                          <div className="text-xs text-muted-foreground">{trap.region_id.replace(/_/g, ' ').toLowerCase()}</div>
                        </td>
                        <td className="py-3 px-3">
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">Auto</Badge>
                        </td>
                        <td className="py-3 px-3">
                          {trap.consecutive_failures > 0 ? (
                            <Badge variant="destructive" className={`text-xs ${isCritical ? 'animate-pulse' : ''}`}>{trap.consecutive_failures}× fail</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">live</Badge>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">{trap.last_vehicle_count ?? '—'}</td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setSelectedTrap({ slug: trap.trap_slug, name: trap.dealer_name, parserMode: trap.parser_mode }); setCrawlDrawerOpen(true); }}>
                              <Play className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => handleDisable(trap.id)}>
                              <Power className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y divide-border">
              {filtered.map(trap => {
                const isCritical = trap.consecutive_failures >= 3;
                return (
                  <div key={trap.id} className={`p-3 space-y-2 ${isCritical ? 'bg-red-500/5' : ''}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-sm">{trap.dealer_name}</div>
                        <div className="text-xs text-muted-foreground">{trap.region_id.replace(/_/g, ' ').toLowerCase()}</div>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 px-2 shrink-0" onClick={() => { setSelectedTrap({ slug: trap.trap_slug, name: trap.dealer_name, parserMode: trap.parser_mode }); setCrawlDrawerOpen(true); }}>
                        <Play className="h-3.5 w-3.5 mr-1" /> Run
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">Auto</Badge>
                      {trap.consecutive_failures > 0 ? (
                        <Badge variant="destructive" className={`text-xs ${isCritical ? 'animate-pulse' : ''}`}>{trap.consecutive_failures}× fail</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">live</Badge>
                      )}
                      {trap.last_vehicle_count != null && (
                        <span className="text-xs font-mono text-muted-foreground">{trap.last_vehicle_count} vehicles</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && !loading && (
              <div className="text-center py-12 text-muted-foreground">
                {quickFilter === 'failing' ? 'No failing traps 🎉' : 'No traps found'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* FAB */}
        <Button
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50 md:h-12 md:w-auto md:rounded-md md:px-4 md:relative md:bottom-auto md:right-auto md:shadow-none"
          onClick={() => setAddModalOpen(true)}
        >
          <Plus className="h-5 w-5 md:mr-2" />
          <span className="hidden md:inline">Add Trap</span>
        </Button>

        {selectedTrap && (
          <TrapCrawlPreviewDrawer open={crawlDrawerOpen} onOpenChange={setCrawlDrawerOpen} trapSlug={selectedTrap.slug} dealerName={selectedTrap.name} parserMode={selectedTrap.parserMode} onCrawlComplete={fetchTraps} />
        )}
        <QuickAddTrapModal open={addModalOpen} onOpenChange={setAddModalOpen} onAdded={fetchTraps} />
      </div>
    </OperatorLayout>
  );
}

/* ─── KPI Card ─── */
function KpiCard({ icon, label, value, sub, className = '', valueClassName = '', onClick }: {
  icon: React.ReactNode; label: string; value: number; sub: string; className?: string; valueClassName?: string; onClick?: () => void;
}) {
  return (
    <Card className={`cursor-pointer hover:border-foreground/20 transition-colors ${className}`} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <div className={`text-3xl font-bold ${valueClassName}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}
