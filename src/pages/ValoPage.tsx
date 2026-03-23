import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useBob, ValoFormFillData } from '@/contexts/BobContext';
import { useSearchParams } from 'react-router-dom';
import { DealerLayout } from '@/components/layout/DealerLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, CheckCircle, DollarSign, TrendingUp, BarChart3,
  Sparkles, Target, Camera, AlertTriangle, Mic, MicOff,
  ExternalLink, ChevronDown, ChevronUp, X, Upload, ShieldCheck, ImageIcon,
  Search,
} from 'lucide-react';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { useAuth } from '@/contexts/AuthContext';
import { ValoParsedVehicle, ValoResult, ValoTier, ValuationConfidence, formatCurrency } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

declare const __BUILD_TIME__: string;

const ACCESSORY_PRESETS = [
  'Bullbar', 'Towbar', 'Canopy', 'ARB', 'Norweld Tray',
  'Snorkel', 'Lift Kit', 'Roof Racks', 'Side Steps', 'Winch',
];

const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const COMMON_MAKES = [
  'Toyota', 'Ford', 'Mazda', 'Hyundai', 'Kia', 'Nissan', 'Mitsubishi',
  'Isuzu', 'Subaru', 'Volkswagen', 'Land Rover', 'Holden', 'Honda',
  'BMW', 'Mercedes-Benz', 'Audi', 'Lexus', 'Jeep', 'RAM', 'Suzuki',
  'Volvo', 'Porsche', 'LDV', 'GWM', 'BYD', 'MG', 'Peugeot', 'Skoda',
];

const CONFIDENCE_INFO: Record<string, { label: string; color: string; explanation: string }> = {
  HIGH: { label: 'HIGH', color: 'bg-green-500 hover:bg-green-600', explanation: 'Strong like-for-like comp depth.' },
  MEDIUM: { label: 'MEDIUM', color: 'bg-yellow-500 hover:bg-yellow-600 text-black', explanation: 'Good comp set, some variance.' },
  LOW: { label: 'LOW', color: '', explanation: 'Wider market spread or limited like-for-like comps.' },
};

// ============================================================================
// VALO — Market-Backed Trade-In Valuation Tool
// ============================================================================

export default function ValoPage() {
  const { currentUser, isAdmin, dealerProfile } = useAuth();
  const [searchParams] = useSearchParams();
  const { onValoFormFill } = useBob();
  const handleRunValoRef = useRef<(() => void) | null>(null);
  // Structured identity
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [makeSearch, setMakeSearch] = useState('');
  const [makeOpen, setMakeOpen] = useState(false);
  const [stateFilter, setStateFilter] = useState('');

  // Description / voice (supplementary only)
  const [description, setDescription] = useState('');

  // Voice
  const handleVoiceResult = useCallback((transcript: string) => {
    setDescription(prev => prev ? `${prev} ${transcript}` : transcript);
  }, []);
  const { isListening, isSupported, toggle: toggleVoice } = useSpeechToText({
    onResult: handleVoiceResult,
    lang: 'en-AU',
  });

  // Model suggestions from taxonomy
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (!make) { setModelSuggestions([]); return; }
    const fetchModels = async () => {
      const { data } = await supabase
        .from('taxonomy_models')
        .select('canonical_model')
        .eq('make', make.trim())
        .order('canonical_model');
      if (data) setModelSuggestions([...new Set(data.map(d => d.canonical_model).filter(Boolean))]);
    };
    fetchModels();
  }, [make]);

  const filteredMakes = useMemo(() => {
    if (!makeSearch) return COMMON_MAKES;
    const q = makeSearch.toLowerCase();
    return COMMON_MAKES.filter(m => m.toLowerCase().includes(q));
  }, [makeSearch]);

  // Remaining structured inputs
  const [year, setYear] = useState('');
  const [km, setKm] = useState('');
  const [badge, setBadge] = useState('');
  const [condition, setCondition] = useState<string>('good');
  const [allowance, setAllowance] = useState<string>('1000');
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);
  const [customAccessory, setCustomAccessory] = useState('');

  // Processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [valoPhase, setValoPhase] = useState<string>('');
  const [parsed, setParsed] = useState<ValoParsedVehicle | null>(null);
  const [result, setResult] = useState<ValoResult | null>(null);
  const [valoComps, setValoComps] = useState<any[]>([]);
  const [oancaDebug, setOancaDebug] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [expandedComp, setExpandedComp] = useState<number | null>(null);

  // Market Commentary (lazy CaroogleAI layer)
  const [commentaryOpen, setCommentaryOpen] = useState(false);
  const [commentaryText, setCommentaryText] = useState<string | null>(null);
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [valoRawData, setValoRawData] = useState<any>(null);

  // MODO state
  const [modoPhotos, setModoPhotos] = useState<File[]>([]);
  const [modoPhotoUrls, setModoPhotoUrls] = useState<string[]>([]);
  const [isModoRunning, setIsModoRunning] = useState(false);
  const [modoResult, setModoResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prefillText = searchParams.get('prefill');
    if (prefillText) setDescription(decodeURIComponent(prefillText));
  }, [searchParams]);

  useEffect(() => {
    document.title = 'Do A Valo | OogleMate';
    return () => { document.title = 'OogleMate'; };
  }, []);

  // Bob form fill listener
  useEffect(() => {
    const handleBobFormFill = (data: ValoFormFillData) => {
      if (data.make) setMake(data.make);
      if (data.model) setModel(data.model);
      if (data.year) setYear(data.year);
      if (data.km) setKm(data.km);
      if (data.badge) setBadge(data.badge);
      if (data.condition) setCondition(data.condition);
      if (data.description) setDescription(data.description);
      toast.success(`Bob filled: ${data.year || ''} ${data.make || ''} ${data.model || ''}`.trim());
      // Auto-run after a brief delay to let state settle
      if (data.autoRun) {
        setTimeout(() => {
          handleRunValoRef.current?.();
        }, 300);
      }
    };
    onValoFormFill(handleBobFormFill);
    return () => onValoFormFill(null);
  }, [onValoFormFill]);

  const toggleAccessory = (acc: string) => {
    setSelectedAccessories(prev =>
      prev.includes(acc) ? prev.filter(a => a !== acc) : [...prev, acc]
    );
  };
  const addCustomAccessory = () => {
    const trimmed = customAccessory.trim();
    if (trimmed && !selectedAccessories.includes(trimmed)) {
      setSelectedAccessories(prev => [...prev, trimmed]);
      setCustomAccessory('');
    }
  };

  const authReady = !!(dealerProfile?.account_id);
  const canRunValo = make.trim().length > 0 && model.trim().length > 0 && year.trim().length > 0 && km.trim().length > 0;
  const badgeMissing = canRunValo && !badge.trim();

  const handleRunValo = async () => {
    if (!make.trim() || !model.trim()) {
      toast.error('Make and Model are required for VALO');
      return;
    }
    const yearNum = parseInt(year, 10);
    if (!year.trim() || isNaN(yearNum) || yearNum < 1980 || yearNum > new Date().getFullYear() + 1) {
      toast.error('Valid year is required for VALO');
      return;
    }
    const kmNum = parseInt(km, 10);
    if (!km.trim() || isNaN(kmNum) || kmNum <= 0) {
      toast.error('Kilometres is required for VALO');
      return;
    }

    setParsed(null);
    setResult(null);
    setValoComps([]);
    setOancaDebug(null);
    setModoResult(null);
    setModoPhotos([]);
    setModoPhotoUrls([]);
    setCommentaryOpen(false);
    setCommentaryText(null);
    setIsProcessing(true);
    setValoPhase('Parsing vehicle identity…');

    try {
      // Build structured identity — no LLM parsing needed
      const parsedVehicle: ValoParsedVehicle = {
        make: make.trim(),
        model: model.trim(),
        series: null, // Will be derived by backend from model text
        variant_family: badge.trim() || null,
        variant_raw: badge.trim() || null,
        year: yearNum,
        km: kmNum,
        body_style: null,
        engine: null,
        transmission: null,
        drivetrain: null,
        notes: description.trim() || null,
        missing_fields: [],
        assumptions: [],
      };
      setParsed(parsedVehicle);

      // Build instruction string for backend (supplementary)
      let fullInstruction = `${yearNum} ${make} ${model}`;
      if (badge.trim()) fullInstruction += ` ${badge.trim()}`;
      fullInstruction += ` ${kmNum}km`;
      if (description.trim()) fullInstruction += ` — ${description.trim()}`;

      // Build filters object
      const filters: Record<string, unknown> = {
        make: make.trim(),
        model: model.trim(),
        year_min: yearNum,
        year_max: yearNum,
        max_km: kmNum,
        condition,
        allowance_aud: parseInt(allowance, 10) || 1000,
      };
      if (badge.trim()) filters.badge = badge.trim();
      if (stateFilter && stateFilter !== 'any') filters.state = stateFilter;
      if (selectedAccessories.length > 0) {
        filters.accessory_terms = selectedAccessories.map(a => a.toUpperCase());
      }

      setValoPhase('Searching internal database…');
      
      // Simulate phase progression with timers since backend is a single call
      const phaseTimer1 = setTimeout(() => setValoPhase('Running CaroogleAI market discovery…'), 3000);
      const phaseTimer2 = setTimeout(() => setValoPhase('Running outward market search…'), 12000);
      const phaseTimer3 = setTimeout(() => setValoPhase('Scoring comparables & computing valuation…'), 22000);

      // Run VALO — skip valo-parse, go direct to run-valo-v1
      const { data: valoData, error: valoError } = await supabase.functions.invoke('run-valo-v1', {
        body: {
          instruction: fullInstruction,
          km: kmNum,
          account_id: dealerProfile?.account_id ?? null,
          initiated_by: 'dealer',
          full_market_scan: true,
          filters,
        }
      });

      // Clear phase timers
      clearTimeout(phaseTimer1);
      clearTimeout(phaseTimer2);
      clearTimeout(phaseTimer3);
      setValoPhase('Finalising results…');

      if (valoError) throw new Error(valoError.message);
      if (valoData?.status === 'missing_required_fields') {
        toast.error(`Missing: ${valoData.missing?.join(', ')}`);
        setIsProcessing(false);
        return;
      }
      if (valoData?.status === 'error') throw new Error(valoData.error);

      setValoRawData(valoData);
      if (isAdmin) setOancaDebug(valoData);

      // Update parsed vehicle with backend-derived series
      if (valoData.parsed_intent?.series) {
        parsedVehicle.series = valoData.parsed_intent.series;
        setParsed({ ...parsedVehicle });
      }

      const comps: any[] = [];
      if (valoData.anchor) comps.push({ ...valoData.anchor, _role: 'anchor' });
      if (valoData.backups) valoData.backups.forEach((b: any) => comps.push({ ...b, _role: 'backup' }));
      setValoComps(comps);

      const offer = valoData.trade_in_offer;
      const market = valoData.market;

      // Buy Range = trade-in offer (what dealer pays to acquire)
      const buyMin = offer ? offer.low : null;
      const buyMax = offer ? offer.high : null;
      // Sell Range = market asking prices (what dealer can list for)
      const sellMin = market ? market.p25 : null;
      const sellMax = market ? market.p75 : null;
      // Gross Band = sell - buy (expected profit margin)
      const grossMin = (sellMin != null && buyMax != null) ? sellMin - buyMax : null;
      const grossMax = (sellMax != null && buyMin != null) ? sellMax - buyMin : null;

      setResult({
        parsed: parsedVehicle,
        suggested_buy_range: buyMin != null && buyMax != null ? { min: buyMin, max: buyMax } : null,
        suggested_sell_range: sellMin != null && sellMax != null ? { min: sellMin, max: sellMax } : null,
        expected_gross_band: grossMin != null && grossMax != null
          ? { min: grossMin, max: grossMax }
          : null,
        cheapest_trade_guide: valoData.cheapest_trade_guide ?? null,
        typical_days_to_sell: null,
        confidence: valoData.confidence === 'HIGH' ? 'HIGH' : valoData.confidence === 'MED' ? 'MEDIUM' : 'LOW',
        tier: 'dealer',
        tier_label: `VALO (${valoData.comp_count} comps)`,
        sample_size: valoData.comp_count ?? 0,
        top_comps: comps,
        request_id: valoData.valo_run_id ?? crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      });

      toast.success('Valuation complete');
    } catch (err) {
      console.error('VALO error:', err);
      toast.error(err instanceof Error ? err.message : 'Valuation failed');
    } finally {
      setIsProcessing(false);
      setValoPhase('');
    }
  };

  // Keep ref updated for Bob auto-run
  useEffect(() => {
    handleRunValoRef.current = handleRunValo;
  });

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(f => f.type.startsWith('image/')).slice(0, 6 - modoPhotos.length);
    if (validFiles.length === 0) return;
    setModoPhotos(prev => [...prev, ...validFiles].slice(0, 6));
  };

  const removePhoto = (index: number) => {
    setModoPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleRunModo = async () => {
    if (modoPhotos.length < 3 || !parsed) return;
    setIsModoRunning(true);

    try {
      // Upload photos to valo-photos bucket
      const uploadedUrls: string[] = [];
      const runId = result?.request_id ?? crypto.randomUUID();

      for (let i = 0; i < modoPhotos.length; i++) {
        const file = modoPhotos[i];
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `modo/${runId}/${i}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('valo-photos')
          .upload(path, file, { upsert: true });

        if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);

        const { data: signedData } = await supabase.storage
          .from('valo-photos')
          .createSignedUrl(path, 3600);

        if (signedData?.signedUrl) uploadedUrls.push(signedData.signedUrl);
      }

      setModoPhotoUrls(uploadedUrls);

      // Call MODO
      const { data: modoData, error: modoError } = await supabase.functions.invoke('run-modo-evaluation', {
        body: {
          vehicle_identity: {
            make: parsed.make,
            model: parsed.model,
            variant_family: parsed.variant_family || null,
            year: parsed.year || parseInt(year, 10),
            km: parsed.km || parseInt(km, 10),
          },
          dealer_input: {
            condition_stated: condition,
            allowance: parseInt(allowance, 10) || 1000,
            description_transcript: description.trim(),
          },
          photos: uploadedUrls,
        }
      });

      if (modoError) throw new Error(modoError.message);
      if (modoData?.error) throw new Error(modoData.error);

      setModoResult(modoData);
      toast.success('MODO assessment complete');
    } catch (err) {
      console.error('MODO error:', err);
      toast.error(err instanceof Error ? err.message : 'MODO assessment failed');
    } finally {
      setIsModoRunning(false);
    }
  };

  const confidenceBadge = (c: ValuationConfidence) => {
    const info = CONFIDENCE_INFO[c] || CONFIDENCE_INFO.LOW;
    if (c === 'LOW') return <Badge variant="destructive">{info.label}</Badge>;
    return <Badge className={info.color}>{info.label}</Badge>;
  };

  const tierBadge = (t: ValoTier) => {
    const map = {
      dealer: 'border-green-500 text-green-700',
      network: 'border-blue-500 text-blue-700',
      proxy: 'border-muted-foreground',
    };
    const labels = { dealer: 'Dealer History', network: 'Network', proxy: 'Proxy' };
    return <Badge variant="outline" className={map[t]}>{labels[t]}</Badge>;
  };

  const handleCommentaryToggle = async () => {
    if (commentaryOpen) {
      setCommentaryOpen(false);
      return;
    }
    setCommentaryOpen(true);
    if (commentaryText) return; // already fetched

    if (!result || !valoRawData?.market) return;
    setCommentaryLoading(true);

    try {
      const market = valoRawData.market;
      const offer = valoRawData.trade_in_offer;
      const vehicleLabel = [parsed?.year, parsed?.make, parsed?.model, parsed?.variant_family].filter(Boolean).join(' ');

      // Compute state breakdown from comps
      const stateMap = new Map<string, { prices: number[]; count: number }>();
      valoComps.forEach((c: any) => {
        const st = c.state;
        const price = c.price ?? c.effective_cost;
        if (st && price > 0) {
          const entry = stateMap.get(st) || { prices: [], count: 0 };
          entry.prices.push(price);
          entry.count++;
          stateMap.set(st, entry);
        }
      });
      const stateBreakdown = Array.from(stateMap.entries()).map(([state, d]) => {
        const sorted = [...d.prices].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
        return { state, median, count: d.count };
      });

      const prices = valoComps
        .map((c: any) => c.price ?? c.effective_cost)
        .filter((p: number) => p != null && p > 0);
      const spreadPct = prices.length >= 2
        ? (((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100).toFixed(1)
        : '0';

      const { data, error } = await supabase.functions.invoke('valo-market-commentary', {
        body: {
          vehicle: vehicleLabel,
          floor: market.p25,
          median: market.median,
          ceiling: market.p75,
          spread_pct: parseFloat(spreadPct),
          comp_count: market.comp_count,
          trimmed: market.trimmed,
          confidence: valoRawData.confidence,
          state_breakdown: stateBreakdown,
          trade_in_offer: offer,
        },
      });

      if (error) throw new Error(error.message);
      setCommentaryText(data?.commentary || 'No commentary available.');
    } catch (err) {
      console.error('Commentary error:', err);
      setCommentaryText('Commentary unavailable.');
    } finally {
      setCommentaryLoading(false);
    }
  };

  return (
    <DealerLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              Do A Valo
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Market-backed trade-in valuation using real comparable vehicles.
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDebug(!showDebug)}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  showDebug ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'
                }`}
              >
                🔧 Debug
              </button>
              <Badge variant="outline" className="text-xs font-mono">
                {import.meta.env.MODE} | {__BUILD_TIME__}
              </Badge>
            </div>
          )}
        </div>

        {/* ── Section 1: Vehicle Identity ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Vehicle Identity
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Make, Model, Year and Kilometres are required for valuation.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Row 1: Make + Model (identity core) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Make — searchable dropdown */}
              <div>
                <Label>Make <span className="text-destructive">*</span></Label>
                <Popover open={makeOpen} onOpenChange={setMakeOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline" role="combobox" aria-expanded={makeOpen}
                      className="w-full justify-between mt-1 font-normal"
                    >
                      {make || <span className="text-muted-foreground">Select make…</span>}
                      <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search makes…" value={makeSearch} onValueChange={setMakeSearch} />
                      <CommandList>
                        <CommandEmpty>
                          <button
                            type="button"
                            className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded cursor-pointer"
                            onMouseDown={(e) => { e.preventDefault(); setMake(makeSearch.trim()); setModel(''); setMakeOpen(false); setMakeSearch(''); }}
                          >
                            Use "{makeSearch}"
                          </button>
                        </CommandEmpty>
                        <CommandGroup>
                          {filteredMakes.map(m => (
                            <CommandItem key={m} value={m} onSelect={() => { setMake(m); setModel(''); setMakeOpen(false); setMakeSearch(''); }}>
                              {m}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Model — input with datalist suggestions from taxonomy */}
              <div>
                <Label>Model <span className="text-destructive">*</span></Label>
                <div className="relative mt-1">
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={make ? 'e.g. HiLux, Ranger…' : 'Select make first'}
                    disabled={!make}
                    list="model-suggestions"
                  />
                  {modelSuggestions.length > 0 && (
                    <datalist id="model-suggestions">
                      {modelSuggestions.map(m => <option key={m} value={m} />)}
                    </datalist>
                  )}
                </div>
              </div>
            </div>

            {/* Row 2: Badge, Year, KM, State */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="badge">Variant / Badge</Label>
                <Input
                  id="badge" value={badge} onChange={(e) => setBadge(e.target.value)}
                  placeholder="e.g. SR5, LS-U" className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {badgeMissing ? (
                    <span className="text-action-watch">Badge not provided — matching will be broader.</span>
                  ) : (
                    'Improves matching accuracy'
                  )}
                </p>
              </div>
              <div>
                <Label htmlFor="year">Year <span className="text-destructive">*</span></Label>
                <Input
                  id="year" type="number" value={year} onChange={(e) => setYear(e.target.value)}
                  placeholder="e.g. 2021" className="mt-1" min={1980} max={new Date().getFullYear() + 1}
                />
              </div>
              <div>
                <Label htmlFor="km">Kilometres <span className="text-destructive">*</span></Label>
                <Input
                  id="km" type="number" value={km} onChange={(e) => setKm(e.target.value)}
                  placeholder="e.g. 45000" className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="state">State</Label>
                <Select value={stateFilter} onValueChange={setStateFilter}>
                  <SelectTrigger id="state" className="mt-1">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    {AU_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 3: Condition + Allowance */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="condition">Condition</Label>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger id="condition" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="excellent">Excellent</SelectItem>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="fair">Fair</SelectItem>
                    <SelectItem value="poor">Poor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="allowance">Allowance ($)</Label>
                <Input
                  id="allowance" type="number" value={allowance}
                  onChange={(e) => setAllowance(e.target.value)} placeholder="1000" className="mt-1"
                />
              </div>
            </div>

            {/* Accessory Chips */}
            <div>
              <Label>Accessories / Features (optional)</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {ACCESSORY_PRESETS.map(acc => (
                  <button
                    key={acc} type="button" onClick={() => toggleAccessory(acc)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedAccessories.includes(acc)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {acc}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <Input
                  value={customAccessory} onChange={(e) => setCustomAccessory(e.target.value)}
                  placeholder="Add custom…" className="h-8 text-xs"
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomAccessory())}
                />
                <Button type="button" variant="outline" size="sm" onClick={addCustomAccessory} className="h-8 text-xs">Add</Button>
              </div>
              {selectedAccessories.filter(a => !ACCESSORY_PRESETS.includes(a)).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {selectedAccessories.filter(a => !ACCESSORY_PRESETS.includes(a)).map(acc => (
                    <Badge key={acc} variant="secondary" className="gap-1 text-xs">
                      {acc}
                      <button onClick={() => toggleAccessory(acc)} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Additional Notes (supplementary) */}
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="vehicle-notes">Additional Notes (optional)</Label>
                {isSupported && (
                  <Button
                    type="button" variant="ghost" size="sm"
                    onClick={toggleVoice}
                    className={`gap-1.5 text-xs ${isListening ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    {isListening ? 'Stop' : 'Voice'}
                  </Button>
                )}
              </div>
              <Textarea
                id="vehicle-notes"
                placeholder="Any extra detail — colour, features, damage notes…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={`mt-1 ${isListening ? 'ring-2 ring-destructive/50' : ''}`}
              />
            </div>

            {/* Validation message */}
            {!canRunValo && (make || model || year || km) && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Make, Model, Year and Kilometres are required for valuation.
              </p>
            )}

            <Button
              onClick={handleRunValo}
              disabled={isProcessing || !canRunValo || !authReady}
              className="w-full gap-2" size="lg"
              title={!authReady ? 'Loading dealer profile…' : !canRunValo ? 'Fill in Make, Model, Year and KM' : undefined}
            >
              {isProcessing ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {valoPhase || 'Running Valuation…'}</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Run VALO</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* ── Section 2: Parsed Vehicle ── */}
        {parsed && !isProcessing && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Parsed Vehicle
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                {[
                  ['Year', parsed.year],
                  ['Make', parsed.make],
                  ['Model', parsed.model],
                  ['Series', parsed.series],
                  ['Variant', parsed.variant_family || parsed.variant_raw],
                  ['Body', parsed.body_style],
                  ['Engine', parsed.engine],
                  ['Transmission', parsed.transmission],
                  ['KM', parsed.km ? parsed.km.toLocaleString() : null],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <p className="text-muted-foreground">{label as string}</p>
                    <p className="font-medium">{(value as string | number) || '—'}</p>
                  </div>
                ))}
              </div>
              {parsed.missing_fields.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1">
                  {parsed.missing_fields.map(field => (
                    <Badge key={field} variant="outline" className="text-xs text-muted-foreground">{field} unknown</Badge>
                  ))}
                </div>
              )}
              {parsed.assumptions.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                  <strong>Assumptions:</strong> {parsed.assumptions.join('; ')}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Section 3: Valuation Results ── */}
        {result && result.sample_size > 0 && !isProcessing && (
          <>
            {/* Confidence + Tier */}
            <div className="flex flex-wrap items-center gap-2">
              {confidenceBadge(result.confidence)}
              {tierBadge(result.tier)}
              <Badge variant="secondary">Based on {result.sample_size} comparables</Badge>
            </div>

            {/* Confidence explanation */}
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${
              result.confidence === 'LOW' ? 'border-destructive/30 bg-destructive/5' :
              result.confidence === 'MEDIUM' ? 'border-yellow-500/30 bg-yellow-500/5' :
              'border-green-500/30 bg-green-500/5'
            }`}>
              <ShieldCheck className={`h-4 w-4 mt-0.5 shrink-0 ${
                result.confidence === 'LOW' ? 'text-destructive' :
                result.confidence === 'MEDIUM' ? 'text-yellow-500' : 'text-green-500'
              }`} />
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Confidence: {result.confidence}</span>
                {' — '}
                {CONFIDENCE_INFO[result.confidence]?.explanation}
              </p>
            </div>

            {/* Market Range Cards — hide Days to Sell if unavailable */}
            <div className={`grid grid-cols-2 ${result.typical_days_to_sell ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4`}>
              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <DollarSign className="h-4 w-4" /> Buy Range
                </div>
                <div className="text-lg font-semibold">
                  {result.suggested_buy_range
                    ? `${formatCurrency(result.suggested_buy_range.min)} – ${formatCurrency(result.suggested_buy_range.max)}`
                    : '—'}
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4" /> Sell Range
                </div>
                <div className="text-lg font-semibold">
                  {result.suggested_sell_range
                    ? `${formatCurrency(result.suggested_sell_range.min)} – ${formatCurrency(result.suggested_sell_range.max)}`
                    : '—'}
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <BarChart3 className="h-4 w-4" /> Gross Band
                </div>
                <div className={`text-lg font-semibold ${
                  result.expected_gross_band && result.expected_gross_band.min > 0 ? 'text-green-600' :
                  result.expected_gross_band && result.expected_gross_band.max < 0 ? 'text-destructive' : ''
                }`}>
                  {result.expected_gross_band
                    ? `${formatCurrency(result.expected_gross_band.min)} – ${formatCurrency(result.expected_gross_band.max)}`
                    : '—'}
                </div>
              </Card>
              {result.typical_days_to_sell && (
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <BarChart3 className="h-4 w-4" /> Days to Sell
                  </div>
                  <div className="text-lg font-semibold">
                    ~{Math.round(result.typical_days_to_sell)} days
                  </div>
                </Card>
              )}
            </div>

            {/* ── Cheapest Comparable Trade Guide ── */}
            {result.cheapest_trade_guide && (
              <Card className="border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">Trade Guide (Cheapest Comp)</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Cheapest comparable: {formatCurrency(result.cheapest_trade_guide.anchor_price)}
                  {result.cheapest_trade_guide.anchor_source && ` via ${result.cheapest_trade_guide.anchor_source}`}
                  {result.cheapest_trade_guide.anchor_location && ` (${result.cheapest_trade_guide.anchor_location})`}
                  {result.cheapest_trade_guide.anchor_year && ` — ${result.cheapest_trade_guide.anchor_year}`}
                  {result.cheapest_trade_guide.anchor_km != null && `, ${Math.round(result.cheapest_trade_guide.anchor_km / 1000)}k km`}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-2 rounded bg-background border">
                    <div className="text-[10px] text-muted-foreground uppercase">Floor (20%)</div>
                    <div className="text-base font-bold">{formatCurrency(result.cheapest_trade_guide.floor)}</div>
                  </div>
                  <div className="text-center p-2 rounded bg-primary/10 border border-primary/30">
                    <div className="text-[10px] text-primary uppercase font-medium">Mid (15%)</div>
                    <div className="text-base font-bold text-primary">{formatCurrency(result.cheapest_trade_guide.mid)}</div>
                  </div>
                  <div className="text-center p-2 rounded bg-background border">
                    <div className="text-[10px] text-muted-foreground uppercase">Ceiling (10%)</div>
                    <div className="text-base font-bold">{formatCurrency(result.cheapest_trade_guide.ceiling)}</div>
                  </div>
                </div>
              </Card>
            )}

            {/* ── Market Commentary (collapsible, CaroogleAI) ── */}
            <div className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={handleCommentaryToggle}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                <span>{commentaryOpen ? '▼' : '▶'} Show Market Commentary</span>
                {commentaryLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </button>
              {commentaryOpen && (
                <div className="px-4 pb-4 border-t border-border">
                  {commentaryLoading ? (
                    <p className="text-sm text-muted-foreground py-3 animate-pulse">
                      Analysing market structure…
                    </p>
                  ) : commentaryText ? (
                    <div className="text-sm text-foreground py-3 space-y-1.5 leading-relaxed whitespace-pre-line">
                      {commentaryText}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* ── Top Comparables ── */}
            {valoComps.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  Top Comparables
                </h3>
                <p className="text-[10px] text-muted-foreground -mt-1">
                  Comps filtered to ±1 year and ±20,000 km (approx).
                </p>
                {valoComps.map((comp, i) => {
                  const isAnchor = comp._role === 'anchor';
                  const isExpanded = expandedComp === i;
                  const hasUrl = !!comp.url;
                  return (
                    <div key={i} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition-colors ${
                      isAnchor ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-muted/30'
                    }`}>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge className={`text-[9px] px-1 py-0 leading-tight ${isAnchor ? 'bg-primary text-primary-foreground' : ''}`} variant={isAnchor ? 'default' : 'outline'}>
                            {isAnchor ? 'ANCHOR' : 'BACKUP'}
                          </Badge>
                          <span className="font-medium text-xs text-foreground truncate">
                            {comp.title || `${comp.year ?? ''} ${comp.make ?? ''} ${comp.model ?? ''} ${comp.variant ?? ''}`.trim()}
                          </span>
                          {comp.variant && !comp.title?.includes(comp.variant) && (
                            <span className="text-[10px] text-muted-foreground">{comp.variant}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground flex-wrap">
                          {(comp.price ?? comp.effective_cost) != null && (
                            <span className="font-medium text-foreground">${(comp.price ?? comp.effective_cost).toLocaleString()}</span>
                          )}
                          {comp.km != null && <span>{comp.km.toLocaleString()} km</span>}
                          {comp.state && comp.state !== 'null' && <span>{comp.state}</span>}
                          {comp.source && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 leading-tight">
                              {comp.source === 'internal_db' ? 'Internal' : comp.source === 'drive' ? 'Drive' : comp.source === 'carsales' ? 'Carsales' : comp.source === 'perplexity' || comp.source === 'caroogleai' ? 'CaroogleAI' : comp.source}
                            </Badge>
                          )}
                          {comp.valo_score != null && <span className="font-mono">S:{comp.valo_score}</span>}
                        </div>
                        {comp.feature_hits?.length > 0 && (
                          <div className="flex flex-wrap gap-0.5">
                            {comp.feature_hits.map((hit: string) => (
                              <Badge key={hit} variant="secondary" className="text-[9px] px-1 py-0 gap-0.5 leading-tight">
                                <CheckCircle className="h-2 w-2 text-green-500" />{hit}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {isExpanded && (
                          <div className="mt-1.5 pt-1.5 border-t border-border space-y-1.5 text-[10px]">
                            {comp.valo_reasons?.length > 0 && (
                              <div className="flex flex-wrap gap-0.5">
                                {comp.valo_reasons.map((r: string) => (
                                  <span key={r} className="px-1 py-0 rounded bg-muted font-mono text-[9px]">{r}</span>
                                ))}
                              </div>
                            )}
                            {comp.feature_evidence?.length > 0 && comp.feature_evidence.map((fe: any, j: number) => (
                              <div key={j} className="flex gap-1.5 text-muted-foreground">
                                <Badge variant="outline" className="text-[9px] shrink-0 px-1 py-0">{fe.code}</Badge>
                                <span className="italic truncate">…{fe.snippet}…</span>
                              </div>
                            ))}
                            {comp.description && (
                              <p className="text-muted-foreground line-clamp-2">{comp.description}</p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 shrink-0 items-end">
                        {hasUrl && (
                          <a href={comp.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <button
                          onClick={() => setExpandedComp(isExpanded ? null : i)}
                          className="text-[9px] text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? '▲' : '▼'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* No data */}
        {result && result.sample_size === 0 && !isProcessing && (
          <Card className="border-destructive/30">
            <CardContent className="py-8 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
              <p className="font-medium">No comparable data found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Insufficient market data to produce a valuation for this vehicle.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Section 4: MODO — Photo Assessment ── */}
        {result && result.sample_size > 0 && !isProcessing && (
          <Card className={modoResult ? 'border-green-500/30' : 'border-dashed'}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="h-4 w-4 text-primary" />
                Refine with Photos (MODO)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!modoResult ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Upload 3–6 photos for condition assessment. MODO will identify damage, confirm accessories, and adjust the recon buffer.
                  </p>

                  {/* Photo upload area */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {modoPhotos.map((file, i) => (
                      <div key={i} className="relative aspect-square rounded-md overflow-hidden border bg-muted">
                        <img src={URL.createObjectURL(file)} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 p-0.5 rounded-full bg-background/80 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {modoPhotos.length < 6 && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="aspect-square rounded-md border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      >
                        <ImageIcon className="h-5 w-5" />
                        <span className="text-[10px]">Add</span>
                      </button>
                    )}
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoSelect} />

                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handleRunModo}
                      disabled={modoPhotos.length < 3 || isModoRunning}
                      className="gap-2"
                    >
                      {isModoRunning ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Assessing…</>
                      ) : (
                        <><Camera className="h-4 w-4" /> Send to MODO</>
                      )}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {modoPhotos.length}/3 minimum photos
                    </span>
                  </div>
                </>
              ) : (
                /* MODO Results */
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Condition</p>
                      <p className="font-semibold text-lg">{modoResult.condition_rating}/5</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Recon Buffer</p>
                      <p className="font-semibold text-lg">${modoResult.recommended_recon_buffer?.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Damage Flags</p>
                      <p className="font-medium">{modoResult.damage_flags?.length || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Risk Flags</p>
                      <p className={`font-medium ${modoResult.risk_flags?.length > 0 ? 'text-destructive' : ''}`}>
                        {modoResult.risk_flags?.length || 0}
                      </p>
                    </div>
                  </div>

                  {/* Confirmed accessories */}
                  {modoResult.visible_accessories?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium mb-1">Confirmed Accessories</p>
                      <div className="flex flex-wrap gap-1">
                        {modoResult.visible_accessories.map((acc: string) => (
                          <Badge key={acc} variant="secondary" className="text-xs gap-1">
                            <CheckCircle className="h-3 w-3 text-green-500" />{acc}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Damage flags */}
                  {modoResult.damage_flags?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium mb-1">Damage Flags</p>
                      <div className="flex flex-wrap gap-1">
                        {modoResult.damage_flags.map((flag: string) => (
                          <Badge key={flag} variant="outline" className="text-xs text-destructive border-destructive/50">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Risk flags */}
                  {modoResult.risk_flags?.length > 0 && (
                    <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
                      <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium">Risk Flags</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {modoResult.risk_flags.map((flag: string) => (
                            <Badge key={flag} variant="destructive" className="text-xs">{flag}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {modoResult.notes && (
                    <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                      <strong>MODO Notes:</strong> {modoResult.notes}
                    </div>
                  )}

                  <Button variant="outline" size="sm" onClick={() => { setModoResult(null); setModoPhotos([]); }}>
                    Re-assess with new photos
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Debug Panel ── */}
        {isAdmin && showDebug && oancaDebug && (
          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                🔧 VALO Debug
                <Badge variant="outline" className="text-xs">{oancaDebug.status}</Badge>
                <Badge variant="secondary" className="text-xs">{oancaDebug.confidence}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-xs">
              <pre className="overflow-auto max-h-64 p-2 rounded bg-muted/50">
                {JSON.stringify(oancaDebug, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </DealerLayout>
  );
}
