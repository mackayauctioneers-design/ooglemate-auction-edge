import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Loader2, Info, CheckCircle, DollarSign, TrendingUp, BarChart3, Clock, Volume2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ValoParsedVehicle, ValoResult, ValoTier, ValuationConfidence, formatCurrency } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { dataService } from '@/services/dataService';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MeetBobModal } from '@/components/valo/MeetBobModal';
import { BobResponseLogger, determineBobResponseType } from '@/components/valo/BobResponseLogger';
import { BobAvatar } from '@/components/valo/BobAvatar';
import { useBobTTS } from '@/hooks/useBobTTS';

// Build time constant injected by Vite
declare const __BUILD_TIME__: string;

// ============================================================================
// SYSTEM: BOB (VALO ENGINE)
// ============================================================================
// Bob is the ONLY entry point - floating avatar bottom-right
// - Tap Bob → auto voice recording
// - Recording stops after 1.5s silence
// - Editable transcript → auto-process
// - Response bubble with optional voice
// - Camera opens directly when Bob needs photos
// ============================================================================

interface BobSignals {
  avgGross: number | null;
  avgDaysToSell: number | null;
  isRepeatLoser: boolean;
  isSlow: boolean;
  isHardWork: boolean;
  isBounceOnly: boolean;
  priceband: 'low' | 'mid' | 'high';
}

function calculateBobSignals(result: ValoResult): BobSignals {
  const avgGross = result.expected_gross_band 
    ? (result.expected_gross_band.min + result.expected_gross_band.max) / 2 
    : null;
  const avgDaysToSell = result.typical_days_to_sell;
  const avgBuy = result.suggested_buy_range 
    ? (result.suggested_buy_range.min + result.suggested_buy_range.max) / 2 
    : 0;

  const isBounceOnly = avgGross !== null && avgDaysToSell !== null &&
    avgGross < 2000 && avgDaysToSell > 30;

  return {
    avgGross,
    avgDaysToSell,
    isRepeatLoser: avgGross !== null && avgGross <= 0,
    isSlow: avgDaysToSell !== null && avgDaysToSell > 45,
    isHardWork: avgGross !== null && avgGross > 0 && avgGross < 1500,
    isBounceOnly,
    priceband: avgBuy < 25000 ? 'low' : avgBuy < 50000 ? 'mid' : 'high',
  };
}

// Character lines - ONLY for #1, #2, #3 responses
const bobCharacterLines = [
  "That's the sort of thing I'd still be thinking about after a couple schooners.",
  "Shaz would tell me not to overthink it.",
  "I've watched plenty of these after the footy…",
];

function getOptionalCharacter(): string {
  if (Math.random() > 0.75) {
    return " " + bobCharacterLines[Math.floor(Math.random() * bobCharacterLines.length)];
  }
  return "";
}

// ============================================================================
// BOB RESPONSES
// ============================================================================

const BOB_HANDOFF = "Give me two minutes, let me check with one of the boys.";

// Bob asks clarifying questions naturally when info is missing
function bobClarifyingQuestion(parsed: ValoParsedVehicle): string | null {
  const missing = parsed.missing_fields || [];
  
  // Critical missing: need at minimum make/model
  if (!parsed.make || !parsed.model) {
    return "What are we looking at mate? Give me the make and model.";
  }
  
  // Important missing: km affects value significantly
  if (missing.includes('km') && !parsed.km) {
    const desc = [parsed.year, parsed.make, parsed.model].filter(Boolean).join(' ');
    return `${desc} – got it. What's on the clock?`;
  }
  
  // Year helps narrow it down
  if (!parsed.year) {
    const desc = [parsed.make, parsed.model].filter(Boolean).join(' ');
    return `${desc}. What year are we talking?`;
  }
  
  return null; // No clarification needed
}

function bobResponse1(vehicleDesc: string, buyLow: string, buyHigh: string, sellLow: string, sellHigh: string, days: number, n: number): string {
  const character = getOptionalCharacter();
  return `Yeah mate, that's a good fighter. I'd want to be ${buyLow} to ${buyHigh} to buy it. Turns in about ${Math.round(days)} days – demand's there. Retail ask ${sellLow} to ${sellHigh}. Got ${n} comps backing this up.${character}`;
}

function bobResponse2(vehicleDesc: string, buyLow: string, buyHigh: string, sellLow: string, sellHigh: string, days: number | null, n: number): string {
  const daysText = days ? `Turns in about ${Math.round(days)} days across the network.` : 'Velocity looks reasonable.';
  const character = getOptionalCharacter();
  return `Sits straight and square. I'd want to be ${buyLow} to ${buyHigh} to buy it. ${daysText} Retail ask ${sellLow} to ${sellHigh}. Not your direct history – ${n} network comps – so I'd want eyes on it.${character}`;
}

function bobResponse3(vehicleDesc: string, buyLow: string, buyHigh: string): string {
  const character = getOptionalCharacter();
  return `Look mate, I'm working off limited data here. I'd want to be ${buyLow} to ${buyHigh} to buy it – rough guide only. ${BOB_HANDOFF} Send a few pics and I'll firm it up.${character}`;
}

function bobResponse4NoData(vehicleDesc: string): string {
  return `That's nowhere – I haven't got enough runs on the board with ${vehicleDesc || 'this one'}. ${BOB_HANDOFF} Send a few pics and I'll firm it up.`;
}

function bobResponse5(vehicleDesc: string, buyLow: string, buyHigh: string, avgGross: number, days: number | null): string {
  const daysText = days ? ` in ${Math.round(days)} days` : '';
  return `That's hard work. I'd want to be ${buyLow} to ${buyHigh} to buy it. Margin's typically ${formatCurrency(avgGross)}${daysText} – any sillier and the money disappears. I don't bounce 'em, so hit it hard or walk.`;
}

function bobResponse6HardNo(vehicleDesc: string, avgGross: number, days: number | null, n: number): string {
  const daysText = days ? ` and sat for ${Math.round(days)} days` : '';
  return `I'd rather keep my powder dry on this one. Your history shows ${formatCurrency(avgGross)} average gross${daysText} – that's ${n} runs where money disappeared. I price it to buy it, and I can't buy this one comfortably. Walk unless the seller's properly motivated.`;
}

function bobResponse7Slow(vehicleDesc: string, buyLow: string, buyHigh: string, days: number, avgGross: number | null): string {
  const grossText = avgGross ? `Gross is typically ${formatCurrency(avgGross)}, but` : `But`;
  return `These are slow. I'd want to be ${buyLow} to ${buyHigh} to buy it. ${grossText} you're looking at ${Math.round(days)} days to move them. Factor in floorplan and the aggravation – money's tied up. Hit it pretty hard.`;
}

function bobResponse8BounceOnly(vehicleDesc: string, avgGross: number, days: number): string {
  return `I'm not putting a number on this one. ${formatCurrency(avgGross)} gross over ${Math.round(days)} days – that's bounce territory. I don't bounce 'em. The only way to make money is timing and heat. This one's a pass unless you know something I don't.`;
}

function generateValoResponse(result: ValoResult, parsed: ValoParsedVehicle): string {
  const { confidence, sample_size, suggested_buy_range, suggested_sell_range, tier } = result;
  
  const vehicleDesc = [parsed.year, parsed.make, parsed.model, parsed.variant_family]
    .filter(Boolean).join(' ');

  if (sample_size === 0 || !suggested_buy_range) {
    return bobResponse4NoData(vehicleDesc);
  }

  const buyLow = formatCurrency(suggested_buy_range.min);
  const buyHigh = formatCurrency(suggested_buy_range.max);
  const sellLow = suggested_sell_range ? formatCurrency(suggested_sell_range.min) : null;
  const sellHigh = suggested_sell_range ? formatCurrency(suggested_sell_range.max) : null;

  const signals = calculateBobSignals(result);
  const lines: string[] = [];

  if (signals.isRepeatLoser && signals.avgGross !== null) {
    lines.push(bobResponse6HardNo(vehicleDesc, signals.avgGross, result.typical_days_to_sell || null, sample_size));
  } else if (signals.isBounceOnly && signals.avgGross !== null && result.typical_days_to_sell) {
    lines.push(bobResponse8BounceOnly(vehicleDesc, signals.avgGross, result.typical_days_to_sell));
  } else if (signals.isSlow && result.typical_days_to_sell) {
    lines.push(bobResponse7Slow(vehicleDesc, buyLow, buyHigh, result.typical_days_to_sell, signals.avgGross));
  } else if (signals.isHardWork && signals.avgGross !== null) {
    lines.push(bobResponse5(vehicleDesc, buyLow, buyHigh, signals.avgGross, result.typical_days_to_sell || null));
  } else if (confidence === 'HIGH' && tier === 'dealer' && sellLow && sellHigh && result.typical_days_to_sell) {
    lines.push(bobResponse1(vehicleDesc, buyLow, buyHigh, sellLow, sellHigh, result.typical_days_to_sell, sample_size));
  } else if (confidence === 'MEDIUM' && tier === 'network' && sellLow && sellHigh) {
    lines.push(bobResponse2(vehicleDesc, buyLow, buyHigh, sellLow, sellHigh, result.typical_days_to_sell || null, sample_size));
  } else if (confidence === 'LOW') {
    lines.push(bobResponse3(vehicleDesc, buyLow, buyHigh));
  } else {
    const sourceText = tier === 'dealer' 
      ? 'Based on what you\'ve paid and got before'
      : tier === 'network' 
        ? 'Based on network outcomes'
        : 'Based on limited data – advisory only';
    
    lines.push(`${sourceText}, I'd want to be ${buyLow} to ${buyHigh} to buy it.`);
    
    if (sellLow && sellHigh) {
      lines.push(`Retail ask ${sellLow} to ${sellHigh}.`);
    }
    
    if (result.typical_days_to_sell) {
      lines.push(`Typically turning in ${Math.round(result.typical_days_to_sell)} days.`);
    }
    
    lines.push(`Got ${sample_size} comps to go on.`);
  }

  if (signals.priceband === 'high' && !signals.isRepeatLoser) {
    lines.push(`At this price point, every grand matters – don't get silly.`);
  }

  const conditionUncertain = !parsed.km || parsed.missing_fields.includes('km');
  if (conditionUncertain) {
    lines.push(`Can't see the kays on this one – that'll shift things either way.`);
  }

  if (parsed.assumptions && parsed.assumptions.length > 0) {
    lines.push(`By the way, I'm assuming: ${parsed.assumptions.join('; ')}.`);
  }

  return lines.join(' ');
}

export default function ValoPage() {
  const { currentUser, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsed, setParsed] = useState<ValoParsedVehicle | null>(null);
  const [result, setResult] = useState<ValoResult | null>(null);
  const [bobResponse, setBobResponse] = useState<string | null>(null);
  const [showOancaDebug, setShowOancaDebug] = useState(false);
  const [oancaDebug, setOancaDebug] = useState<any>(null);
  
  // TTS for Bob's voice
  const { speak, isSpeaking, isLoading: ttsLoading } = useBobTTS();
  const pendingTTSRef = useRef<string | null>(null);

  // Prefill from URL (when clicking VALO button on a lot)
  useEffect(() => {
    const prefillText = searchParams.get('prefill');
    if (prefillText) {
      handleProcess(decodeURIComponent(prefillText));
    }
  }, [searchParams]);

  useEffect(() => {
    document.title = 'Ask Bob | OogleMate';
    return () => { document.title = 'OogleMate'; };
  }, []);

  // Auto-speak Bob's response when it changes
  // TTS is triggered after response is set, within the async flow from user action
  useEffect(() => {
    if (bobResponse && pendingTTSRef.current !== bobResponse) {
      pendingTTSRef.current = bobResponse;
      speak(bobResponse);
    }
  }, [bobResponse, speak]);

  const handleProcess = async (inputText: string) => {
    if (!inputText.trim()) {
      setBobResponse("Sorry mate, didn't catch that. What are we looking at?");
      return;
    }

    setParsed(null);
    setResult(null);
    setBobResponse(null);
    setOancaDebug(null);
    setIsProcessing(true);

    try {
      // Step 1: Parse the description with AI
      const { data: parseData, error: parseError } = await supabase.functions.invoke('valo-parse', {
        body: { description: inputText }
      });

      if (parseError) throw new Error(parseError.message);
      if (parseData?.error) throw new Error(parseData.error);

      const parsedVehicle: ValoParsedVehicle = parseData.parsed;
      if (!parsedVehicle.assumptions) {
        parsedVehicle.assumptions = [];
      }
      setParsed(parsedVehicle);

      // Check if Bob needs to ask clarifying questions
      const clarifyingQ = bobClarifyingQuestion(parsedVehicle);
      if (clarifyingQ) {
        setBobResponse(clarifyingQ);
        setIsProcessing(false);
        return;
      }

      // Step 2: Call Bob edge function with OANCA Engine
      // Bob is now a NARRATOR only - OANCA is the VALUER
      const { data: bobData, error: bobError } = await supabase.functions.invoke('bob', {
        body: { 
          transcript: inputText,
          dealerName: currentUser?.dealer_name,
          includeDebug: isAdmin  // Admin gets OANCA debug object
        }
      });

      if (bobError) throw new Error(bobError.message);
      if (bobData?.error) throw new Error(bobData.error);

      // Set Bob's response (narrated from OANCA)
      setBobResponse(bobData.response);

      // If admin, store OANCA debug object
      if (isAdmin && bobData.oanca_debug) {
        setOancaDebug(bobData.oanca_debug);
        console.log('[OANCA DEBUG]', bobData.oanca_debug);
      }

      // Build result for display from OANCA data if available
      if (bobData.oanca_debug) {
        const oanca = bobData.oanca_debug;
        const fullResult: ValoResult = {
          parsed: parsedVehicle,
          suggested_buy_range: oanca.allow_price 
            ? { min: oanca.buy_low!, max: oanca.buy_high! }
            : null,
          suggested_sell_range: oanca.retail_context_low && oanca.retail_context_high
            ? { min: oanca.retail_context_low, max: oanca.retail_context_high }
            : null,
          expected_gross_band: null,  // OANCA doesn't output this directly
          typical_days_to_sell: null, // OANCA uses demand_class instead
          confidence: oanca.confidence === 'HIGH' ? 'HIGH' : oanca.confidence === 'MED' ? 'MEDIUM' : 'LOW',
          tier: 'dealer',  // OANCA always uses dealer sales history
          tier_label: `OANCA (${oanca.verdict})`,
          sample_size: oanca.n_comps,
          top_comps: [],
          request_id: crypto.randomUUID(),
          timestamp: new Date().toISOString()
        };
        setResult(fullResult);
      } else {
        // Fallback: run local valuation for display
        const valuation = await runValoValuation(parsedVehicle, currentUser?.dealer_name);
        const fullResult: ValoResult = {
          parsed: parsedVehicle,
          ...valuation,
          request_id: crypto.randomUUID(),
          timestamp: new Date().toISOString()
        };
        setResult(fullResult);
      }

      toast.success('Bob\'s got an answer');
    } catch (err) {
      console.error('VALO error:', err);
      const msg = err instanceof Error ? err.message : 'Failed to run VALO';
      toast.error(msg);
    } finally {
      setIsProcessing(false);
    }
  };
  const runValoValuation = async (
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
          top_comps: []
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
        top_comps: []
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
        top_comps: []
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
      top_comps: []
    };
  };

  const getConfidenceBadge = (confidence: ValuationConfidence) => {
    switch (confidence) {
      case 'HIGH':
        return <Badge className="bg-green-500 hover:bg-green-600">HIGH</Badge>;
      case 'MEDIUM':
        return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">MEDIUM</Badge>;
      case 'LOW':
        return <Badge variant="destructive">LOW</Badge>;
    }
  };

  const getTierBadge = (tier: ValoTier) => {
    switch (tier) {
      case 'dealer':
        return <Badge variant="outline" className="border-green-500 text-green-700">Dealer History</Badge>;
      case 'network':
        return <Badge variant="outline" className="border-blue-500 text-blue-700">Network</Badge>;
      case 'proxy':
        return <Badge variant="outline" className="border-muted-foreground">Proxy</Badge>;
    }
  };

  const vehicleDesc = parsed ? [parsed.year, parsed.make, parsed.model, parsed.variant_family]
    .filter(Boolean).join(' ') : '';

  // Determine if Bob needs photos (confidence not HIGH)
  const needsPhotos = result ? result.confidence !== 'HIGH' : false;

  return (
    <AppLayout>
      <MeetBobModal />
      
      <BobResponseLogger 
        result={result} 
        vehicleDesc={vehicleDesc} 
        isAdmin={isAdmin} 
      />
      
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto min-h-[70vh]">
        {/* Minimal header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-4xl">👨‍🔧</div>
            <div>
              <h1 className="text-2xl font-bold">Bob</h1>
              {/* Build version stamp - visible for debugging */}
              <p className="text-xs text-muted-foreground font-mono">
                {import.meta.env.MODE} | Build: {__BUILD_TIME__}
              </p>
            </div>
          </div>
          
        {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowOancaDebug(!showOancaDebug)}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  showOancaDebug 
                    ? 'bg-primary text-primary-foreground border-primary' 
                    : 'border-border hover:bg-muted'
                }`}
              >
                🔧 OANCA Debug
              </button>
              <Badge variant="outline" className="gap-1 text-xs">
                <Info className="h-3 w-3" />
                Testing
              </Badge>
            </div>
          )}
        </div>

        {/* Empty state - minimal, no instructions */}
        {!result && !isProcessing && !bobResponse && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="text-7xl opacity-30">👨‍🔧</div>
          </div>
        )}

        {/* Processing state */}
        {isProcessing && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg text-muted-foreground">Bob's thinking...</p>
          </div>
        )}

        {/* Parsed Details */}
        {parsed && !isProcessing && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                What Frank's working with
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Year</p>
                  <p className="font-medium">{parsed.year || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Make</p>
                  <p className="font-medium">{parsed.make || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Model</p>
                  <p className="font-medium">{parsed.model || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Variant</p>
                  <p className="font-medium">{parsed.variant_family || parsed.variant_raw || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Body</p>
                  <p className="font-medium">{parsed.body_style || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Engine</p>
                  <p className="font-medium">{parsed.engine || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Transmission</p>
                  <p className="font-medium">{parsed.transmission || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">KM</p>
                  <p className="font-medium">{parsed.km ? parsed.km.toLocaleString() : '-'}</p>
                </div>
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
            </CardContent>
          </Card>
        )}

        {/* Valuation Numbers Grid */}
        {result && result.sample_size > 0 && !isProcessing && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {getConfidenceBadge(result.confidence)}
              {getTierBadge(result.tier)}
              <Badge variant="secondary">n = {result.sample_size}</Badge>
              {isAdmin && (
                <Badge variant="outline" className="font-mono text-xs">
                  {determineBobResponseType(result)}
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <DollarSign className="h-4 w-4" />
                  Buy Range
                </div>
                <div className="text-lg font-semibold">
                  {result.suggested_buy_range 
                    ? `${formatCurrency(result.suggested_buy_range.min)} - ${formatCurrency(result.suggested_buy_range.max)}`
                    : 'N/A'
                  }
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4" />
                  Sell Range
                </div>
                <div className="text-lg font-semibold">
                  {result.suggested_sell_range 
                    ? `${formatCurrency(result.suggested_sell_range.min)} - ${formatCurrency(result.suggested_sell_range.max)}`
                    : 'N/A'
                  }
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <BarChart3 className="h-4 w-4" />
                  Gross Band
                </div>
                <div className={`text-lg font-semibold ${
                  result.expected_gross_band && result.expected_gross_band.min > 0 
                    ? 'text-green-600' 
                    : ''
                }`}>
                  {result.expected_gross_band 
                    ? `${formatCurrency(result.expected_gross_band.min)} - ${formatCurrency(result.expected_gross_band.max)}`
                    : 'N/A'
                  }
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
                    : 'N/A'
                  }
                </div>
              </Card>
            </div>
          </>
        )}

        {/* OANCA Debug Panel (Admin Only) */}
        {isAdmin && showOancaDebug && oancaDebug && (
          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                🔧 OANCA_PRICE_OBJECT v2
                <Badge variant="outline" className="text-xs">
                  {oancaDebug.allow_price ? 'PRICED' : 'NO PRICE'}
                </Badge>
                <Badge 
                  variant={oancaDebug.verdict === 'BUY' ? 'default' : oancaDebug.verdict === 'HIT_IT' ? 'destructive' : 'secondary'}
                  className="text-xs"
                >
                  {oancaDebug.verdict}
                </Badge>
                {oancaDebug.firewall_triggered && (
                  <Badge variant="destructive" className="text-xs">
                    🚨 FIREWALL
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">allow_price:</span>{' '}
                  <span className={oancaDebug.allow_price ? 'text-green-500' : 'text-red-500'}>
                    {String(oancaDebug.allow_price)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">verdict:</span>{' '}
                  <span className="font-semibold">{oancaDebug.verdict}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">demand_class:</span>{' '}
                  <span className={oancaDebug.demand_class === 'hard_work' ? 'text-orange-500' : oancaDebug.demand_class === 'poison' ? 'text-red-500' : ''}>
                    {oancaDebug.demand_class || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">confidence:</span>{' '}
                  {oancaDebug.confidence || 'N/A'}
                </div>
                <div>
                  <span className="text-muted-foreground">n_comps:</span>{' '}
                  <span className={oancaDebug.n_comps < 2 ? 'text-red-500' : 'text-green-500'}>
                    {oancaDebug.n_comps}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">anchor_owe:</span>{' '}
                  {oancaDebug.anchor_owe ? `$${oancaDebug.anchor_owe.toLocaleString()}` : 'N/A'}
                </div>
                <div>
                  <span className="text-muted-foreground">cap_applied:</span>{' '}
                  <span className={oancaDebug.cap_applied ? 'text-orange-500' : ''}>
                    {String(oancaDebug.cap_applied || false)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">floor_applied:</span>{' '}
                  <span className={oancaDebug.floor_applied ? 'text-orange-500' : ''}>
                    {String(oancaDebug.floor_applied || false)}
                  </span>
                </div>
              </div>
              
              {oancaDebug.allow_price && (
                <div className="pt-2 border-t border-yellow-500/20">
                  <p className="text-muted-foreground mb-1">Approved Numbers (ONLY these may be quoted):</p>
                  <div className="flex gap-4">
                    <span>buy_low: <strong className="text-green-500">${oancaDebug.buy_low?.toLocaleString()}</strong></span>
                    <span>buy_high: <strong className="text-green-500">${oancaDebug.buy_high?.toLocaleString()}</strong></span>
                  </div>
                </div>
              )}
              
              {oancaDebug.escalation_reason && (
                <div className="pt-2 border-t border-red-500/20 text-red-400">
                  <p className="text-muted-foreground mb-1">Escalation Reason:</p>
                  <p>{oancaDebug.escalation_reason}</p>
                </div>
              )}
              
              {oancaDebug.notes && oancaDebug.notes.length > 0 && (
                <div className="pt-2 border-t border-yellow-500/20">
                  <p className="text-muted-foreground mb-1">OANCA Notes:</p>
                  <ul className="list-disc list-inside text-xs opacity-80 max-h-32 overflow-y-auto">
                    {oancaDebug.notes.map((note: string, i: number) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div className="pt-2 border-t border-yellow-500/20 text-muted-foreground flex justify-between">
                <span>Processing: {oancaDebug.processing_time_ms}ms</span>
                <span>Comps: {oancaDebug.comps_used?.length || 0}</span>
                <span>Market: {oancaDebug.market}/{oancaDebug.currency}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bob Avatar - self-contained AI voice agent */}
      <BobAvatar dealerName={currentUser?.dealer_name} />
    </AppLayout>
  );
}
