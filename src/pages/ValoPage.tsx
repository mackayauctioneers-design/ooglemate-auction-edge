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
  Sparkles, Target, ShieldCheck, Camera, AlertTriangle, Mic, MicOff
} from 'lucide-react';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { useAuth } from '@/contexts/AuthContext';
import { ValoParsedVehicle, ValoResult, ValoTier, ValuationConfidence, formatCurrency } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { dataService } from '@/services/dataService';
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

// ============================================================================
// VALO — Market-Backed Trade-In Valuation Tool
// ============================================================================

export default function ValoPage() {
  const { currentUser, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();

  // Input state
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState<string>('good');
  const [allowance, setAllowance] = useState<string>('1000');

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
  const [oancaDebug, setOancaDebug] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);

  // Prefill from URL
  useEffect(() => {
    const prefillText = searchParams.get('prefill');
    if (prefillText) {
      setDescription(decodeURIComponent(prefillText));
    }
  }, [searchParams]);

  useEffect(() => {
    document.title = 'Do A Valo | OogleMate';
    return () => { document.title = 'OogleMate'; };
  }, []);

  const handleRunValo = async () => {
    if (!description.trim()) {
      toast.error('Describe the vehicle first');
      return;
    }

    setParsed(null);
    setResult(null);
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
      setParsed(parsedVehicle);

      if (!parsedVehicle.make || !parsedVehicle.model) {
        toast.error('Could not identify make/model. Please provide more detail.');
        setIsProcessing(false);
        return;
      }

      // Step 2: Run valuation engine
      const { data: valoData, error: valoError } = await supabase.functions.invoke('run-valo-v1', {
        body: {
          transcript: description.trim(),
          dealerName: currentUser?.dealer_name,
          includeDebug: isAdmin,
        }
      });

      if (valoError) throw new Error(valoError.message);
      if (valoData?.error) throw new Error(valoData.error);

      if (isAdmin && valoData.oanca_debug) {
        setOancaDebug(valoData.oanca_debug);
      }

      // Build result from OANCA data or fallback
      if (valoData.oanca_debug) {
        const oanca = valoData.oanca_debug;
        setResult({
          parsed: parsedVehicle,
          suggested_buy_range: oanca.allow_price
            ? { min: oanca.buy_low!, max: oanca.buy_high! }
            : null,
          suggested_sell_range: oanca.retail_context_low && oanca.retail_context_high
            ? { min: oanca.retail_context_low, max: oanca.retail_context_high }
            : null,
          expected_gross_band: null,
          typical_days_to_sell: null,
          confidence: oanca.confidence === 'HIGH' ? 'HIGH' : oanca.confidence === 'MED' ? 'MEDIUM' : 'LOW',
          tier: 'dealer',
          tier_label: `OANCA (${oanca.verdict})`,
          sample_size: oanca.n_comps,
          top_comps: [],
          request_id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        });
      } else {
        const valuation = await runLocalValuation(parsedVehicle, currentUser?.dealer_name);
        setResult({
          parsed: parsedVehicle,
          ...valuation,
          request_id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        });
      }

      toast.success('Valuation complete');
    } catch (err) {
      console.error('VALO error:', err);
      toast.error(err instanceof Error ? err.message : 'Valuation failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const runLocalValuation = async (
    parsed: ValoParsedVehicle,
    dealerName?: string
  ): Promise<Omit<ValoResult, 'parsed' | 'request_id' | 'timestamp'>> => {
    const make = parsed.make!;
    const model = parsed.model!;
    const year = parsed.year || new Date().getFullYear();
    const variantFamily = parsed.variant_family || undefined;
    const km = parsed.km || undefined;

    if (dealerName) {
      const dealerResult = await dataService.getNetworkValuation({
        make, model, variant_family: variantFamily, year, km, requesting_dealer: dealerName,
      }, isAdmin);

      if (dealerResult.data_source === 'internal' && dealerResult.sample_size >= 1) {
        const confidence: ValuationConfidence = dealerResult.sample_size >= 3 ? 'HIGH' : 'MEDIUM';
        return {
          suggested_buy_range: dealerResult.buy_price_range,
          suggested_sell_range: dealerResult.sell_price_range,
          expected_gross_band: dealerResult.avg_gross_profit
            ? { min: dealerResult.avg_gross_profit * 0.8, max: dealerResult.avg_gross_profit * 1.2 }
            : null,
          typical_days_to_sell: dealerResult.avg_days_to_sell,
          confidence,
          tier: 'dealer',
          tier_label: 'Dealer history',
          sample_size: dealerResult.sample_size,
          top_comps: [],
        };
      }
    }

    const networkResult = await dataService.getNetworkValuation({
      make, model, variant_family: variantFamily, year, year_tolerance: 2,
    }, isAdmin);

    if (networkResult.sample_size >= 5) {
      return {
        suggested_buy_range: networkResult.buy_price_range,
        suggested_sell_range: networkResult.sell_price_range,
        expected_gross_band: networkResult.avg_gross_profit
          ? { min: networkResult.avg_gross_profit * 0.8, max: networkResult.avg_gross_profit * 1.2 }
          : null,
        typical_days_to_sell: networkResult.avg_days_to_sell,
        confidence: 'MEDIUM',
        tier: 'network',
        tier_label: 'Network outcomes',
        sample_size: networkResult.sample_size,
        top_comps: [],
      };
    }

    const proxyResult = await dataService.getNetworkValuation({
      make, model, year, year_tolerance: 3,
    }, isAdmin);

    if (proxyResult.sample_size > 0) {
      return {
        suggested_buy_range: proxyResult.buy_price_range,
        suggested_sell_range: proxyResult.sell_price_range,
        expected_gross_band: proxyResult.avg_gross_profit
          ? { min: proxyResult.avg_gross_profit * 0.7, max: proxyResult.avg_gross_profit * 1.3 }
          : null,
        typical_days_to_sell: proxyResult.avg_days_to_sell,
        confidence: 'LOW',
        tier: 'proxy',
        tier_label: 'Proxy',
        sample_size: proxyResult.sample_size,
        top_comps: [],
      };
    }

    return {
      suggested_buy_range: null,
      suggested_sell_range: null,
      expected_gross_band: null,
      typical_days_to_sell: null,
      confidence: 'LOW',
      tier: 'proxy',
      tier_label: 'No comparable data',
      sample_size: 0,
      top_comps: [],
    };
  };

  const confidenceBadge = (c: ValuationConfidence) => {
    const map = {
      HIGH: 'bg-green-500 hover:bg-green-600',
      MEDIUM: 'bg-yellow-500 hover:bg-yellow-600 text-black',
      LOW: '',
    };
    if (c === 'LOW') return <Badge variant="destructive">LOW</Badge>;
    return <Badge className={map[c]}>{c}</Badge>;
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
                placeholder="e.g. 2021 Toyota HiLux SR5 4x4 Auto, 45,000km, White, NSW"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={`mt-1 ${isListening ? 'ring-2 ring-destructive/50' : ''}`}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Include make, model, year, variant, kilometres, and location if known.
              </p>
            </div>

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
                  id="allowance"
                  type="number"
                  value={allowance}
                  onChange={(e) => setAllowance(e.target.value)}
                  placeholder="1000"
                  className="mt-1"
                />
              </div>
            </div>

            <Button
              onClick={handleRunValo}
              disabled={isProcessing || !description.trim()}
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
                🔧 OANCA Debug
                <Badge variant="outline" className="text-xs">
                  {oancaDebug.allow_price ? 'PRICED' : 'NO PRICE'}
                </Badge>
                <Badge
                  variant={oancaDebug.verdict === 'BUY' ? 'default' : oancaDebug.verdict === 'HIT_IT' ? 'destructive' : 'secondary'}
                  className="text-xs"
                >
                  {oancaDebug.verdict}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">allow_price:</span> <span className={oancaDebug.allow_price ? 'text-green-500' : 'text-red-500'}>{String(oancaDebug.allow_price)}</span></div>
                <div><span className="text-muted-foreground">verdict:</span> <span className="font-semibold">{oancaDebug.verdict}</span></div>
                <div><span className="text-muted-foreground">demand_class:</span> {oancaDebug.demand_class || 'N/A'}</div>
                <div><span className="text-muted-foreground">confidence:</span> {oancaDebug.confidence || 'N/A'}</div>
                <div><span className="text-muted-foreground">n_comps:</span> <span className={oancaDebug.n_comps < 2 ? 'text-red-500' : 'text-green-500'}>{oancaDebug.n_comps}</span></div>
                <div><span className="text-muted-foreground">anchor_owe:</span> {oancaDebug.anchor_owe ? `$${oancaDebug.anchor_owe.toLocaleString()}` : 'N/A'}</div>
              </div>
              {oancaDebug.allow_price && (
                <div className="pt-2 border-t border-yellow-500/20">
                  <p className="text-muted-foreground mb-1">Approved Range:</p>
                  <div className="flex gap-4">
                    <span>Low: <strong className="text-green-500">${oancaDebug.buy_low?.toLocaleString()}</strong></span>
                    <span>High: <strong className="text-green-500">${oancaDebug.buy_high?.toLocaleString()}</strong></span>
                  </div>
                </div>
              )}
              {oancaDebug.notes?.length > 0 && (
                <div className="pt-2 border-t border-yellow-500/20">
                  <p className="text-muted-foreground mb-1">Notes:</p>
                  <ul className="list-disc list-inside opacity-80 max-h-32 overflow-y-auto">
                    {oancaDebug.notes.map((note: string, i: number) => <li key={i}>{note}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DealerLayout>
  );
}
