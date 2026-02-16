import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Search, CheckCircle, AlertTriangle, Plus, List, Radio, Satellite, Users, Moon, Play, Trash2, ShieldAlert } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { TrapCandidateIntake } from '@/components/operator/TrapCandidateIntake';
import { TrapCrawlPreviewDrawer } from '@/components/operator/TrapCrawlPreviewDrawer';
import { QuickAddTrapModal } from '@/components/operator/QuickAddTrapModal';
import { toast } from 'sonner';

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

const TRAP_MODE_CONFIG: Record<TrapMode, { label: string; icon: React.ReactNode; color: string; bgColor: string; borderColor: string }> = {
  auto: { 
    label: 'Live Feed', 
    icon: <Radio className="h-3 w-3" />, 
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30'
  },
  portal: { 
    label: 'Portal-backed', 
    icon: <Satellite className="h-3 w-3" />, 
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30'
  },
  va: { 
    label: 'VA-fed', 
    icon: <Users className="h-3 w-3" />, 
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30'
  },
  dormant: { 
    label: 'Dormant', 
    icon: <Moon className="h-3 w-3" />, 
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    borderColor: 'border-muted'
  },
};

export default function TrapsRegistryPage() {
  const [traps, setTraps] = useState<Trap[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [crawlDrawerOpen, setCrawlDrawerOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedTrap, setSelectedTrap] = useState<{ slug: string; name: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'failing' | 'dormant' | 'auto-disabled'>('all');
  const [cleaningUp, setCleaningUp] = useState(false);

  useEffect(() => {
    document.title = 'Traps Registry | Operator';
  }, []);

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

  useEffect(() => {
    fetchTraps();
  }, []);

  const updateTrapMode = async (trapId: string, newMode: TrapMode) => {
    try {
      const { error } = await supabase
        .from('dealer_traps')
        .update({ trap_mode: newMode })
        .eq('id', trapId);
      
      if (error) throw error;
      
      setTraps(prev => prev.map(t => t.id === trapId ? { ...t, trap_mode: newMode } : t));
      toast.success(`Trap mode updated to ${TRAP_MODE_CONFIG[newMode].label}`);
    } catch (err) {
      console.error('Failed to update trap mode:', err);
      toast.error('Failed to update trap mode');
    }
  };

  const handleBulkCleanup = async () => {
    const failingTraps = traps.filter(t => t.consecutive_failures >= 3 && t.trap_mode === 'auto' && t.enabled);
    if (failingTraps.length === 0) {
      toast.info('No traps with 3+ consecutive failures to clean up');
      return;
    }

    setCleaningUp(true);
    try {
      const ids = failingTraps.map(t => t.id);
      const { error } = await supabase
        .from('dealer_traps')
        .update({ enabled: false, trap_mode: 'dormant' as string })
        .in('id', ids);

      if (error) throw error;

      toast.success(`Disabled ${failingTraps.length} failing trap${failingTraps.length > 1 ? 's' : ''}`);
      fetchTraps();
    } catch (err) {
      console.error('Bulk cleanup failed:', err);
      toast.error('Failed to clean up traps');
    } finally {
      setCleaningUp(false);
    }
  };

  // Apply filters
  const filtered = traps.filter((t) => {
    const matchesSearch =
      t.dealer_name.toLowerCase().includes(search.toLowerCase()) ||
      t.trap_slug.toLowerCase().includes(search.toLowerCase()) ||
      t.region_id.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === 'failing') return t.consecutive_failures > 0 && t.trap_mode === 'auto';
    if (statusFilter === 'dormant') return t.trap_mode === 'dormant' || (!t.enabled && t.trap_mode === 'auto' && t.consecutive_failures === 0);
    if (statusFilter === 'auto-disabled') return !t.enabled && t.consecutive_failures >= 3;
    return true;
  });

  // Metrics
  const operationalCount = traps.filter((t) => t.enabled || t.trap_mode === 'portal' || t.trap_mode === 'va').length;
  const autoCrawlingCount = traps.filter((t) => t.enabled && t.trap_mode === 'auto' && t.validation_status === 'validated').length;
  const portalBackedCount = traps.filter((t) => t.trap_mode === 'portal').length;
  const failingCount = traps.filter((t) => t.consecutive_failures > 0 && t.trap_mode === 'auto').length;
  const autoDisabledCount = traps.filter((t) => !t.enabled && t.consecutive_failures >= 3).length;
  const dormantCount = traps.filter((t) => t.trap_mode === 'dormant' || (!t.enabled && t.trap_mode === 'auto' && t.consecutive_failures === 0)).length;

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Traps Registry</h1>
            <p className="text-muted-foreground">Manage dealer trap configurations and operating modes</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setAddModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Trap
            </Button>
            {failingCount >= 3 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkCleanup}
                disabled={cleaningUp}
              >
                <Trash2 className={`h-4 w-4 mr-2 ${cleaningUp ? 'animate-spin' : ''}`} />
                {cleaningUp ? 'Cleaning...' : `Clean ${traps.filter(t => t.consecutive_failures >= 3 && t.trap_mode === 'auto' && t.enabled).length} Failing`}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={fetchTraps} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
          <Card className="cursor-pointer hover:border-foreground/20 transition-colors" onClick={() => setStatusFilter('all')}>
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold">{traps.length}</div>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-colors border-emerald-500/30 hover:border-emerald-500/50 ${statusFilter === 'all' ? 'ring-1 ring-emerald-500/40' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs font-medium flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-emerald-500" /> Operational
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold text-emerald-500">{operationalCount}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-foreground/20 transition-colors" onClick={() => setStatusFilter('all')}>
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs font-medium flex items-center gap-1">
                <Radio className="h-3 w-3 text-emerald-400" /> Auto
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold">{autoCrawlingCount}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-foreground/20 transition-colors" onClick={() => setStatusFilter('all')}>
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs font-medium flex items-center gap-1">
                <Satellite className="h-3 w-3 text-amber-400" /> Portal
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold text-amber-500">{portalBackedCount}</div>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-colors ${failingCount > 0 ? 'border-red-500/30 hover:border-red-500/50' : 'hover:border-foreground/20'} ${statusFilter === 'failing' ? 'ring-1 ring-red-500/40' : ''}`}
            onClick={() => setStatusFilter(statusFilter === 'failing' ? 'all' : 'failing')}
          >
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs font-medium flex items-center gap-1">
                <AlertTriangle className={`h-3 w-3 ${failingCount > 0 ? 'text-red-500' : 'text-muted-foreground'}`} /> Failing
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className={`text-2xl font-bold ${failingCount > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>{failingCount}</div>
              {failingCount > 0 && <div className="text-[10px] text-red-400/70">Click to filter</div>}
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-colors ${autoDisabledCount > 0 ? 'border-orange-500/30 hover:border-orange-500/50' : 'hover:border-foreground/20'} ${statusFilter === 'auto-disabled' ? 'ring-1 ring-orange-500/40' : ''}`}
            onClick={() => setStatusFilter(statusFilter === 'auto-disabled' ? 'all' : 'auto-disabled')}
          >
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs font-medium flex items-center gap-1">
                <ShieldAlert className={`h-3 w-3 ${autoDisabledCount > 0 ? 'text-orange-500' : 'text-muted-foreground'}`} /> Auto-Off
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className={`text-2xl font-bold ${autoDisabledCount > 0 ? 'text-orange-500' : 'text-muted-foreground'}`}>{autoDisabledCount}</div>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-colors hover:border-foreground/20 ${statusFilter === 'dormant' ? 'ring-1 ring-muted-foreground/40' : ''}`}
            onClick={() => setStatusFilter(statusFilter === 'dormant' ? 'all' : 'dormant')}
          >
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs font-medium flex items-center gap-1">
                <Moon className="h-3 w-3 text-muted-foreground" /> Dormant
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold text-muted-foreground">{dormantCount}</div>
            </CardContent>
          </Card>
        </div>

        {/* Active filter indicator */}
        {statusFilter !== 'all' && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              Showing: {statusFilter} ({filtered.length})
            </Badge>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setStatusFilter('all')}>
              Clear filter
            </Button>
          </div>
        )}

        <Tabs defaultValue="list" className="w-full">
          <TabsList>
            <TabsTrigger value="list" className="gap-2">
              <List className="h-4 w-4" />
              Registry
            </TabsTrigger>
            <TabsTrigger value="add" className="gap-2">
              <Plus className="h-4 w-4" />
              Add Candidate
            </TabsTrigger>
          </TabsList>

          <TabsContent value="add" className="mt-4">
            <TrapCandidateIntake onAdded={fetchTraps} />
          </TabsContent>

          <TabsContent value="list" className="mt-4 space-y-4">

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search traps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Consolidation tip */}
        {traps.length > 50 && (
          <div className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-md p-3">
            💡 <span className="font-medium">Tip:</span> For chains like EasyAuto123, use the main <code className="bg-muted px-1 rounded">/used-cars</code> page instead of individual location pages to reduce noise and failures.
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 pr-4">Dealer</th>
                    <th className="text-left py-2 pr-4">Region</th>
                    <th className="text-left py-2 pr-4">Mode</th>
                    <th className="text-left py-2 pr-4">Status</th>
                    <th className="text-left py-2 pr-4">Parser</th>
                    <th className="text-left py-2 pr-4">Last Crawl</th>
                    <th className="text-left py-2 pr-4">Vehicles</th>
                    <th className="text-left py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((trap) => {
                    const modeConfig = TRAP_MODE_CONFIG[trap.trap_mode] || TRAP_MODE_CONFIG.auto;
                    const isCriticallyFailing = trap.consecutive_failures >= 3 && trap.trap_mode === 'auto';
                    return (
                      <tr key={trap.id} className={`border-b last:border-b-0 ${isCriticallyFailing ? 'bg-red-500/5' : ''}`}>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{trap.dealer_name}</span>
                            {trap.anchor_trap && (
                              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">anchor</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{trap.trap_slug}</div>
                        </td>
                        <td className="py-3 pr-4 text-sm">{trap.region_id.replace(/_/g, ' ')}</td>
                        <td className="py-3 pr-4">
                          <Select 
                            value={trap.trap_mode} 
                            onValueChange={(value) => updateTrapMode(trap.id, value as TrapMode)}
                          >
                            <SelectTrigger className={`w-36 h-8 text-xs ${modeConfig.bgColor} ${modeConfig.borderColor}`}>
                              <SelectValue>
                                <div className={`flex items-center gap-1.5 ${modeConfig.color}`}>
                                  {modeConfig.icon}
                                  {modeConfig.label}
                                </div>
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(TRAP_MODE_CONFIG) as TrapMode[]).map((mode) => {
                                const cfg = TRAP_MODE_CONFIG[mode];
                                return (
                                  <SelectItem key={mode} value={mode}>
                                    <div className={`flex items-center gap-1.5 ${cfg.color}`}>
                                      {cfg.icon}
                                      {cfg.label}
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            {trap.trap_mode === 'auto' ? (
                              trap.enabled ? (
                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">enabled</Badge>
                              ) : trap.preflight_status === 'fail' ? (
                                <Badge variant="destructive">preflight fail</Badge>
                              ) : trap.validation_status === 'pending' ? (
                                <Badge variant="secondary">pending</Badge>
                              ) : (
                                <Badge variant="outline">{trap.validation_status}</Badge>
                              )
                            ) : (
                              <Badge variant="outline" className={`${modeConfig.bgColor} ${modeConfig.color} ${modeConfig.borderColor}`}>
                                {trap.trap_mode === 'portal' ? 'OEM feed' : trap.trap_mode === 'va' ? 'VA queue' : 'inactive'}
                              </Badge>
                            )}
                            {trap.consecutive_failures > 0 && trap.trap_mode === 'auto' && (
                              <Badge variant="destructive" className={isCriticallyFailing ? 'animate-pulse' : ''}>
                                {trap.consecutive_failures} fail{trap.consecutive_failures > 1 ? 's' : ''}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="text-sm">{trap.parser_mode}</div>
                          {trap.parser_confidence && trap.trap_mode === 'auto' && (
                            <div className="text-xs text-muted-foreground">{trap.parser_confidence}</div>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground text-sm">
                          {trap.trap_mode === 'auto' && trap.last_crawl_at 
                            ? format(parseISO(trap.last_crawl_at), 'dd MMM HH:mm') 
                            : '—'}
                        </td>
                        <td className="py-3 pr-4 font-mono text-sm">
                          {trap.trap_mode === 'auto' ? (trap.last_vehicle_count ?? '—') : '—'}
                        </td>
                        <td className="py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setSelectedTrap({ slug: trap.trap_slug, name: trap.dealer_name });
                              setCrawlDrawerOpen(true);
                            }}
                          >
                            <Play className="h-3 w-3 mr-1" />
                            Run
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && !loading && (
                <div className="text-center py-8 text-muted-foreground">
                  {statusFilter !== 'all' ? `No ${statusFilter} traps found` : 'No traps found'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
          </TabsContent>
        </Tabs>

        {selectedTrap && (
          <TrapCrawlPreviewDrawer
            open={crawlDrawerOpen}
            onOpenChange={setCrawlDrawerOpen}
            trapSlug={selectedTrap.slug}
            dealerName={selectedTrap.name}
            onCrawlComplete={fetchTraps}
          />
        )}

        <QuickAddTrapModal
          open={addModalOpen}
          onOpenChange={setAddModalOpen}
          onAdded={fetchTraps}
        />
      </div>
    </OperatorLayout>
  );
}
