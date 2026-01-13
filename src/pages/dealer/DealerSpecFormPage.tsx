import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  ArrowLeft, 
  Save, 
  Target, 
  Car, 
  MapPin, 
  DollarSign, 
  Bell,
  Sparkles,
  TrendingUp,
  ExternalLink
} from 'lucide-react';
import { toast } from 'sonner';
import { RequireAuth } from '@/components/guards/RequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';

// Validation schema
const specSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name too long'),
  make: z.string().trim().min(1, 'Make is required').max(50, 'Make too long'),
  model: z.string().trim().min(1, 'Model is required').max(50, 'Model too long'),
  variant_family: z.string().trim().max(50).optional().nullable(),
  priority: z.enum(['high', 'normal', 'low']),
  enabled: z.boolean(),
  region_scope: z.string(),
  year_min: z.number().int().min(2000).max(2030).optional().nullable(),
  year_max: z.number().int().min(2000).max(2030).optional().nullable(),
  km_min: z.number().int().min(0).optional().nullable(),
  km_max: z.number().int().min(0).max(500000).optional().nullable(),
  under_benchmark_pct: z.number().min(5).max(30),
  min_benchmark_confidence: z.enum(['low', 'med', 'high']),
  allow_no_benchmark: z.boolean(),
  hard_max_price: z.number().int().min(0).optional().nullable(),
  push_watchlist: z.boolean(),
  auto_buy_window: z.boolean(),
  slack_alerts: z.boolean(),
  va_tasks: z.boolean(),
  exploration_mode: z.boolean(),
});

type SpecFormData = z.infer<typeof specSchema>;

const REGIONS = [
  { id: 'NSW_CENTRAL_COAST', label: 'Central Coast NSW' },
  { id: 'NSW_SYDNEY_METRO', label: 'Sydney Metro' },
  { id: 'NSW_HUNTER_NEWCASTLE', label: 'Hunter/Newcastle' },
  { id: 'NSW_REGIONAL', label: 'Regional NSW' },
  { id: 'ALL', label: 'National (All Regions)' },
];

const FUELS = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'LPG'];
const TRANSMISSIONS = ['AUTO', 'MANUAL', 'CVT'];
const DRIVETRAINS = ['FWD', 'RWD', 'AWD', '4WD'];

interface SpecMatch {
  id: string;
  make: string;
  model: string;
  variant_used: string | null;
  year: number;
  km: number | null;
  asking_price: number | null;
  delta_pct: number | null;
  deal_label: string;
  source_class: string;
  listing_url: string | null;
  matched_at: string;
}

function SpecHitsPreview({ specId }: { specId: string }) {
  const [matches, setMatches] = useState<SpecMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<{
    total_30d: number;
    mispriced_count: number;
    strong_buy_count: number;
    watch_count: number;
  } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch summary
        const { data: summaryData } = await supabase
          .rpc('get_spec_hits_summary', { p_spec_id: specId });
        if (summaryData?.[0]) {
          setSummary(summaryData[0]);
        }

        // Fetch recent matches
        const { data: matchesData } = await supabase
          .from('dealer_spec_matches')
          .select('*')
          .eq('dealer_spec_id', specId)
          .order('matched_at', { ascending: false })
          .limit(10);
        
        setMatches((matchesData as SpecMatch[]) || []);
      } catch (error) {
        console.error('Error fetching hits:', error);
      } finally {
        setLoading(false);
      }
    };

    if (specId && specId !== 'new') {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [specId]);

  if (loading) {
    return <Skeleton className="h-64" />;
  }

  if (!summary || summary.total_30d === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Recent Matches
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No matches in the last 30 days
          </p>
        </CardContent>
      </Card>
    );
  }

  const dealLabelColors: Record<string, string> = {
    MISPRICED: 'bg-emerald-500/10 text-emerald-600',
    STRONG_BUY: 'bg-amber-500/10 text-amber-600',
    WATCH: 'bg-blue-500/10 text-blue-600',
    NO_BENCHMARK: 'bg-slate-500/10 text-slate-600',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Recent Matches (30d)
        </CardTitle>
        <CardDescription>
          {summary.total_30d} total matches
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary badges */}
        <div className="flex flex-wrap gap-2">
          {summary.mispriced_count > 0 && (
            <Badge className="bg-emerald-500/10 text-emerald-600">
              {summary.mispriced_count} Mispriced
            </Badge>
          )}
          {summary.strong_buy_count > 0 && (
            <Badge className="bg-amber-500/10 text-amber-600">
              {summary.strong_buy_count} Strong Buy
            </Badge>
          )}
          {summary.watch_count > 0 && (
            <Badge className="bg-blue-500/10 text-blue-600">
              {summary.watch_count} Watch
            </Badge>
          )}
        </div>

        {/* Recent matches list */}
        <ScrollArea className="h-[250px]">
          <div className="space-y-2">
            {matches.map((match) => (
              <div
                key={match.id}
                className="p-3 rounded-lg border border-border/60 bg-muted/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {match.year} {match.make} {match.model}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      {match.km && <span>{Math.round(match.km / 1000)}k km</span>}
                      {match.asking_price && (
                        <span>${match.asking_price.toLocaleString()}</span>
                      )}
                      {match.delta_pct !== null && (
                        <span className={match.delta_pct < 0 ? 'text-emerald-600' : 'text-red-500'}>
                          {match.delta_pct > 0 ? '+' : ''}{match.delta_pct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(match.matched_at), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={dealLabelColors[match.deal_label] || ''}>
                      {match.deal_label?.replace('_', ' ')}
                    </Badge>
                    {match.listing_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => window.open(match.listing_url!, '_blank')}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default function DealerSpecFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const isNew = id === 'new' || !id;
  
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const currentYear = new Date().getFullYear();
  
  const [form, setForm] = useState<SpecFormData>({
    name: '',
    make: '',
    model: '',
    variant_family: null,
    priority: 'normal',
    enabled: true,
    region_scope: 'NSW_CENTRAL_COAST',
    year_min: currentYear - 10,
    year_max: currentYear,
    km_min: null,
    km_max: null,
    under_benchmark_pct: 10,
    min_benchmark_confidence: 'med',
    allow_no_benchmark: true,
    hard_max_price: null,
    push_watchlist: true,
    auto_buy_window: true,
    slack_alerts: true,
    va_tasks: false,
    exploration_mode: false,
  });

  useEffect(() => {
    if (!isNew && id) {
      fetchSpec(id);
    }
  }, [id, isNew]);

  const fetchSpec = async (specId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('dealer_specs')
        .select('*')
        .eq('id', specId)
        .single();

      if (error) throw error;
      if (data) {
        setForm({
          name: data.name,
          make: data.make,
          model: data.model,
          variant_family: data.variant_family,
          priority: data.priority as 'high' | 'normal' | 'low',
          enabled: data.enabled,
          region_scope: data.region_scope,
          year_min: data.year_min,
          year_max: data.year_max,
          km_min: data.km_min,
          km_max: data.km_max,
          under_benchmark_pct: data.under_benchmark_pct || 10,
          min_benchmark_confidence: (data.min_benchmark_confidence as 'low' | 'med' | 'high') || 'med',
          allow_no_benchmark: data.allow_no_benchmark ?? true,
          hard_max_price: data.hard_max_price,
          push_watchlist: data.push_watchlist ?? true,
          auto_buy_window: data.auto_buy_window ?? true,
          slack_alerts: data.slack_alerts ?? true,
          va_tasks: data.va_tasks ?? false,
          exploration_mode: data.exploration_mode ?? false,
        });
      }
    } catch (error) {
      console.error('Error fetching spec:', error);
      toast.error('Failed to load spec');
      navigate('/dealer/specs');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    // Validate
    const result = specSchema.safeParse(form);
    if (!result.success) {
      const newErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          newErrors[err.path[0] as string] = err.message;
        }
      });
      setErrors(newErrors);
      toast.error('Please fix the validation errors');
      return;
    }

    // Year range sanity check
    if (form.year_min && form.year_max && form.year_min > form.year_max) {
      setErrors({ year_min: 'Min year cannot be greater than max year' });
      return;
    }

    // KM range sanity check
    if (form.km_min && form.km_max && form.km_min > form.km_max) {
      setErrors({ km_min: 'Min KM cannot be greater than max KM' });
      return;
    }

    setErrors({});
    setSaving(true);

    try {
      const payload = {
        name: form.name,
        make: form.make.toUpperCase().trim(),
        model: form.model.toUpperCase().trim(),
        variant_family: form.variant_family?.toUpperCase().trim() || null,
        priority: form.priority,
        enabled: form.enabled,
        region_scope: form.region_scope,
        year_min: form.year_min,
        year_max: form.year_max,
        km_min: form.km_min,
        km_max: form.km_max,
        under_benchmark_pct: form.under_benchmark_pct,
        min_benchmark_confidence: form.min_benchmark_confidence,
        allow_no_benchmark: form.allow_no_benchmark,
        hard_max_price: form.hard_max_price,
        push_watchlist: form.push_watchlist,
        auto_buy_window: form.auto_buy_window,
        slack_alerts: form.slack_alerts,
        va_tasks: form.va_tasks,
        exploration_mode: form.exploration_mode,
        dealer_id: currentUser?.id || crypto.randomUUID(),
        dealer_name: currentUser?.dealer_name || 'Unknown Dealer',
        updated_at: new Date().toISOString(),
      };

      if (isNew) {
        const { error } = await supabase.from('dealer_specs').insert([payload]);
        if (error) throw error;
        toast.success('Spec created');
      } else {
        const { error } = await supabase
          .from('dealer_specs')
          .update(payload)
          .eq('id', id);
        if (error) throw error;
        toast.success('Spec updated');
      }

      navigate('/dealer/specs');
    } catch (error) {
      console.error('Error saving spec:', error);
      toast.error('Failed to save spec');
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof SpecFormData>(field: K, value: SpecFormData[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  if (loading) {
    return (
      <RequireAuth>
        <AppLayout>
          <div className="space-y-6">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-96" />
          </div>
        </AppLayout>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <AppLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dealer/specs')}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">
                {isNew ? 'Create Spec' : 'Edit Spec'}
              </h1>
            </div>
            <Button onClick={handleSubmit} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save Spec'}
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Form */}
            <div className="lg:col-span-2 space-y-6">
              {/* Identity */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Identity
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="name">Spec Name *</Label>
                      <Input
                        id="name"
                        value={form.name}
                        onChange={(e) => updateField('name', e.target.value)}
                        placeholder="e.g., Corolla Hybrid Central Coast"
                        className={errors.name ? 'border-destructive' : ''}
                      />
                      {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Select value={form.priority} onValueChange={(v) => updateField('priority', v as 'high' | 'normal' | 'low')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 flex items-end">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="enabled"
                          checked={form.enabled}
                          onCheckedChange={(v) => updateField('enabled', v)}
                        />
                        <Label htmlFor="enabled">Active</Label>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Vehicle Definition */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Car className="h-5 w-5" />
                    Vehicle Definition
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="make">Make *</Label>
                      <Input
                        id="make"
                        value={form.make}
                        onChange={(e) => updateField('make', e.target.value)}
                        placeholder="TOYOTA"
                        className={errors.make ? 'border-destructive' : ''}
                      />
                      {errors.make && <p className="text-xs text-destructive">{errors.make}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="model">Model *</Label>
                      <Input
                        id="model"
                        value={form.model}
                        onChange={(e) => updateField('model', e.target.value)}
                        placeholder="COROLLA"
                        className={errors.model ? 'border-destructive' : ''}
                      />
                      {errors.model && <p className="text-xs text-destructive">{errors.model}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="variant_family">Variant (optional)</Label>
                      <Input
                        id="variant_family"
                        value={form.variant_family || ''}
                        onChange={(e) => updateField('variant_family', e.target.value || null)}
                        placeholder="HYBRID"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="year_min">Year Min</Label>
                      <Input
                        id="year_min"
                        type="number"
                        value={form.year_min || ''}
                        onChange={(e) => updateField('year_min', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder={String(currentYear - 10)}
                        className={errors.year_min ? 'border-destructive' : ''}
                      />
                      {errors.year_min && <p className="text-xs text-destructive">{errors.year_min}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="year_max">Year Max</Label>
                      <Input
                        id="year_max"
                        type="number"
                        value={form.year_max || ''}
                        onChange={(e) => updateField('year_max', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder={String(currentYear)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="km_min">KM Min</Label>
                      <Input
                        id="km_min"
                        type="number"
                        value={form.km_min || ''}
                        onChange={(e) => updateField('km_min', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder="0"
                        className={errors.km_min ? 'border-destructive' : ''}
                      />
                      {errors.km_min && <p className="text-xs text-destructive">{errors.km_min}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="km_max">KM Max</Label>
                      <Input
                        id="km_max"
                        type="number"
                        value={form.km_max || ''}
                        onChange={(e) => updateField('km_max', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder="80000"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Region */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Region
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label>Region Scope</Label>
                    <Select value={form.region_scope} onValueChange={(v) => updateField('region_scope', v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REGIONS.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Region guides matching and trend scoring. Vehicles can still sell cross-state.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Pricing Rules */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    Pricing & Opportunity Rules
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Alert when under benchmark by</Label>
                      <Select 
                        value={String(form.under_benchmark_pct)} 
                        onValueChange={(v) => updateField('under_benchmark_pct', parseFloat(v))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">5%</SelectItem>
                          <SelectItem value="10">10% (default)</SelectItem>
                          <SelectItem value="15">15%</SelectItem>
                          <SelectItem value="20">20%</SelectItem>
                          <SelectItem value="25">25%</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Min benchmark confidence</Label>
                      <Select 
                        value={form.min_benchmark_confidence} 
                        onValueChange={(v) => updateField('min_benchmark_confidence', v as 'low' | 'med' | 'high')}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low (1+ clears)</SelectItem>
                          <SelectItem value="med">Medium (3+ clears)</SelectItem>
                          <SelectItem value="high">High (5+ clears)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="hard_max_price">Hard Max Price (optional)</Label>
                      <Input
                        id="hard_max_price"
                        type="number"
                        value={form.hard_max_price || ''}
                        onChange={(e) => updateField('hard_max_price', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder="e.g., 35000"
                      />
                    </div>
                    <div className="space-y-2 flex items-end">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="allow_no_benchmark"
                          checked={form.allow_no_benchmark}
                          onCheckedChange={(v) => updateField('allow_no_benchmark', v)}
                        />
                        <Label htmlFor="allow_no_benchmark">Allow matches without benchmark</Label>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Output Controls */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bell className="h-5 w-5" />
                    Output Controls
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="push_watchlist"
                        checked={form.push_watchlist}
                        onCheckedChange={(v) => updateField('push_watchlist', v)}
                      />
                      <Label htmlFor="push_watchlist">Push to Watchlist</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="auto_buy_window"
                        checked={form.auto_buy_window}
                        onCheckedChange={(v) => updateField('auto_buy_window', v)}
                      />
                      <Label htmlFor="auto_buy_window">Auto BUY_WINDOW trigger</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="slack_alerts"
                        checked={form.slack_alerts}
                        onCheckedChange={(v) => updateField('slack_alerts', v)}
                      />
                      <Label htmlFor="slack_alerts">Slack alerts</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="va_tasks"
                        checked={form.va_tasks}
                        onCheckedChange={(v) => updateField('va_tasks', v)}
                      />
                      <Label htmlFor="va_tasks">Create VA tasks</Label>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Exploration Mode */}
              <Card className={form.exploration_mode ? 'border-purple-500/50' : ''}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-purple-500" />
                    Exploration Mode
                  </CardTitle>
                  <CardDescription>
                    Broaden matching to discover opportunities outside your usual specs
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="exploration_mode"
                      checked={form.exploration_mode}
                      onCheckedChange={(v) => updateField('exploration_mode', v)}
                    />
                    <Label htmlFor="exploration_mode">
                      Enable Exploration Mode
                    </Label>
                  </div>
                  {form.exploration_mode && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Variant requirement will be loosened, and year/km ranges slightly widened.
                      Results will be labeled as "Exploration" matches.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar - Hits Preview */}
            <div className="space-y-6">
              {!isNew && id && <SpecHitsPreview specId={id} />}
              
              {isNew && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Matches Preview
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Save the spec to see matching listings
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </AppLayout>
    </RequireAuth>
  );
}
