import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { 
  Plus, 
  Search, 
  Copy, 
  Pencil, 
  Trash2, 
  Target,
  Flame,
  TrendingUp,
  Sparkles,
  Filter
} from 'lucide-react';
import { toast } from 'sonner';
import { RequireAuth } from '@/components/guards/RequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';

interface DealerSpec {
  id: string;
  name: string;
  enabled: boolean;
  priority: 'high' | 'normal' | 'low';
  make: string;
  model: string;
  variant_family: string | null;
  region_scope: string;
  year_min: number | null;
  year_max: number | null;
  km_max: number | null;
  under_benchmark_pct: number;
  exploration_mode: boolean;
  created_at: string;
  hits_30d?: number;
  hits_7d?: number;
}

const PRIORITY_CONFIG = {
  high: { label: 'High', className: 'bg-red-500/10 text-red-600 border-red-500/30' },
  normal: { label: 'Normal', className: 'bg-slate-500/10 text-slate-600 border-slate-500/30' },
  low: { label: 'Low', className: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
};

const REGION_LABELS: Record<string, string> = {
  NSW_CENTRAL_COAST: 'Central Coast',
  NSW_SYDNEY_METRO: 'Sydney Metro',
  NSW_HUNTER_NEWCASTLE: 'Hunter/Newcastle',
  NSW_REGIONAL: 'Regional NSW',
  ALL: 'National',
};

function SpecCard({ 
  spec, 
  onToggle, 
  onDuplicate, 
  onDelete 
}: { 
  spec: DealerSpec;
  onToggle: (id: string, enabled: boolean) => void;
  onDuplicate: (spec: DealerSpec) => void;
  onDelete: (id: string) => void;
}) {
  const priorityConfig = PRIORITY_CONFIG[spec.priority];
  const currentYear = new Date().getFullYear();
  const yearRange = `${spec.year_min || currentYear - 10}–${spec.year_max || currentYear}`;

  return (
    <div className={`p-4 rounded-lg border transition-all ${
      spec.enabled 
        ? 'border-border bg-card hover:shadow-md' 
        : 'border-border/40 bg-muted/30 opacity-60'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link 
              to={`/dealer/specs/${spec.id}`}
              className="font-semibold text-foreground hover:text-primary transition-colors"
            >
              {spec.name}
            </Link>
            <Badge variant="outline" className={priorityConfig.className}>
              {priorityConfig.label}
            </Badge>
            {spec.exploration_mode && (
              <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/30 gap-1">
                <Sparkles className="h-3 w-3" />
                Explore
              </Badge>
            )}
            {!spec.enabled && (
              <Badge variant="secondary">Paused</Badge>
            )}
          </div>
          
          <p className="text-sm text-muted-foreground mt-1">
            {spec.make} {spec.model}
            {spec.variant_family && ` (${spec.variant_family})`}
          </p>
          
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
            <span>{yearRange}</span>
            {spec.km_max && <span>≤{Math.round(spec.km_max / 1000)}k km</span>}
            <span>≥{spec.under_benchmark_pct}% under</span>
            <span>{REGION_LABELS[spec.region_scope] || spec.region_scope}</span>
          </div>
          
          <div className="flex items-center gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Target className="h-3 w-3" />
              30d: <strong className="text-foreground">{spec.hits_30d || 0}</strong>
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              7d: <strong className="text-foreground">{spec.hits_7d || 0}</strong>
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Switch 
            checked={spec.enabled} 
            onCheckedChange={(checked) => onToggle(spec.id, checked)}
          />
          <Link to={`/dealer/specs/${spec.id}`}>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Pencil className="h-4 w-4" />
            </Button>
          </Link>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 w-8 p-0"
            onClick={() => onDuplicate(spec)}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
            onClick={() => onDelete(spec.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function DealerSpecsPage() {
  const { currentUser } = useAuth();
  const [specs, setSpecs] = useState<DealerSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [filterHigh, setFilterHigh] = useState(false);

  useEffect(() => {
    fetchSpecs();
  }, []);

  const fetchSpecs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('dealer_specs')
        .select('*')
        .is('deleted_at', null)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch hits for each spec
      const specsWithHits = await Promise.all(
        (data || []).map(async (spec) => {
          const { data: hits } = await supabase
            .rpc('get_spec_hits_summary', { p_spec_id: spec.id });
          return {
            ...spec,
            hits_30d: hits?.[0]?.total_30d || 0,
            hits_7d: hits?.[0]?.total_7d || 0,
          } as DealerSpec;
        })
      );

      setSpecs(specsWithHits);
    } catch (error) {
      console.error('Error fetching specs:', error);
      toast.error('Failed to load specs');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const { error } = await supabase
        .from('dealer_specs')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      setSpecs(specs.map((s) => (s.id === id ? { ...s, enabled } : s)));
      toast.success(enabled ? 'Spec activated' : 'Spec paused');
    } catch (error) {
      console.error('Error toggling spec:', error);
      toast.error('Failed to update');
    }
  };

  const handleDuplicate = async (spec: DealerSpec) => {
    try {
      const { error } = await supabase
        .from('dealer_specs')
        .insert([{
          dealer_id: crypto.randomUUID(),
          dealer_name: 'Dealer',
          name: `${spec.name} (Copy)`,
          make: spec.make,
          model: spec.model,
          variant_family: spec.variant_family,
          priority: spec.priority,
          region_scope: spec.region_scope,
          year_min: spec.year_min,
          year_max: spec.year_max,
          km_max: spec.km_max,
          under_benchmark_pct: spec.under_benchmark_pct,
          exploration_mode: spec.exploration_mode,
          enabled: false,
        }]);

      if (error) throw error;
      toast.success('Spec duplicated');
      fetchSpecs();
    } catch (error) {
      console.error('Error duplicating spec:', error);
      toast.error('Failed to duplicate');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this spec? This action cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('dealer_specs')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      setSpecs(specs.filter((s) => s.id !== id));
      toast.success('Spec deleted');
    } catch (error) {
      console.error('Error deleting spec:', error);
      toast.error('Failed to delete');
    }
  };

  // Filter specs
  const filteredSpecs = specs.filter((spec) => {
    if (filterActive && !spec.enabled) return false;
    if (filterHigh && spec.priority !== 'high') return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        spec.name.toLowerCase().includes(q) ||
        spec.make.toLowerCase().includes(q) ||
        spec.model.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeCount = specs.filter((s) => s.enabled).length;
  const highCount = specs.filter((s) => s.priority === 'high').length;

  return (
    <RequireAuth>
      <AppLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Target className="h-6 w-6" />
                My Buy Specs
              </h1>
              <p className="text-muted-foreground">
                Define what vehicles you want to buy
              </p>
            </div>
            <Link to="/dealer/specs/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Spec
              </Button>
            </Link>
          </div>

          {/* Search & Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search specs..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={filterActive ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterActive(!filterActive)}
                  >
                    <Filter className="h-4 w-4 mr-1" />
                    Active ({activeCount})
                  </Button>
                  <Button
                    variant={filterHigh ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterHigh(!filterHigh)}
                  >
                    <Flame className="h-4 w-4 mr-1" />
                    High ({highCount})
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Specs List */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">All Specs</CardTitle>
                  <CardDescription>
                    {filteredSpecs.length} of {specs.length} specs
                  </CardDescription>
                </div>
                <Badge variant="secondary">
                  {activeCount} active
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-28" />
                  ))}
                </div>
              ) : filteredSpecs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Target className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p className="font-medium">No specs found</p>
                  <p className="text-sm mt-1">
                    {specs.length === 0
                      ? 'Create your first spec to start getting matches'
                      : 'Try adjusting your filters'}
                  </p>
                  {specs.length === 0 && (
                    <Link to="/dealer/specs/new">
                      <Button className="mt-4">
                        <Plus className="h-4 w-4 mr-2" />
                        Create First Spec
                      </Button>
                    </Link>
                  )}
                </div>
              ) : (
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-3">
                    {filteredSpecs.map((spec) => (
                      <SpecCard
                        key={spec.id}
                        spec={spec}
                        onToggle={handleToggle}
                        onDuplicate={handleDuplicate}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    </RequireAuth>
  );
}
