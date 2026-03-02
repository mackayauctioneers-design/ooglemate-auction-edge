import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DealerLayout } from '@/components/layout/DealerLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, CheckCircle, DollarSign, TrendingUp, BarChart3, Clock,
  Sparkles, Target, ShieldCheck, Camera, AlertTriangle, Mic, MicOff,
  ExternalLink, ChevronDown, ChevronUp, X
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

declare const __BUILD_TIME__: string;

// ── Accessory presets ──
const ACCESSORY_PRESETS = [
  'Bullbar', 'Towbar', 'Canopy', 'ARB', 'Norweld Tray',
  'Snorkel', 'Lift Kit', 'Roof Racks', 'Side Steps', 'Winch',
];

// ============================================================================
// VALO — Market-Backed Trade-In Valuation Tool
// ============================================================================

export default function ValoPage() {
  const { currentUser, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();

  // Input state
  const [description, setDescription] = useState('');
  const [km, setKm] = useState('');
  const [condition, setCondition] = useState<string>('good');
  const [allowance, setAllowance] = useState<string>('1000');
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);
  const [customAccessory, setCustomAccessory] = useState('');

  // Voice input
  const handleVoiceResult = useCallback((transcript: string) => {
    setDescription(prev => prev ? `${prev} ${transcript}` : transcript);
  }, []);
  const { isListening, isSupported, toggle: toggleVoice } = useSpeechToText({
    onResult: handleVoiceResult,
    lang: 'en-AU',
  });

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsed, setParsed] = useState<ValoParsedVehicle | null>(null);
  const [result, setResult] = useState<ValoResult | null>(null);
  const [valoComps, setValoComps] = useState<any[]>([]);
  const [oancaDebug, setOancaDebug] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [expandedComp, setExpandedComp] = useState<number | null>(null);

  // Prefill from URL
  useEffect(() => {
    const prefillText = searchParams.get('prefill');
    if (prefillText) setDescription(decodeURIComponent(prefillText));
  }, [searchParams]);

  useEffect(() => {
    document.title = 'Do A Valo | OogleMate';
    return () => { document.title = 'OogleMate'; };
  }, []);

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

  const handleRunValo = async () => {
    if (!description.trim()) {
      toast.error('Describe the vehicle first');
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
    setIsProcessing(true);

    try {
      // Step 1: Parse vehicle description
      const { data: parseData, error: parseError } = await supabase.functions.invoke('valo-parse', {
        body: { description: description.trim() }
      });

      if (parseError) throw new Error(parseError.message);
      if (parseData?.error) throw new Error(parseData.error);

      const parsedVehicle: ValoParsedVehicle = parseData.parsed;
      if (!parsedVehicle.assumptions) parsedVehicle.assumptions = [];
      parsedVehicle.km = kmNum;
      setParsed(parsedVehicle);

      if (!parsedVehicle.make || !parsedVehicle.model) {
        toast.error('Could not identify make/model. Please provide more detail.');
        setIsProcessing(false);
        return;
      }

      // Build instruction with accessories context
      let fullInstruction = description.trim();
      if (selectedAccessories.length > 0) {
        fullInstruction += ` accessories: ${selectedAccessories.join(', ')}`;
      }
      fullInstruction += ` ${kmNum}km condition:${condition} allow ${allowance}`;

      // Step 2: Run valuation engine
      const { data: valoData, error: valoError } = await supabase.functions.invoke('run-valo-v1', {
        body: {
          instruction: fullInstruction,
          km: kmNum,
          account_id: null,
          initiated_by: 'dealer',
          full_market_scan: true,
        }
      });

      if (valoError) throw new Error(valoError.message);
      if (valoData?.status === 'missing_required_fields') {
        toast.error(`Missing required fields: ${valoData.missing?.join(', ')}`);
        setIsProcessing(false);
        return;
      }
      if (valoData?.status === 'error') throw new Error(valoData.error);

      if (isAdmin) setOancaDebug(valoData);

      // Build top comps list
      const comps: any[] = [];
      if (valoData.anchor) comps.push({ ...valoData.anchor, _role: 'anchor' });
      if (valoData.backups) {
        valoData.backups.forEach((b: any) => comps.push({ ...b, _role: 'backup' }));
      }
      setValoComps(comps);

      // Map response
      const offer = valoData.trade_in_offer;
      const market = valoData.market;

      setResult({
        parsed: parsedVehicle,
        suggested_buy_range: offer ? { min: offer.low, max: offer.high } : null,
        suggested_sell_range: market ? { min: market.p25, max: market.p75 } : null,
        expected_gross_band: market && offer
          ? { min: market.p25 - offer.high, max: market.p75 - offer.low }
          : null,
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
    }
  };

  const confidenceBadge = (c: ValuationConfidence) => {
    if (c === 'LOW') return <Badge variant="destructive">LOW</Badge>;
    if (c === 'MEDIUM') return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">MEDIUM</Badge>;
    return <Badge className="bg-green-500 hover:bg-green-600">HIGH</Badge>;
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
                  showDebug
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-muted'
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

        {/* ── Section 1: Vehicle Input ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Vehicle Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="vehicle-desc">Description</Label>
                {isSupported && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={toggleVoice}
                    className={`gap-1.5 text-xs ${isListening ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    {isListening ? 'Stop' : 'Voice'}
                  </Button>
                )}
              </div>
              <Textarea
                id="vehicle-desc"
                placeholder="e.g. 2021 Toyota HiLux SR5 4x4 Auto, White, NSW"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={`mt-1 ${isListening ? 'ring-2 ring-destructive/50' : ''}`}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Include make, model, year, variant, and location if known.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="km">
                  Kilometres <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="km"
                  type="number"
                  value={km}
                  onChange={(e) => setKm(e.target.value)}
                  placeholder="e.g. 45000"
                  className="mt-1"
                  required
                />
              </div>
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
                  id="allowance"
                  type="number"
                  value={allowance}
                  onChange={(e) => setAllowance(e.target.value)}
                  placeholder="1000"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Accessory Chips */}
            <div>
              <Label>Accessories / Features</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {ACCESSORY_PRESETS.map(acc => (
                  <button
                    key={acc}
                    type="button"
                    onClick={() => toggleAccessory(acc)}
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
              {/* Custom accessory input */}
              <div className="flex gap-2 mt-2">
                <Input
                  value={customAccessory}
                  onChange={(e) => setCustomAccessory(e.target.value)}
                  placeholder="Add custom accessory…"
                  className="h-8 text-xs"
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomAccessory())}
                />
                <Button type="button" variant="outline" size="sm" onClick={addCustomAccessory} className="h-8 text-xs">
                  Add
                </Button>
              </div>
              {/* Show custom selections */}
              {selectedAccessories.filter(a => !ACCESSORY_PRESETS.includes(a)).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {selectedAccessories.filter(a => !ACCESSORY_PRESETS.includes(a)).map(acc => (
                    <Badge key={acc} variant="secondary" className="gap-1 text-xs">
                      {acc}
                      <button onClick={() => toggleAccessory(acc)} className="ml-0.5 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <Button
              onClick={handleRunValo}
              disabled={isProcessing || !description.trim() || !km.trim()}
              className="w-full gap-2"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running Valuation…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Run VALO
                </>
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
                    <Badge key={field} variant="outline" className="text-xs text-muted-foreground">
                      {field} unknown
                    </Badge>
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
            {/* Confidence + Tier Badges */}
            <div className="flex flex-wrap items-center gap-2">
              {confidenceBadge(result.confidence)}
              {tierBadge(result.tier)}
              <Badge variant="secondary">n = {result.sample_size}</Badge>
            </div>

            {/* Market Range Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <DollarSign className="h-4 w-4" />
                  Buy Range
                </div>
                <div className="text-lg font-semibold">
                  {result.suggested_buy_range
                    ? `${formatCurrency(result.suggested_buy_range.min)} – ${formatCurrency(result.suggested_buy_range.max)}`
                    : 'N/A'}
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4" />
                  Sell Range
                </div>
                <div className="text-lg font-semibold">
                  {result.suggested_sell_range
                    ? `${formatCurrency(result.suggested_sell_range.min)} – ${formatCurrency(result.suggested_sell_range.max)}`
                    : 'N/A'}
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <BarChart3 className="h-4 w-4" />
                  Gross Band
                </div>
                <div className={`text-lg font-semibold ${
                  result.expected_gross_band && result.expected_gross_band.min > 0 ? 'text-green-600' : ''
                }`}>
                  {result.expected_gross_band
                    ? `${formatCurrency(result.expected_gross_band.min)} – ${formatCurrency(result.expected_gross_band.max)}`
                    : 'N/A'}
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Clock className="h-4 w-4" />
                  Days to Sell
                </div>
                <div className="text-lg font-semibold">
                  {result.typical_days_to_sell
                    ? `~${Math.round(result.typical_days_to_sell)} days`
                    : 'N/A'}
                </div>
              </Card>
            </div>

            {/* ── Top Comparables ── */}
            {valoComps.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  Top Comparables
                </h3>
                {valoComps.map((comp, i) => {
                  const isAnchor = comp._role === 'anchor';
                  const isExpanded = expandedComp === i;
                  return (
                    <Card
                      key={i}
                      className={`overflow-hidden ${isAnchor ? 'border-primary/50 ring-1 ring-primary/20' : ''}`}
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {isAnchor && (
                                <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0">
                                  ANCHOR
                                </Badge>
                              )}
                              {!isAnchor && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  BACKUP
                                </Badge>
                              )}
                              {comp.source && (
                                <span className="text-[10px] text-muted-foreground font-mono uppercase">
                                  {comp.source === 'internal_db' ? 'Internal' : comp.source}
                                </span>
                              )}
                            </div>
                            <p className="font-medium text-sm truncate">
                              {comp.title || `${comp.year ?? ''} ${comp.make ?? ''} ${comp.model ?? ''} ${comp.variant ?? ''}`.trim()}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                              {comp.year && <span>{comp.year}</span>}
                              {comp.km != null && <span>{comp.km.toLocaleString()} km</span>}
                              {(comp.price ?? comp.effective_cost) != null && (
                                <span className="font-semibold text-foreground">
                                  ${(comp.price ?? comp.effective_cost).toLocaleString()}
                                </span>
                              )}
                              {comp.state && <span>{comp.state}</span>}
                            </div>

                            {/* Feature hits */}
                            {comp.feature_hits?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {comp.feature_hits.map((hit: string) => (
                                  <Badge key={hit} variant="secondary" className="text-[10px] gap-1">
                                    <CheckCircle className="h-2.5 w-2.5 text-green-500" />
                                    {hit}
                                  </Badge>
                                ))}
                              </div>
                            )}

                            {/* VALO score + reasons */}
                            {comp.valo_score != null && (
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  Score: {comp.valo_score}
                                </span>
                                {comp.valo_reasons?.slice(0, 3).map((r: string) => (
                                  <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">
                                    {r}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col gap-1 shrink-0">
                            {comp.url && (
                              <a
                                href={comp.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                              >
                                View listing
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            <button
                              onClick={() => setExpandedComp(isExpanded ? null : i)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted transition-colors"
                            >
                              {isExpanded ? 'Less' : 'Details'}
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          </div>
                        </div>

                        {/* Expanded details */}
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-border space-y-2">
                            {comp.feature_evidence?.length > 0 && (
                              <div>
                                <p className="text-xs font-medium mb-1">Feature Evidence</p>
                                {comp.feature_evidence.map((fe: any, j: number) => (
                                  <div key={j} className="text-xs text-muted-foreground flex gap-2 py-0.5">
                                    <Badge variant="outline" className="text-[10px] shrink-0">{fe.code}</Badge>
                                    <span className="italic">…{fe.snippet}…</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {comp.valo_reasons?.length > 0 && (
                              <div>
                                <p className="text-xs font-medium mb-1">All Match Reasons</p>
                                <div className="flex flex-wrap gap-1">
                                  {comp.valo_reasons.map((r: string) => (
                                    <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {comp.description && (
                              <div>
                                <p className="text-xs font-medium mb-1">Listing Description</p>
                                <p className="text-xs text-muted-foreground line-clamp-4">{comp.description}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Confidence Explanation */}
            {result.confidence === 'LOW' && (
              <div className="flex items-start gap-3 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
                <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">Low confidence — limited comparables</p>
                  <p className="text-muted-foreground mt-1">
                    This valuation is based on {result.sample_size} comparable{result.sample_size !== 1 ? 's' : ''}. 
                    Consider uploading photos for a condition-adjusted assessment.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {/* No data state */}
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

        {/* ── Section 4: MODO — Condition & Photo Assessment ── */}
        {result && result.sample_size > 0 && !isProcessing && (
          <Card className="border-dashed">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="h-4 w-4 text-primary" />
                Refine with Photos (MODO)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Upload 4–5 photos of the vehicle. MODO will assess condition and adjust 
                the recon buffer for a tighter offer range.
              </p>
              <Button variant="outline" disabled className="gap-2">
                <Camera className="h-4 w-4" />
                Upload Photos
                <Badge variant="secondary" className="ml-1 text-xs">Coming Soon</Badge>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── Debug Panel (Admin Only) ── */}
        {isAdmin && showDebug && oancaDebug && (
          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                🔧 VALO Debug
                <Badge variant="outline" className="text-xs">
                  {oancaDebug.status}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {oancaDebug.confidence}
                </Badge>
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