import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, TrendingUp, DollarSign, Clock, BarChart3, AlertCircle, CheckCircle, Camera, MessageSquare } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ValoParsedVehicle, ValoResult, ValoTier, ValuationConfidence, formatCurrency } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { dataService } from '@/services/dataService';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SendPicsToFrank } from '@/components/valo/SendPicsToFrank';

// ============================================================================
// SYSTEM: FRANK (VALO ENGINE)
// ============================================================================
// You are FRANK — an experienced Australian auction knocker with 20+ years on the floor.
//
// PERSONALITY:
// - Straight shooter
// - Aussie slang
// - Loves the footy
// - Married to Shaz
// - Pub after work, couple of schooners
// - Talks about cars as "fighters"
// - Calm, confident, no hype
//
// CORE RULES:
// - Frank prices cars to BUY them — not to bounce them
// - Frank never inflates value
// - Frank always protects margin
// - Frank bases opinions on real historical sales data
// - Frank considers:
//   - what was paid
//   - what it sold for
//   - how long ago
//   - days to sell
//   - capital tied up
// - Frank understands wholesale margins:
//   - $5k car → $500–$1k margin
//   - $100k car → $2k–$3k margin
// - Frank may mention retail ask as context, but pricing is WHOLESALE FIRST
//
// OUTPUT FORMAT:
// Frank responds in conversational Aussie tone. Frank gives:
// 1. Verdict (BUY / HIT IT / HARD WORK / NEED PICS / WALK AWAY)
// 2. Wholesale buy range
// 3. Retail context (optional)
// 4. Confidence level
// 5. Optional next action (photos, buyer check)
//
// SPECIAL RULES:
// - Frank NEVER overcommits without data
// - Frank is allowed to say "I need pics"
// - Frank is allowed to say "I'd walk"
// - Frank never says "guaranteed", "easy money", or hype language
//
// Frank is a valuation assistant, not financial advice.
//
// NON-NEGOTIABLE: FRANK DOES NOT BOUNCE CARS
// - Frank will not provide a buy price that only works as a quick flip
// - If a deal relies on heat, timing, or someone else paying up, Frank refuses
// - When Frank gives a price, it is an ownable price he is comfortable holding
// - If a car cannot be priced to own, Frank returns HARD WORK or HARD NO
//
// This is a valuation assistant, not financial advice.
// ============================================================================

interface FrankSignals {
  avgGross: number | null;
  avgDaysToSell: number | null;
  isRepeatLoser: boolean; // Historical gross <= 0 - HARD NO
  isSlow: boolean; // Days to sell > 45
  isHardWork: boolean; // Marginal gross < $1500
  isBounceOnly: boolean; // Can only make money on a quick flip - HARD NO
  priceband: 'low' | 'mid' | 'high'; // For margin protection
}

function calculateFrankSignals(result: ValoResult): FrankSignals {
  const avgGross = result.expected_gross_band 
    ? (result.expected_gross_band.min + result.expected_gross_band.max) / 2 
    : null;
  const avgDaysToSell = result.typical_days_to_sell;
  const avgBuy = result.suggested_buy_range 
    ? (result.suggested_buy_range.min + result.suggested_buy_range.max) / 2 
    : 0;

  // Bounce-only detection: thin margin AND slow turn = can't own it profitably
  // This means the only way to make money is timing/heat/flipping
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

// Light personality lines - ONLY for #1, #2, #3 responses
const frankPersonalityLines = [
  "I've seen a few of these come and go over the years.",
  "Blokes get excited about these, but the money tells the truth.",
  "If it stacks up, I'd back it.",
];

function getOptionalPersonality(): string {
  // 30% chance to add a light personality line
  if (Math.random() > 0.7) {
    return " " + frankPersonalityLines[Math.floor(Math.random() * frankPersonalityLines.length)];
  }
  return "";
}

// FRANK RESPONSE #1: High confidence, good margins, quick turn
// Light personality ALLOWED
function frankResponse1(vehicleDesc: string, buyLow: string, buyHigh: string, sellLow: string, sellHigh: string, days: number, n: number): string {
  const personality = getOptionalPersonality();
  return `Yeah mate, that's a good fighter. Based on what you've paid and got before, I'd want to be ${buyLow} to ${buyHigh} wholesale. Retail it ${sellLow} to ${sellHigh} and she'll be gone in about ${Math.round(days)} days. Got ${n} comps backing this up.${personality}`;
}

// FRANK RESPONSE #2: Medium confidence from network
// Light personality ALLOWED
function frankResponse2(vehicleDesc: string, buyLow: string, buyHigh: string, sellLow: string, sellHigh: string, days: number | null, n: number): string {
  const daysText = days ? ` Typically turning in ${Math.round(days)} days across the network.` : '';
  const personality = getOptionalPersonality();
  return `Alright, I'm pulling from network outcomes here – ${n} comps from other dealers. I'd want to be ${buyLow} to ${buyHigh} to buy it. Retail ask ${sellLow} to ${sellHigh}.${daysText} Not your direct history, so I'd want eyes on it.${personality}`;
}

// FRANK RESPONSE #3: Low confidence / proxy only (NEEDS EYES)
// Light personality ALLOWED
function frankResponse3(vehicleDesc: string, buyLow: string, buyHigh: string): string {
  const personality = getOptionalPersonality();
  return `Look mate, I'm working off limited data here – advisory only. Rough guide says ${buyLow} to ${buyHigh} to buy it, but don't hold me to that. Get me some photos and I'll have one of the boys give it a proper look.${personality}`;
}

// FRANK RESPONSE #4: NO DATA - needs human review
// NO personality - serious tone only
function frankResponse4NoData(vehicleDesc: string): string {
  return `Mate, I haven't got enough runs on the board with ${vehicleDesc || 'this one'} to give you a solid number. Based on limited data – advisory only. I'd want eyes on it before saying anything. Get me some photos and I'll have one of the boys take a proper look.`;
}

// FRANK RESPONSE #5: HARD WORK - marginal profit
// Cautious but straightforward
function frankResponse5(vehicleDesc: string, buyLow: string, buyHigh: string, avgGross: number, days: number | null): string {
  const daysText = days ? ` in ${Math.round(days)} days` : '';
  return `This is honest bit of gear but it's hard work. Based on what you've paid and got before, your margin's typically around ${formatCurrency(avgGross)}${daysText}. I'd want to be ${buyLow} to ${buyHigh} – any sillier and the money disappears. I've been burnt on worse – that's why I'm cautious.`;
}

// FRANK RESPONSE #6: HARD NO - repeat loser / negative history
// NO personality, NO jokes - dead serious
function frankResponse6HardNo(vehicleDesc: string, avgGross: number, days: number | null, n: number): string {
  const daysText = days ? ` and sat for ${Math.round(days)} days` : '';
  return `Mate, I've gotta be straight with you – your history shows you've lost money on these. Based on what you've paid and got before, average gross was ${formatCurrency(avgGross)}${daysText}. That's ${n} runs where money disappeared. I wouldn't be buying unless the seller's properly motivated and you've fixed what went wrong last time.`;
}

// FRANK RESPONSE #8: BOUNCE-ONLY - can't price to own
// NO personality - this is a refusal to price
function frankResponse8BounceOnly(vehicleDesc: string, avgGross: number, days: number): string {
  return `I'm not going to give you a buy price on this one. The numbers say ${formatCurrency(avgGross)} gross over ${Math.round(days)} days – that's bounce territory. The only way to make money is timing and heat, and I don't price cars to flip. If you can't own it comfortably, I won't put a number on it. This one's a pass unless you know something I don't.`;
}

// FRANK RESPONSE #7: SLOW TURNER - capital tied up
// Serious but not a hard no
function frankResponse7Slow(vehicleDesc: string, buyLow: string, buyHigh: string, days: number, avgGross: number | null): string {
  const grossText = avgGross ? `Gross is typically ${formatCurrency(avgGross)} but` : `But`;
  return `These are slow. ${grossText} you're looking at ${Math.round(days)} days average to move them. Based on what you've paid and got before, I'd want to be ${buyLow} to ${buyHigh} to protect yourself. Factor in floorplan and the aggravation – money's tied up.`;
}

// Generate VALO's conversational response in Australian wholesale buyer tone
// LOCKED LOGIC: All valuations reference Sales Log data sources
function generateValoResponse(result: ValoResult, parsed: ValoParsedVehicle): string {
  const { confidence, sample_size, suggested_buy_range, suggested_sell_range, tier, tier_label } = result;
  
  // Build vehicle description
  const vehicleDesc = [
    parsed.year,
    parsed.make,
    parsed.model,
    parsed.variant_family
  ].filter(Boolean).join(' ');

  // No data case - NEVER invent confidence (NEEDS EYES #4)
  if (sample_size === 0 || !suggested_buy_range) {
    return frankResponse4NoData(vehicleDesc);
  }

  const buyLow = formatCurrency(suggested_buy_range.min);
  const buyHigh = formatCurrency(suggested_buy_range.max);
  const sellLow = suggested_sell_range ? formatCurrency(suggested_sell_range.min) : null;
  const sellHigh = suggested_sell_range ? formatCurrency(suggested_sell_range.max) : null;

  // Calculate Frank signals from sales data
  const signals = calculateFrankSignals(result);
  const lines: string[] = [];

  // RULE: Never override negative sales history
  // Check for REPEAT LOSER first (gross <= 0) - HARD NO #6
  if (signals.isRepeatLoser && signals.avgGross !== null) {
    lines.push(frankResponse6HardNo(vehicleDesc, signals.avgGross, result.typical_days_to_sell || null, sample_size));
  }
  // RULE: Frank does not bounce cars - if can only flip, refuse to price
  // Check for BOUNCE-ONLY (thin margin + slow turn) - HARD NO #8
  else if (signals.isBounceOnly && signals.avgGross !== null && result.typical_days_to_sell) {
    lines.push(frankResponse8BounceOnly(vehicleDesc, signals.avgGross, result.typical_days_to_sell));
  }
  // Check for SLOW TURNER (days > 45) - #7
  else if (signals.isSlow && result.typical_days_to_sell) {
    lines.push(frankResponse7Slow(vehicleDesc, buyLow, buyHigh, result.typical_days_to_sell, signals.avgGross));
  }
  // Check for HARD WORK (marginal profit < $1500) - #5
  else if (signals.isHardWork && signals.avgGross !== null) {
    lines.push(frankResponse5(vehicleDesc, buyLow, buyHigh, signals.avgGross, result.typical_days_to_sell || null));
  }
  // HIGH confidence - dealer history (FRANK #1)
  else if (confidence === 'HIGH' && tier === 'dealer' && sellLow && sellHigh && result.typical_days_to_sell) {
    lines.push(frankResponse1(vehicleDesc, buyLow, buyHigh, sellLow, sellHigh, result.typical_days_to_sell, sample_size));
  }
  // MEDIUM confidence - network data (FRANK #2)
  else if (confidence === 'MEDIUM' && tier === 'network' && sellLow && sellHigh) {
    lines.push(frankResponse2(vehicleDesc, buyLow, buyHigh, sellLow, sellHigh, result.typical_days_to_sell || null, sample_size));
  }
  // LOW confidence - proxy only (FRANK #3)
  else if (confidence === 'LOW') {
    lines.push(frankResponse3(vehicleDesc, buyLow, buyHigh));
  }
  // Fallback - still need to provide value
  else {
    // Determine data source text
    const sourceText = tier === 'dealer' 
      ? 'Based on what you\'ve paid and got before'
      : tier === 'network' 
        ? 'Based on network outcomes'
        : 'Based on limited data – advisory only';
    
    lines.push(`${sourceText}, I'd want to be ${buyLow} to ${buyHigh} to buy it.`);
    
    if (sellLow && sellHigh) {
      // Separate wholesale buy from retail ask
      lines.push(`Retail ask ${sellLow} to ${sellHigh}.`);
    }
    
    if (result.typical_days_to_sell) {
      lines.push(`Typically turning in ${Math.round(result.typical_days_to_sell)} days.`);
    }
    
    lines.push(`Got ${sample_size} comps to go on.`);
  }

  // Margin protection warning based on priceband
  if (signals.priceband === 'high' && !signals.isRepeatLoser) {
    lines.push(`At this price point, every grand matters – don't get silly.`);
  }

  // Missing fields / condition warning - ALWAYS flag uncertainty
  const conditionUncertain = !parsed.km || parsed.missing_fields.includes('km');
  if (conditionUncertain) {
    lines.push(`Can't see the kays on this one – that'll shift things either way.`);
  }

  // Assumptions callout - ALWAYS say assumptions out loud
  if (parsed.assumptions && parsed.assumptions.length > 0) {
    lines.push(`By the way, I'm assuming: ${parsed.assumptions.join('; ')}.`);
  }

  return lines.join(' ');
}

export default function ValoPage() {
  const { currentUser, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  
  // Form state
  const [inputText, setInputText] = useState('');
  const [location, setLocation] = useState('');
  const [sourceLink, setSourceLink] = useState('');
  
  // Processing state
  const [isParsing, setIsParsing] = useState(false);
  const [isValuating, setIsValuating] = useState(false);
  const [parsed, setParsed] = useState<ValoParsedVehicle | null>(null);
  const [result, setResult] = useState<ValoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefill from URL params (when clicking VALO button on a lot)
  useEffect(() => {
    const prefillText = searchParams.get('prefill');
    const prefillLink = searchParams.get('link');
    
    if (prefillText) {
      setInputText(decodeURIComponent(prefillText));
    }
    if (prefillLink) {
      setSourceLink(decodeURIComponent(prefillLink));
    }
  }, [searchParams]);

  useEffect(() => {
    document.title = 'VALO | OogleMate';
    return () => { document.title = 'OogleMate'; };
  }, []);

  const handleRunValo = async () => {
    if (!inputText.trim()) {
      toast.error('Please describe the car');
      return;
    }

    setError(null);
    setParsed(null);
    setResult(null);
    setIsParsing(true);

    try {
      // Step 1: Parse the description with AI
      const { data: parseData, error: parseError } = await supabase.functions.invoke('valo-parse', {
        body: { description: inputText }
      });

      if (parseError) throw new Error(parseError.message);
      if (parseData?.error) throw new Error(parseData.error);

      const parsedVehicle: ValoParsedVehicle = parseData.parsed;
      // Ensure assumptions array exists
      if (!parsedVehicle.assumptions) {
        parsedVehicle.assumptions = [];
      }
      setParsed(parsedVehicle);
      setIsParsing(false);

      // Step 2: Run valuation if we have enough data
      if (!parsedVehicle.make || !parsedVehicle.model) {
        setError('Could not determine make and model from description. Please be more specific.');
        return;
      }

      setIsValuating(true);

      // Get valuation using the 3-tier logic
      const valuation = await runValoValuation(parsedVehicle, currentUser?.dealer_name);
      setResult({
        parsed: parsedVehicle,
        ...valuation,
        request_id: crypto.randomUUID(),
        timestamp: new Date().toISOString()
      });

      toast.success('VALO complete');
    } catch (err) {
      console.error('VALO error:', err);
      const msg = err instanceof Error ? err.message : 'Failed to run VALO';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsParsing(false);
      setIsValuating(false);
    }
  };

  // 3-tier valuation logic
  const runValoValuation = async (
    parsed: ValoParsedVehicle,
    dealerName?: string
  ): Promise<Omit<ValoResult, 'parsed' | 'request_id' | 'timestamp'>> => {
    const make = parsed.make!;
    const model = parsed.model!;
    const year = parsed.year || new Date().getFullYear();
    const variantFamily = parsed.variant_family || undefined;
    const km = parsed.km || undefined;

    // Tier 1: Dealer history comps (if we have a dealer)
    if (dealerName) {
      const dealerResult = await dataService.getNetworkValuation({
        make,
        model,
        variant_family: variantFamily,
        year,
        km,
        requesting_dealer: dealerName,
      }, isAdmin);

      // Check if we have internal data (Tier 1)
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

    // Tier 2: Network proxy comps (anonymised)
    const networkResult = await dataService.getNetworkValuation({
      make,
      model,
      variant_family: variantFamily,
      year,
      year_tolerance: 2,
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

    // Tier 3: Proxy-only (make + model only, broader)
    const proxyResult = await dataService.getNetworkValuation({
      make,
      model,
      year,
      year_tolerance: 3,
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

    // No data at all
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


  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">VALO</h1>
            <p className="text-muted-foreground">Ask VALO about a car</p>
          </div>
        </div>

        {/* Input Form */}
        <Card>
          <CardHeader>
            <CardTitle>What are you looking at?</CardTitle>
            <CardDescription>
              Describe the car however you like – VALO will figure it out
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="description">Vehicle Description *</Label>
              <Textarea
                id="description"
                placeholder='e.g., "2025 Toyota Land Cruiser 10,000 km dual cab V8 manual nice car"'
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location">Location (optional)</Label>
                <Input
                  id="location"
                  placeholder="e.g., Sydney"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source">Source Link (optional)</Label>
                <Input
                  id="source"
                  placeholder="e.g., auction or listing URL"
                  value={sourceLink}
                  onChange={(e) => setSourceLink(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button 
                onClick={handleRunValo} 
                disabled={isParsing || isValuating || !inputText.trim()}
                className="gap-2"
                size="lg"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reading...
                  </>
                ) : isValuating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Run VALO
                  </>
                )}
              </Button>
              
              {currentUser && (
                <span className="text-sm text-muted-foreground">
                  {currentUser.dealer_name}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Error Display */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <p>{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* VALO Response - Conversational */}
        {result && parsed && (
          <Card className="border-primary bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary text-primary-foreground shrink-0">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div className="space-y-4 flex-1">
                  <p className="text-lg leading-relaxed">
                    {generateValoResponse(result, parsed)}
                  </p>
                  
                  {/* Badges row */}
                  <div className="flex flex-wrap items-center gap-2">
                    {getConfidenceBadge(result.confidence)}
                    {getTierBadge(result.tier)}
                    <Badge variant="secondary">n = {result.sample_size}</Badge>
                  </div>

                  {/* Send Pics to Frank - always visible on responses */}
                  {currentUser?.dealer_name && (
                    <div className="pt-2">
                      <SendPicsToFrank
                        result={result}
                        parsed={parsed}
                        frankResponse={generateValoResponse(result, parsed)}
                        dealerName={currentUser.dealer_name}
                        onSubmitted={(requestId) => {
                          toast.success("Photos sent! Frank's team will review and get back to you.");
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Parsed Details (collapsible feel) */}
        {parsed && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                What I'm working with
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
        {result && result.sample_size > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Buy Range */}
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

            {/* Sell Range */}
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

            {/* Gross Band */}
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

            {/* Days to Sell */}
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
        )}

        {/* Comparables Table (for dealer tier) */}
        {result && result.tier === 'dealer' && result.top_comps.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Comparables</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Sell Price</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.top_comps.map((comp, i) => (
                    <TableRow key={i}>
                      <TableCell>{comp.sale_date || '-'}</TableCell>
                      <TableCell className="text-right">
                        {comp.sell_price ? formatCurrency(comp.sell_price) : '-'}
                      </TableCell>
                      <TableCell className="text-right">{comp.days_to_sell || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}


        {/* No data message */}
        {result && result.sample_size === 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-4 text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No comparable sales found in the system.</p>
                <p className="text-sm mt-1">Request a buyer review for a manual assessment.</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
