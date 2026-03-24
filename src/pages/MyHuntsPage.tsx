import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DealerLayout } from '@/components/layout/DealerLayout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

interface Hunt {
  id: string;
  make: string;
  model: string;
  variant_family: string | null;
  year_min: number;
  year_max: number;
  is_active: boolean;
}

export default function MyHuntsPage() {
  const { currentUser } = useAuth();
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [loading, setLoading] = useState(true);

  const dealerName = currentUser?.dealer_name;

  const fetchHunts = async () => {
    if (!dealerName) return;
    const { data } = await supabase
      .from('dealer_fingerprints')
      .select('id, make, model, variant_family, year_min, year_max, is_active')
      .eq('dealer_name', dealerName)
      .order('created_at', { ascending: false });
    setHunts(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchHunts(); }, [dealerName]);

  const toggleHunt = async (id: string, active: boolean) => {
    await supabase.from('dealer_fingerprints').update({ is_active: active }).eq('id', id);
    setHunts((prev) => prev.map((h) => (h.id === id ? { ...h, is_active: active } : h)));
    toast.success(active ? 'Hunt activated' : 'Hunt paused');
  };

  const deleteHunt = async (id: string) => {
    await supabase.from('dealer_fingerprints').delete().eq('id', id);
    setHunts((prev) => prev.filter((h) => h.id !== id));
    toast.success('Hunt deleted');
  };

  return (
    <DealerLayout>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Hunts</h1>
            <p className="text-sm text-muted-foreground">{hunts.length} hunt{hunts.length !== 1 ? 's' : ''}</p>
          </div>
          <Link to="/find-cars">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> New Hunt
            </Button>
          </Link>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : hunts.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-3">No hunts yet</p>
            <Link to="/trading-desk">
              <Button variant="outline">Create your first hunt</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {hunts.map((hunt) => (
              <div
                key={hunt.id}
                className="flex items-center gap-4 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {hunt.make} {hunt.model}
                    {hunt.variant_family && <span className="text-muted-foreground"> · {hunt.variant_family}</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {hunt.year_min}–{hunt.year_max}
                  </p>
                </div>
                <Switch
                  checked={hunt.is_active}
                  onCheckedChange={(checked) => toggleHunt(hunt.id, checked)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteHunt(hunt.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </DealerLayout>
  );
}
