import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Search, Plus, List, Radio, Satellite, Users, Moon, Play, Trash2, AlertTriangle, Activity, Zap } from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';
import { TrapCandidateIntake } from '@/components/operator/TrapCandidateIntake';
import { TrapCrawlPreviewDrawer } from '@/components/operator/TrapCrawlPreviewDrawer';
import { QuickAddTrapModal } from '@/components/operator/QuickAddTrapModal';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';

type TrapMode = 'auto' | 'portal' | 'va' | 'dormant';

interface Trap {
  id: string;
  trap_slug: string;
  dealer_name: string;
  region_id: string;
  enabled: boolean;
  validation_status: string;
  preflight_status: string | null;
  parser_mode: string;
  parser_confidence: string | null;
  anchor_trap: boolean;
  last_crawl_at: string | null;
  last_vehicle_count: number | null;
  consecutive_failures: number;
  trap_mode: TrapMode;
}

const MODE_BADGE: Record<TrapMode, { label: string; icon: React.ReactNode; className: string }> = {
  auto: { label: 'Auto', icon: <Radio className="h-3 w-3" />, className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  portal: { label: 'Portal', icon: <Satellite className="h-3 w-3" />, className: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  va: { label: 'VA', icon: <Users className="h-3 w-3" />, className: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  dormant: { label: 'Dormant', icon: <Moon className="h-3 w-3" />, className: 'bg-muted/50 text-muted-foreground border-muted' },
};

export default function TrapsRegistryPage() {
  const [traps, setTraps] = useState<Trap[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [crawlDrawerOpen, setCrawlDrawerOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedTrap, setSelectedTrap] = useState<{ slug: string; name: string } | null>(null);
  const [quickFilter, setQuickFilter] = useState<'all' | 'failing' | 'auto' | 'portal'>('all');
  const [cleaningUp, setCleaningUp] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => { document.title = 'Traps Registry | Operator'; }, []);

  const fetchTraps = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('dealer_traps')
        .select('id, trap_slug, dealer_name, region_id, enabled, validation_status, preflight_status, parser_mode, parser_confidence, anchor_trap, last_crawl_at, last_vehicle_count, consecutive_failures, trap_mode')
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      setTraps((data as Trap[]) || []);
    } catch (err) {
      console.error('Failed to fetch traps:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTraps(); }, []);

  const updateTrapMode = async (trapId: string, newMode: TrapMode) => {
    try {
      const { error } = await supabase.from('dealer_traps').update({ trap_mode: newMode }).eq('id', trapId);
      if (error) throw error;
      setTraps(prev => prev.map(t => t.id === trapId ? { ...t, trap_mode: newMode } : t));
      toast.success(`Mode → ${MODE_BADGE[newMode].label}`);
    } catch { toast.error('Failed to update mode'); }
  };

  const handleBulkCleanup = async () => {
    const targets = traps.filter(t => t.consecutive_failures >= 3 && t.trap_mode === 'auto' && t.enabled);
    if (!targets.length) { toast.info('No failing traps to clean up'); return; }
    setCleaningUp(true);
    try {
      const { error } = await supabase.from('dealer_traps').update({ enabled: false, trap_mode: 'dormant' as string }).in('id', targets.map(t => t.id));
      if (error) throw error;
      toast.success(`Disabled ${targets.length} failing trap${targets.length > 1 ? 's' : ''}`);
      fetchTraps();
    } catch { toast.error('Cleanup failed'); }
    finally { setCleaningUp(false); }
  };

  // Active traps (exclude dormant from default view)
  const activeTraps = traps.filter(t => t.trap_mode !== 'dormant');
  const dormantCount = traps.length - activeTraps.length;

  // Metrics (based on active only)
  const sevenDaysAgo = subDays(new Date(), 7).toISOString();
  const operationalCount = activeTraps.filter(t => t.enabled || t.trap_mode === 'portal' || t.trap_mode === 'va').length;
  const failingCount = activeTraps.filter(t => t.consecutive_failures > 0 && t.trap_mode === 'auto').length;
  const vehiclesLast7d = activeTraps
    .filter(t => t.last_crawl_at && t.last_crawl_at > sevenDaysAgo && t.last_vehicle_count)
    .reduce((sum, t) => sum + (t.last_vehicle_count || 0), 0);
  const cleanupTargets = activeTraps.filter(t => t.consecutive_failures >= 3 && t.trap_mode === 'auto' && t.enabled);

  // Filters (default hides dormant)
  const [showDormant, setShowDormant] = useState(false);
  const baseTraps = showDormant ? traps : activeTraps;
  const filtered = baseTraps.filter(t => {
    const matchesSearch = t.dealer_name.toLowerCase().includes(search.toLowerCase()) || t.trap_slug.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (quickFilter === 'failing') return t.consecutive_failures > 0 && t.trap_mode === 'auto';
    if (quickFilter === 'auto') return t.trap_mode === 'auto' && t.enabled;
    if (quickFilter === 'portal') return t.trap_mode === 'portal';
    return true;
  });

  return (
    <OperatorLayout>
      <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Traps Registry</h1>
            <p className="text-sm text-muted-foreground hidden md:block">Monitor & manage dealer inventory sources</p>
          </div>
          <div className="flex gap-2">
            <Button size={isMobile ? 'sm' : 'default'} onClick={() => setAddModalOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
            <Button variant="outline" size="sm" onClick={fetchTraps} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* 4 KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="cursor-pointer hover:border-foreground/20" onClick={() => setQuickFilter('all')}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Total</span>
              </div>
              <div className="text-3xl font-bold">{activeTraps.length}</div>
              <div className="text-xs text-muted-foreground mt-1">{operationalCount} operational{dormantCount > 0 ? ` · ${dormantCount} dormant` : ''}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-foreground/20 border-emerald-500/20" onClick={() => setQuickFilter('auto')}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Radio className="h-4 w-4 text-emerald-500" />
                <span className="text-xs font-medium text-muted-foreground">Live Feeds</span>
              </div>
              <div className="text-3xl font-bold text-emerald-500">
                {traps.filter(t => t.enabled && t.trap_mode === 'auto' && t.validation_status === 'validated').length}
              </div>
              <div className="text-xs text-muted-foreground mt-1">auto-crawling</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-foreground/20 border-blue-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-blue-500" />
                <span className="text-xs font-medium text-muted-foreground">Vehicles 7d</span>
              </div>
              <div className="text-3xl font-bold text-blue-500">{vehiclesLast7d}</div>
              <div className="text-xs text-muted-foreground mt-1">ingested last week</div>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-colors ${failingCount > 0 ? 'border-red-500/30 hover:border-red-500/50' : 'hover:border-foreground/20'}`}
            onClick={() => setQuickFilter(quickFilter === 'failing' ? 'all' : 'failing')}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className={`h-4 w-4 ${failingCount > 0 ? 'text-red-500' : 'text-muted-foreground'}`} />
                <span className="text-xs font-medium text-muted-foreground">Failing</span>
              </div>
              <div className={`text-3xl font-bold ${failingCount > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>{failingCount}</div>
              {failingCount > 0 && <div className="text-xs text-red-400/70 mt-1">tap to filter</div>}
            </CardContent>
          </Card>
        </div>

        {/* Fix Failing button */}
        {cleanupTargets.length > 0 && (
          <Button
            variant="destructive"
            className="w-full md:w-auto"
            onClick={handleBulkCleanup}
            disabled={cleaningUp}
          >
            <Trash2 className={`h-4 w-4 mr-2 ${cleaningUp ? 'animate-spin' : ''}`} />
            {cleaningUp ? 'Cleaning...' : `Fix Now — Disable ${cleanupTargets.length} Failing Trap${cleanupTargets.length > 1 ? 's' : ''}`}
          </Button>
        )}

        {/* Consolidation banner */}
        {activeTraps.length > 15 && (
          <div className="text-sm bg-amber-500/10 border border-amber-500/20 rounded-md p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {activeTraps.length} active traps — keep only high-value sources.
              </span>
              <p className="text-xs text-muted-foreground mt-1">
                For chains like EasyAuto123, one main <code className="bg-muted px-1 rounded">/used-cars</code> trap beats per-location traps.
              </p>
            </div>
          </div>
        )}

        {/* Active filter + dormant toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          {quickFilter !== 'all' && (
            <>
              <Badge variant="secondary" className="gap-1">
                {quickFilter} ({filtered.length})
              </Badge>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setQuickFilter('all')}>Clear</Button>
            </>
          )}
          {dormantCount > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-xs ml-auto" onClick={() => setShowDormant(!showDormant)}>
              <Moon className="h-3 w-3 mr-1" /> {showDormant ? 'Hide' : 'Show'} {dormantCount} dormant
            </Button>
          )}
        </div>

        <Tabs defaultValue="list" className="w-full">
          <TabsList>
            <TabsTrigger value="list" className="gap-2"><List className="h-4 w-4" /> Registry</TabsTrigger>
            <TabsTrigger value="add" className="gap-2"><Plus className="h-4 w-4" /> Add Candidate</TabsTrigger>
          </TabsList>

          <TabsContent value="add" className="mt-4">
            <TrapCandidateIntake onAdded={fetchTraps} />
          </TabsContent>

          <TabsContent value="list" className="mt-4 space-y-4">
            {/* Search */}
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search traps..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
            </div>

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground border-b">
                      <tr>
                        <th className="text-left py-3 px-4">Dealer</th>
                        <th className="text-left py-3 px-3">Mode</th>
                        <th className="text-left py-3 px-3">Status</th>
                        <th className="text-right py-3 px-3">Vehicles</th>
                        <th className="text-left py-3 px-3">Last Crawl</th>
                        <th className="text-left py-3 px-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((trap) => (
                        <TrapRow key={trap.id} trap={trap} onRun={(slug, name) => { setSelectedTrap({ slug, name }); setCrawlDrawerOpen(true); }} onModeChange={updateTrapMode} />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden divide-y divide-border">
                  {filtered.map((trap) => (
                    <TrapMobileCard key={trap.id} trap={trap} onRun={(slug, name) => { setSelectedTrap({ slug, name }); setCrawlDrawerOpen(true); }} onModeChange={updateTrapMode} />
                  ))}
                </div>

                {filtered.length === 0 && !loading && (
                  <div className="text-center py-8 text-muted-foreground">
                    {quickFilter !== 'all' ? `No ${quickFilter} traps found` : 'No traps found'}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {selectedTrap && (
          <TrapCrawlPreviewDrawer open={crawlDrawerOpen} onOpenChange={setCrawlDrawerOpen} trapSlug={selectedTrap.slug} dealerName={selectedTrap.name} onCrawlComplete={fetchTraps} />
        )}
        <QuickAddTrapModal open={addModalOpen} onOpenChange={setAddModalOpen} onAdded={fetchTraps} />
      </div>
    </OperatorLayout>
  );
}

/* ─── Desktop row ─── */
function TrapRow({ trap, onRun, onModeChange }: { trap: Trap; onRun: (slug: string, name: string) => void; onModeChange: (id: string, mode: TrapMode) => void }) {
  const mode = MODE_BADGE[trap.trap_mode] || MODE_BADGE.auto;
  const isCritical = trap.consecutive_failures >= 3 && trap.trap_mode === 'auto';

  return (
    <tr className={`border-b last:border-b-0 ${isCritical ? 'bg-red-500/5' : ''}`}>
      <td className="py-3 px-4">
        <div className="font-medium">{trap.dealer_name}</div>
        <div className="text-xs text-muted-foreground">{trap.region_id.replace(/_/g, ' ')}</div>
      </td>
      <td className="py-3 px-3">
        <Select value={trap.trap_mode} onValueChange={(v) => onModeChange(trap.id, v as TrapMode)}>
          <SelectTrigger className={`w-28 h-7 text-xs ${mode.className}`}>
            <SelectValue>
              <span className="flex items-center gap-1">{mode.icon} {mode.label}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MODE_BADGE) as TrapMode[]).map(m => (
              <SelectItem key={m} value={m}>
                <span className={`flex items-center gap-1 ${MODE_BADGE[m].className}`}>{MODE_BADGE[m].icon} {MODE_BADGE[m].label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-3 px-3">
        <div className="flex items-center gap-1.5">
          {trap.trap_mode === 'auto' ? (
            trap.enabled ? <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">live</Badge>
              : <Badge variant="secondary" className="text-xs">off</Badge>
          ) : (
            <Badge variant="outline" className={`text-xs ${mode.className}`}>{trap.trap_mode === 'portal' ? 'OEM' : trap.trap_mode === 'va' ? 'VA' : '—'}</Badge>
          )}
          {trap.consecutive_failures > 0 && trap.trap_mode === 'auto' && (
            <Badge variant="destructive" className={`text-xs ${isCritical ? 'animate-pulse' : ''}`}>
              {trap.consecutive_failures}×fail
            </Badge>
          )}
        </div>
      </td>
      <td className="py-3 px-3 text-right font-mono text-sm">
        {trap.trap_mode === 'auto' ? (trap.last_vehicle_count ?? '—') : '—'}
      </td>
      <td className="py-3 px-3 text-muted-foreground text-sm">
        {trap.trap_mode === 'auto' && trap.last_crawl_at ? format(parseISO(trap.last_crawl_at), 'dd MMM HH:mm') : '—'}
      </td>
      <td className="py-3 px-3">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onRun(trap.trap_slug, trap.dealer_name)}>
          <Play className="h-3 w-3 mr-1" /> Run
        </Button>
      </td>
    </tr>
  );
}

/* ─── Mobile card ─── */
function TrapMobileCard({ trap, onRun, onModeChange }: { trap: Trap; onRun: (slug: string, name: string) => void; onModeChange: (id: string, mode: TrapMode) => void }) {
  const mode = MODE_BADGE[trap.trap_mode] || MODE_BADGE.auto;
  const isCritical = trap.consecutive_failures >= 3 && trap.trap_mode === 'auto';

  return (
    <div className={`p-3 space-y-2 ${isCritical ? 'bg-red-500/5' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-sm">{trap.dealer_name}</div>
          <div className="text-xs text-muted-foreground">{trap.region_id.replace(/_/g, ' ')}</div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={() => onRun(trap.trap_slug, trap.dealer_name)}>
          <Play className="h-3 w-3 mr-1" /> Run
        </Button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className={`text-xs ${mode.className}`}>
          <span className="flex items-center gap-1">{mode.icon} {mode.label}</span>
        </Badge>
        {trap.trap_mode === 'auto' && trap.enabled && (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">live</Badge>
        )}
        {trap.consecutive_failures > 0 && trap.trap_mode === 'auto' && (
          <Badge variant="destructive" className={`text-xs ${isCritical ? 'animate-pulse' : ''}`}>
            {trap.consecutive_failures}×fail
          </Badge>
        )}
        {trap.trap_mode === 'auto' && trap.last_vehicle_count != null && (
          <span className="text-xs font-mono text-muted-foreground">{trap.last_vehicle_count} vehicles</span>
        )}
      </div>
    </div>
  );
}
