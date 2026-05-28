import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface StrategicProfile {
  id: string;
  franchise_brand: string | null;
  preferred_brands: string[] | null;
  dealership_category: string | null;
  specialist_categories: string[] | null;
  location_state: string | null;
  location_suburb: string | null;
  location_postcode: string | null;
  natural_buyer_notes: string | null;
}

const CATEGORIES = ['franchise', 'used_specialist', 'prestige', 'wholesale', 'independent'];
const SPECIALTIES = ['family_suv', '4x4', 'european_prestige', 'commercial', 'sports', 'ev_hybrid'];

export function DealerStrategicProfileCard({ accountId }: { accountId: string }) {
  const [data, setData] = useState<StrategicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferredInput, setPreferredInput] = useState('');

  useEffect(() => {
    (async () => {
      const { data: row, error } = await supabase
        .from('dealer_profiles')
        .select('id, franchise_brand, preferred_brands, dealership_category, specialist_categories, location_state, location_suburb, location_postcode, natural_buyer_notes')
        .eq('account_id', accountId)
        .maybeSingle();
      if (error) toast.error(error.message);
      if (row) {
        setData(row as StrategicProfile);
        setPreferredInput((row.preferred_brands || []).join(', '));
      }
      setLoading(false);
    })();
  }, [accountId]);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    const brands = preferredInput.split(',').map(s => s.trim()).filter(Boolean);
    const { error } = await supabase
      .from('dealer_profiles')
      .update({
        franchise_brand: data.franchise_brand || null,
        preferred_brands: brands,
        dealership_category: data.dealership_category || null,
        specialist_categories: data.specialist_categories || [],
        location_state: data.location_state || null,
        location_suburb: data.location_suburb || null,
        location_postcode: data.location_postcode || null,
        natural_buyer_notes: data.natural_buyer_notes || null,
        strategic_profile_updated_at: new Date().toISOString(),
      })
      .eq('id', data.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Strategic profile saved. Re-runs of the scorer will use this.');
  };

  const reEnrich = async () => {
    const { error } = await supabase.functions.invoke('enrich-strategic-fit', { body: {} });
    if (error) { toast.error(error.message); return; }
    toast.success('Strategic-fit enrichment triggered.');
  };

  const toggleSpecialty = (s: string) => {
    if (!data) return;
    const cur = new Set(data.specialist_categories || []);
    cur.has(s) ? cur.delete(s) : cur.add(s);
    setData({ ...data, specialist_categories: Array.from(cur) });
  };

  if (loading) return <Card><CardContent className="py-6"><Loader2 className="h-4 w-4 animate-spin" /></CardContent></Card>;
  if (!data) return <Card><CardContent className="py-6 text-sm text-muted-foreground">No dealer profile linked to this account.</CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>Strategic Dealer Fit</CardTitle>
            <CardDescription>
              Identity-based natural-buyer signal. Used alongside sales history when matching listings.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={reEnrich}>
              <Sparkles className="h-3 w-3 mr-1" />Re-run enrichment
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium mb-1 block">Franchise brand</label>
          <Input
            placeholder="e.g. Subaru (leave blank for independents)"
            value={data.franchise_brand || ''}
            onChange={(e) => setData({ ...data, franchise_brand: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Dealership category</label>
          <Select value={data.dealership_category || ''} onValueChange={(v) => setData({ ...data, dealership_category: v })}>
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium mb-1 block">Preferred brands (comma-separated)</label>
          <Input
            placeholder="e.g. Subaru, Mazda, Toyota"
            value={preferredInput}
            onChange={(e) => setPreferredInput(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium mb-1 block">Specialist categories</label>
          <div className="flex flex-wrap gap-1.5">
            {SPECIALTIES.map(s => {
              const on = (data.specialist_categories || []).includes(s);
              return (
                <Badge
                  key={s}
                  onClick={() => toggleSpecialty(s)}
                  variant={on ? 'default' : 'outline'}
                  className="cursor-pointer"
                >
                  {s}
                </Badge>
              );
            })}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">State</label>
          <Input placeholder="NSW" value={data.location_state || ''} onChange={(e) => setData({ ...data, location_state: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Suburb</label>
          <Input placeholder="Port Macquarie" value={data.location_suburb || ''} onChange={(e) => setData({ ...data, location_suburb: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Postcode</label>
          <Input placeholder="2444" value={data.location_postcode || ''} onChange={(e) => setData({ ...data, location_postcode: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium mb-1 block">Natural buyer notes</label>
          <Textarea
            placeholder="Free-text — why this dealer is a natural buyer for certain stock."
            value={data.natural_buyer_notes || ''}
            onChange={(e) => setData({ ...data, natural_buyer_notes: e.target.value })}
            rows={3}
          />
        </div>
      </CardContent>
    </Card>
  );
}
