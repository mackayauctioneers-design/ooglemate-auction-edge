import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Settings2, Target, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { OperatorGuard } from '@/components/guards/OperatorGuard';
import { OperatorLayout } from '@/components/layout/OperatorLayout';

interface DealerSpec {
  id: string;
  dealer_id: string;
  dealer_name: string;
  enabled: boolean;
  make: string;
  model: string;
  variant_family: string | null;
  fuel: string | null;
  transmission: string | null;
  drivetrain: string | null;
  year_min: number | null;
  year_max: number | null;
  km_max: number | null;
  region_scope: string;
  region_id: string | null;
  min_under_pct: number | null;
  require_benchmark: boolean;
  note: string | null;
  created_at: string;
}

const REGIONS = [
  { id: 'NSW_CENTRAL_COAST', label: 'Central Coast NSW' },
  { id: 'NSW_SYDNEY', label: 'Sydney NSW' },
  { id: 'NSW_HUNTER', label: 'Hunter NSW' },
  { id: 'NSW_REGIONAL', label: 'Regional NSW' },
  { id: 'VIC_METRO', label: 'Melbourne VIC' },
  { id: 'QLD_METRO', label: 'Brisbane QLD' },
];

function SpecCard({ spec, onToggle, onDelete }: { 
  spec: DealerSpec; 
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={`p-4 rounded-lg border ${spec.enabled ? 'border-border bg-card' : 'border-border/40 bg-muted/30 opacity-60'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{spec.make} {spec.model}</span>
            {spec.variant_family && (
              <Badge variant="outline" className="text-xs">{spec.variant_family}</Badge>
            )}
            <Badge variant={spec.enabled ? 'default' : 'secondary'} className="text-xs">
              {spec.enabled ? 'Active' : 'Paused'}
            </Badge>
          </div>
          
          <p className="text-sm text-muted-foreground mt-1">
            For: {spec.dealer_name}
          </p>
          
          <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
            {spec.year_min && spec.year_max && (
              <span>{spec.year_min}–{spec.year_max}</span>
            )}
            {spec.km_max && (
              <span>≤{Math.round(spec.km_max / 1000)}k km</span>
            )}
            {spec.min_under_pct && spec.min_under_pct > 0 && (
              <span>≥{spec.min_under_pct}% under</span>
            )}
            <span className="capitalize">{spec.region_scope.toLowerCase()}</span>
            {spec.region_id && (
              <span>{spec.region_id}</span>
            )}
          </div>
          
          {spec.note && (
            <p className="text-xs text-muted-foreground mt-2 italic">{spec.note}</p>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Switch 
            checked={spec.enabled} 
            onCheckedChange={(checked) => onToggle(spec.id, checked)}
          />
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 w-8 p-0 text-destructive"
            onClick={() => onDelete(spec.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddSpecDialog({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    dealer_id: '',
    dealer_name: '',
    make: '',
    model: '',
    variant_family: '',
    year_min: '',
    year_max: '',
    km_max: '',
    region_scope: 'REGION',
    region_id: 'NSW_CENTRAL_COAST',
    min_under_pct: '10',
    require_benchmark: false,
    note: '',
  });

  const handleSubmit = async () => {
    if (!form.make || !form.model || !form.dealer_name) {
      toast.error('Make, Model, and Dealer Name are required');
      return;
    }

    setSaving(true);
    try {
      // Generate a placeholder dealer_id if not provided
      const dealerId = form.dealer_id || crypto.randomUUID();

      const { error } = await supabase.from('dealer_match_specs').insert({
        dealer_id: dealerId,
        dealer_name: form.dealer_name,
        make: form.make.toUpperCase(),
        model: form.model.toUpperCase(),
        variant_family: form.variant_family || null,
        year_min: form.year_min ? parseInt(form.year_min) : null,
        year_max: form.year_max ? parseInt(form.year_max) : null,
        km_max: form.km_max ? parseInt(form.km_max) : null,
        region_scope: form.region_scope,
        region_id: form.region_scope === 'REGION' ? form.region_id : null,
        min_under_pct: form.min_under_pct ? parseFloat(form.min_under_pct) : 10,
        require_benchmark: form.require_benchmark,
        note: form.note || null,
        enabled: true,
      });

      if (error) throw error;

      toast.success('Spec added');
      setOpen(false);
      onAdd();
      // Reset form
      setForm({
        dealer_id: '',
        dealer_name: '',
        make: '',
        model: '',
        variant_family: '',
        year_min: '',
        year_max: '',
        km_max: '',
        region_scope: 'REGION',
        region_id: 'NSW_CENTRAL_COAST',
        min_under_pct: '10',
        require_benchmark: false,
        note: '',
      });
    } catch (error) {
      console.error('Error adding spec:', error);
      toast.error('Failed to add spec');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Spec
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Dealer Spec</DialogTitle>
          <DialogDescription>
            Define what vehicles a dealer wants to buy
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dealer_name">Dealer Name *</Label>
              <Input
                id="dealer_name"
                value={form.dealer_name}
                onChange={(e) => setForm({ ...form, dealer_name: e.target.value })}
                placeholder="Brian Hilton Toyota"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dealer_id">Dealer ID (optional)</Label>
              <Input
                id="dealer_id"
                value={form.dealer_id}
                onChange={(e) => setForm({ ...form, dealer_id: e.target.value })}
                placeholder="UUID or leave blank"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="make">Make *</Label>
              <Input
                id="make"
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
                placeholder="TOYOTA"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model *</Label>
              <Input
                id="model"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="COROLLA"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="variant_family">Variant Family (optional)</Label>
            <Input
              id="variant_family"
              value={form.variant_family}
              onChange={(e) => setForm({ ...form, variant_family: e.target.value })}
              placeholder="HYBRID"
            />
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="year_min">Year Min</Label>
              <Input
                id="year_min"
                type="number"
                value={form.year_min}
                onChange={(e) => setForm({ ...form, year_min: e.target.value })}
                placeholder="2019"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="year_max">Year Max</Label>
              <Input
                id="year_max"
                type="number"
                value={form.year_max}
                onChange={(e) => setForm({ ...form, year_max: e.target.value })}
                placeholder="2023"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="km_max">Max KM</Label>
              <Input
                id="km_max"
                type="number"
                value={form.km_max}
                onChange={(e) => setForm({ ...form, km_max: e.target.value })}
                placeholder="80000"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Region Scope</Label>
              <Select value={form.region_scope} onValueChange={(v) => setForm({ ...form, region_scope: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REGION">Region Only</SelectItem>
                  <SelectItem value="NATIONAL">National</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.region_scope === 'REGION' && (
              <div className="space-y-2">
                <Label>Region</Label>
                <Select value={form.region_id} onValueChange={(v) => setForm({ ...form, region_id: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="min_under_pct">Min Under % (benchmark)</Label>
              <Input
                id="min_under_pct"
                type="number"
                value={form.min_under_pct}
                onChange={(e) => setForm({ ...form, min_under_pct: e.target.value })}
                placeholder="10"
              />
            </div>
            <div className="space-y-2 flex items-center pt-8">
              <Switch
                id="require_benchmark"
                checked={form.require_benchmark}
                onCheckedChange={(checked) => setForm({ ...form, require_benchmark: checked })}
              />
              <Label htmlFor="require_benchmark" className="ml-2">Require Benchmark</Label>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="note">Note</Label>
            <Input
              id="note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Optional notes..."
            />
          </div>
        </div>
        
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving...' : 'Add Spec'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DealerSpecsPage() {
  const [specs, setSpecs] = useState<DealerSpec[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSpecs();
  }, []);

  const fetchSpecs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('dealer_match_specs')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSpecs((data as DealerSpec[]) || []);
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
        .from('dealer_match_specs')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      setSpecs(specs.map((s) => (s.id === id ? { ...s, enabled } : s)));
      toast.success(enabled ? 'Spec enabled' : 'Spec paused');
    } catch (error) {
      console.error('Error toggling spec:', error);
      toast.error('Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this spec? This will also delete all related alerts.')) return;

    try {
      const { error } = await supabase
        .from('dealer_match_specs')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setSpecs(specs.filter((s) => s.id !== id));
      toast.success('Spec deleted');
    } catch (error) {
      console.error('Error deleting spec:', error);
      toast.error('Failed to delete');
    }
  };

  const activeCount = specs.filter((s) => s.enabled).length;

  return (
    <OperatorGuard>
      <OperatorLayout>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Settings2 className="h-6 w-6" />
                Dealer Buy Specs
              </h1>
              <p className="text-muted-foreground">
                Configure what vehicles dealers want to buy
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={fetchSpecs}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <AddSpecDialog onAdd={fetchSpecs} />
            </div>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">All Specs</CardTitle>
                <Badge variant="secondary" className="ml-auto">
                  {activeCount} active / {specs.length} total
                </Badge>
              </div>
              <CardDescription>
                Listings matching specs will generate alerts
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
              ) : specs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Target className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p>No specs configured yet</p>
                  <p className="text-sm">Add a spec to start getting match alerts</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-3">
                    {specs.map((spec) => (
                      <SpecCard
                        key={spec.id}
                        spec={spec}
                        onToggle={handleToggle}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </OperatorLayout>
    </OperatorGuard>
  );
}
