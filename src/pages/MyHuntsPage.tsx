import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DealerLayout } from '@/components/layout/DealerLayout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Trash2, Plus, ChevronDown, ChevronRight, Search, ExternalLink, Loader2, Flame, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { PushNotificationPrompt } from '@/components/notifications/PushNotificationPrompt';

const COMMON_MAKES = [
  'Toyota', 'Ford', 'Mazda', 'Hyundai', 'Kia', 'Nissan', 'Mitsubishi',
  'Isuzu', 'Subaru', 'Volkswagen', 'Land Rover', 'Holden', 'Honda',
  'BMW', 'Mercedes-Benz', 'Audi', 'Lexus', 'Jeep', 'RAM', 'Suzuki',
  'Volvo', 'Porsche', 'LDV', 'GWM', 'BYD', 'MG', 'Peugeot', 'Skoda',
];

const AUCTION_SOURCES = ['pickles', 'grays', 'manheim', 'slattery', 'auto_auctions', 'vma', 'bidsonline'];
const RETAIL_SOURCES = ['autotrader', 'carsales', 'easyauto'];
const ALL_SOURCES = [...AUCTION_SOURCES, ...RETAIL_SOURCES];
const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

interface Hunt {
  id: string;
  fingerprint_id: string;
  make: string;
  model: string;
  variant_family: string | null;
  year_min: number;
  year_max: number;
  is_active: boolean;
  dealer_profile_id: string | null;
}

interface HuntMatch {
  id: string;
  title?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  asking_price?: number | null;
  km?: number | null;
  source: string;
  source_type?: string;
  url?: string;
  listing_url?: string | null;
  decision?: string | null;
  matched_at?: string | null;
  location?: string | null;
}

export default function MyHuntsPage() {
  const { currentUser, dealerProfile } = useAuth();
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expandedHunts, setExpandedHunts] = useState<Set<string>>(new Set());
  const [huntMatches, setHuntMatches] = useState<Record<string, HuntMatch[]>>({});
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [loadingMatches, setLoadingMatches] = useState<Set<string>>(new Set());
  const [scanningHunts, setScanningHunts] = useState<Set<string>>(new Set());

  // Form state
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [variant, setVariant] = useState('');
  const [yearMin, setYearMin] = useState(new Date().getFullYear() - 3);
  const [yearMax, setYearMax] = useState(new Date().getFullYear());
  const [kmTarget, setKmTarget] = useState('');
  const selectedSources = ALL_SOURCES;
  const [selectedStates, setSelectedStates] = useState<string[]>([...AU_STATES]);
  const [makeSearch, setMakeSearch] = useState('');

  const dealerName = currentUser?.dealer_name;
  const dealerId = dealerProfile?.dealer_profile_id;

  const filteredMakes = useMemo(() => {
    if (!makeSearch) return COMMON_MAKES;
    const q = makeSearch.toLowerCase();
    return COMMON_MAKES.filter(m => m.toLowerCase().includes(q));
  }, [makeSearch]);

  const fetchHunts = async () => {
    if (!dealerName) return;
    const { data } = await supabase
      .from('dealer_fingerprints')
      .select('id, fingerprint_id, make, model, variant_family, year_min, year_max, is_active, dealer_profile_id')
      .eq('dealer_name', dealerName)
      .order('created_at', { ascending: false });
    setHunts(data || []);
    setLoading(false);

    // Fetch match counts for all hunts via sale_hunts linkage
    if (data?.length && dealerId) {
      fetchAllMatchCounts(data);
    }
  };

  const fetchAllMatchCounts = async (huntList: Hunt[]) => {
    if (!dealerId) return;
    // Get sale_hunts for this dealer
    const { data: saleHunts } = await supabase
      .from('sale_hunts')
      .select('id, make, model')
      .eq('dealer_id', dealerId)
      .eq('status', 'active');

    if (!saleHunts?.length) return;

    const counts: Record<string, number> = {};
    for (const hunt of huntList) {
      const sh = saleHunts.find(s =>
        s.make.toUpperCase() === hunt.make.toUpperCase() &&
        s.model.toUpperCase() === hunt.model.toUpperCase()
      );
      if (sh) {
        const { count } = await supabase
          .from('hunt_unified_candidates')
          .select('id', { count: 'exact', head: true })
          .eq('hunt_id', sh.id)
          .in('decision', ['BUY', 'WATCH', 'UNVERIFIED']);
        counts[hunt.id] = count || 0;
      }
    }
    setMatchCounts(counts);
  };

  useEffect(() => { fetchHunts(); }, [dealerName]);

  const fetchMatchesForHunt = async (hunt: Hunt) => {
    if (huntMatches[hunt.id]) return; // already loaded
    if (!dealerId) return;

    setLoadingMatches(prev => new Set(prev).add(hunt.id));

    // Find corresponding sale_hunt
    const { data: saleHunts } = await supabase
      .from('sale_hunts')
      .select('id')
      .eq('dealer_id', dealerId)
      .eq('make', hunt.make.toUpperCase())
      .eq('model', hunt.model.toUpperCase())
      .eq('status', 'active')
      .limit(1);

    const saleHuntId = saleHunts?.[0]?.id;
    if (!saleHuntId) {
      setHuntMatches(prev => ({ ...prev, [hunt.id]: [] }));
      setLoadingMatches(prev => { const n = new Set(prev); n.delete(hunt.id); return n; });
      return;
    }

    // Try hunt_unified_candidates first
    const { data: unified } = await supabase
      .from('hunt_unified_candidates')
      .select('id, hunt_id, decision, url, title, asking_price, km, year, source, source_type, location, created_at')
      .eq('hunt_id', saleHuntId)
      .in('decision', ['BUY', 'WATCH', 'UNVERIFIED'])
      .order('created_at', { ascending: false })
      .limit(20);

    if (unified?.length) {
      setHuntMatches(prev => ({
        ...prev,
        [hunt.id]: unified.map(u => ({
          id: u.id,
          title: u.title,
          year: u.year,
          asking_price: u.asking_price,
          km: u.km,
          source: u.source,
          source_type: u.source_type || undefined,
          url: u.url,
          decision: u.decision,
          matched_at: u.created_at,
          location: u.location,
        })),
      }));
    } else {
      // Fallback to hunt_matches
      const { data: matches } = await supabase
        .from('hunt_matches')
        .select('id, hunt_id, listing_id, asking_price, decision, matched_at')
        .eq('hunt_id', saleHuntId)
        .in('decision', ['buy', 'watch'])
        .order('matched_at', { ascending: false })
        .limit(20);

      if (matches?.length) {
        const listingIds = matches.map(m => m.listing_id);
        const { data: listings } = await supabase
          .from('vehicle_listings')
          .select('id, make, model, year, km, listing_url, source, variant_used')
          .in('id', listingIds);

        const listingMap = new Map((listings || []).map(l => [l.id, l]));
        setHuntMatches(prev => ({
          ...prev,
          [hunt.id]: matches.map(m => {
            const l = listingMap.get(m.listing_id);
            return {
              id: m.id,
              title: l ? `${l.year} ${l.make} ${l.model} ${l.variant_used || ''}`.trim() : undefined,
              year: l?.year,
              asking_price: m.asking_price,
              km: l?.km,
              source: l?.source || 'unknown',
              listing_url: l?.listing_url,
              decision: m.decision?.toUpperCase(),
              matched_at: m.matched_at,
            };
          }),
        }));
      } else {
        setHuntMatches(prev => ({ ...prev, [hunt.id]: [] }));
      }
    }

    setLoadingMatches(prev => { const n = new Set(prev); n.delete(hunt.id); return n; });
  };

  const toggleExpanded = (hunt: Hunt) => {
    setExpandedHunts(prev => {
      const n = new Set(prev);
      if (n.has(hunt.id)) {
        n.delete(hunt.id);
      } else {
        n.add(hunt.id);
        fetchMatchesForHunt(hunt);
      }
      return n;
    });
  };

  const toggleHunt = async (hunt: Hunt, active: boolean) => {
    await supabase.from('dealer_fingerprints').update({ is_active: active }).eq('id', hunt.id);
    // Also update sale_hunts
    if (dealerId) {
      await supabase
        .from('sale_hunts')
        .update({ status: active ? 'active' : 'paused' })
        .eq('dealer_id', dealerId)
        .eq('make', hunt.make.toUpperCase())
        .eq('model', hunt.model.toUpperCase());
    }
    setHunts(prev => prev.map(h => h.id === hunt.id ? { ...h, is_active: active } : h));
    toast.success(active ? 'Hunt activated' : 'Hunt paused');
  };

  const deleteHunt = async (hunt: Hunt) => {
    await supabase.from('dealer_fingerprints').delete().eq('id', hunt.id);
    // Also delete sale_hunts
    if (dealerId) {
      await supabase
        .from('sale_hunts')
        .delete()
        .eq('dealer_id', dealerId)
        .eq('make', hunt.make.toUpperCase())
        .eq('model', hunt.model.toUpperCase());
    }
    setHunts(prev => prev.filter(h => h.id !== hunt.id));
    toast.success('Hunt deleted');
  };

  const createHunt = async () => {
    if (!make.trim() || !model.trim() || !dealerName || !dealerId) return;
    setCreating(true);

    try {
      // 1. Insert dealer_fingerprints
      const { error: fpErr } = await supabase.from('dealer_fingerprints').insert({
        fingerprint_id: `${make.toUpperCase()}_${model.toUpperCase()}_${Date.now()}`,
        dealer_name: dealerName,
        dealer_profile_id: dealerId,
        make: make.trim(),
        model: model.trim(),
        variant_family: variant.trim() || null,
        year_min: yearMin,
        year_max: yearMax,
        min_km: kmTarget ? Math.round(Number(kmTarget) * 0.8) : null,
        max_km: kmTarget ? Math.round(Number(kmTarget) * 1.2) : null,
        is_active: true,
      });
      if (fpErr) throw fpErr;

      // 2. Insert sale_hunts
      const { error: shErr } = await supabase.from('sale_hunts').insert({
        dealer_id: dealerId,
        status: 'active',
        priority: 5,
        year: Math.round((yearMin + yearMax) / 2),
        make: make.trim(),
        model: model.trim(),
        variant_family: variant.trim() || null,
        km: kmTarget ? Number(kmTarget) : null,
        km_tolerance_pct: 20,
        sources_enabled: selectedSources,
        include_private: false,
        states: selectedStates.length === 8 ? null : selectedStates,
        geo_mode: 'state',
        max_listing_age_days_buy: 7,
        max_listing_age_days_watch: 14,
        proven_exit_method: 'sale_snapshot',
        min_gap_abs_buy: 800,
        min_gap_pct_buy: 4.0,
        min_gap_abs_watch: 400,
        min_gap_pct_watch: 2.0,
      });
      if (shErr) console.warn('sale_hunts insert:', shErr.message);

      toast.success('Hunt created');
      setShowForm(false);
      resetForm();
      fetchHunts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create hunt');
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setMake(''); setModel(''); setVariant('');
    setYearMin(new Date().getFullYear() - 3);
    setYearMax(new Date().getFullYear());
    setKmTarget('');
    // selectedSources is now always ALL_SOURCES
    setSelectedStates([...AU_STATES]);
    setMakeSearch('');
  };

  const runScan = async (hunt: Hunt) => {
    if (!dealerId) return;
    setScanningHunts(prev => new Set(prev).add(hunt.id));

    // Find sale_hunt
    const { data: saleHunts } = await supabase
      .from('sale_hunts')
      .select('id')
      .eq('dealer_id', dealerId)
      .eq('make', hunt.make.toUpperCase())
      .eq('model', hunt.model.toUpperCase())
      .eq('status', 'active')
      .limit(1);

    const huntId = saleHunts?.[0]?.id;
    if (!huntId) {
      toast.error('No active scan config found for this hunt');
      setScanningHunts(prev => { const n = new Set(prev); n.delete(hunt.id); return n; });
      return;
    }

    const { data, error } = await supabase.functions.invoke('run-hunt-scan', {
      body: { hunt_id: huntId },
    });

    if (error) {
      toast.error('Scan failed');
    } else {
      toast.success(`Found ${data?.results?.[0]?.matches || 0} matches`);
      // Refresh matches
      setHuntMatches(prev => { const n = { ...prev }; delete n[hunt.id]; return n; });
      if (expandedHunts.has(hunt.id)) {
        fetchMatchesForHunt(hunt);
      }
      fetchAllMatchCounts(hunts);
    }

    setScanningHunts(prev => { const n = new Set(prev); n.delete(hunt.id); return n; });
  };

  const toggleSource = (_source: string) => {
    // No-op: all sources always enabled
    );
  };

  const toggleState = (state: string) => {
    setSelectedStates(prev =>
      prev.includes(state) ? prev.filter(s => s !== state) : [...prev, state]
    );
  };

  return (
    <DealerLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Hunts</h1>
            <p className="text-sm text-muted-foreground">{hunts.length} hunt{hunts.length !== 1 ? 's' : ''}</p>
          </div>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4 mr-1" /> New Hunt
          </Button>
        </div>

        <PushNotificationPrompt showOnMount />

        {/* Inline creation form */}
        <Collapsible open={showForm} onOpenChange={setShowForm}>
          <CollapsibleContent>
            <div className="rounded-lg border border-border bg-card p-5 mb-6 space-y-4">
              <h3 className="font-semibold text-foreground">Create Hunt</h3>

              {/* Make */}
              <div className="space-y-1.5">
                <Label>Make</Label>
                <Input
                  placeholder="Search make..."
                  value={makeSearch || make}
                  onChange={(e) => { setMakeSearch(e.target.value); setMake(''); }}
                />
                {makeSearch && !make && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {filteredMakes.slice(0, 12).map(m => (
                      <Button
                        key={m} variant="outline" size="sm"
                        className="h-7 text-xs"
                        onClick={() => { setMake(m); setMakeSearch(''); }}
                      >
                        {m}
                      </Button>
                    ))}
                  </div>
                )}
                {make && <Badge variant="secondary">{make}</Badge>}
              </div>

              {/* Model */}
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Input placeholder="e.g. Hilux, X5, A-Class" value={model} onChange={(e) => setModel(e.target.value)} />
              </div>

              {/* Variant */}
              <div className="space-y-1.5">
                <Label>Variant / Badge (optional)</Label>
                <Input placeholder="e.g. SR5, M Sport" value={variant} onChange={(e) => setVariant(e.target.value)} />
              </div>

              {/* Year Range */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Year Min</Label>
                  <Input type="number" value={yearMin} onChange={(e) => setYearMin(Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Year Max</Label>
                  <Input type="number" value={yearMax} onChange={(e) => setYearMax(Number(e.target.value))} />
                </div>
              </div>

              {/* KM Target */}
              <div className="space-y-1.5">
                <Label>KM Target (optional)</Label>
                <Input type="number" placeholder="e.g. 80000" value={kmTarget} onChange={(e) => setKmTarget(e.target.value)} />
              </div>

              {/* Sources - always all, no user selection needed */}
              <p className="text-sm text-muted-foreground">
                We search all auctions, dealers, and marketplaces automatically.
              </p>

              {/* States */}
              <div className="space-y-1.5">
                <Label>States</Label>
                <div className="flex flex-wrap gap-3">
                  {AU_STATES.map(s => (
                    <label key={s} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={selectedStates.includes(s)}
                        onCheckedChange={() => toggleState(s)}
                      />
                      <span>{s}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={createHunt} disabled={!make.trim() || !model.trim() || creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Create Hunt
                </Button>
                <Button variant="ghost" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Hunt list */}
        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : hunts.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-3">No hunts yet</p>
            <Button variant="outline" onClick={() => setShowForm(true)}>Create your first hunt</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {hunts.map((hunt) => {
              const isExpanded = expandedHunts.has(hunt.id);
              const matches = huntMatches[hunt.id];
              const count = matchCounts[hunt.id];
              const isLoadingMatches = loadingMatches.has(hunt.id);
              const isScanning = scanningHunts.has(hunt.id);

              return (
                <div key={hunt.id} className="rounded-lg border border-border bg-card overflow-hidden">
                  {/* Hunt header */}
                  <div className="flex items-center gap-3 p-4">
                    <button
                      onClick={() => toggleExpanded(hunt)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>

                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpanded(hunt)}>
                      <p className="font-medium text-foreground truncate">
                        {hunt.make} {hunt.model}
                        {hunt.variant_family && <span className="text-muted-foreground"> · {hunt.variant_family}</span>}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{hunt.year_min}–{hunt.year_max}</span>
                        {count !== undefined && count > 0 && (
                          <Badge variant="secondary" className="text-xs">{count} match{count !== 1 ? 'es' : ''}</Badge>
                        )}
                      </div>
                    </div>

                    <Button
                      variant="outline" size="sm"
                      onClick={() => runScan(hunt)}
                      disabled={isScanning || !hunt.is_active}
                      className="text-xs"
                    >
                      {isScanning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
                      Scan
                    </Button>

                    <Switch
                      checked={hunt.is_active}
                      onCheckedChange={(checked) => toggleHunt(hunt, checked)}
                    />
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => deleteHunt(hunt)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Expanded matches */}
                  {isExpanded && (
                    <div className="border-t border-border bg-muted/20 p-4">
                      {isLoadingMatches ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading matches...
                        </div>
                      ) : !matches?.length ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No matches yet. Hit "Scan" to search.</p>
                      ) : (
                        <div className="space-y-2">
                          {matches.map(match => (
                            <MatchCard key={match.id} match={match} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DealerLayout>
  );
}

function MatchCard({ match }: { match: HuntMatch }) {
  const isBuy = match.decision === 'BUY' || match.decision === 'buy';
  const isWatch = match.decision === 'WATCH' || match.decision === 'watch';
  const linkUrl = match.url || match.listing_url;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {match.title || `${match.year || ''} ${match.make || ''} ${match.model || ''}`.trim() || 'Unknown Vehicle'}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
          {match.km && <span>{match.km.toLocaleString()} km</span>}
          {match.asking_price && <span>${match.asking_price.toLocaleString()}</span>}
          {match.source && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {AUCTION_SOURCES.includes(match.source.toLowerCase()) ? 'Auction' : 'Retail'}
            </Badge>
          )}
          {match.location && <span>{match.location}</span>}
          {match.matched_at && (
            <span>{formatDistanceToNow(new Date(match.matched_at), { addSuffix: true })}</span>
          )}
        </div>
      </div>

      {isBuy && (
        <Badge className="bg-green-600 hover:bg-green-700 text-white text-xs gap-1">
          <Flame className="h-3 w-3" /> Hot
        </Badge>
      )}
      {isWatch && (
        <Badge variant="outline" className="border-amber-500 text-amber-600 text-xs gap-1">
          <Eye className="h-3 w-3" /> Watching
        </Badge>
      )}

      {linkUrl && (
        <a href={linkUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </a>
      )}
    </div>
  );
}
