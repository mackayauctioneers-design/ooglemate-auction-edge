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

// Generate VALO's conversational response in Australian wholesale buyer tone
function generateValoResponse(result: ValoResult, parsed: ValoParsedVehicle): string {
  const { confidence, sample_size, suggested_buy_range, suggested_sell_range, tier, typical_days_to_sell } = result;
  
  // Build vehicle description
  const vehicleDesc = [
    parsed.year,
    parsed.make,
    parsed.model,
    parsed.variant_family
  ].filter(Boolean).join(' ');

  // No data case
  if (sample_size === 0 || !suggested_buy_range) {
    return `Mate, I haven't got enough runs on the board with ${vehicleDesc || 'this one'} to give you a solid number. I'd want eyes on it before saying anything. Get me some photos and I'll have one of the boys take a proper look.`;
  }

  const buyLow = formatCurrency(suggested_buy_range.min);
  const buyHigh = formatCurrency(suggested_buy_range.max);
  const sellLow = suggested_sell_range ? formatCurrency(suggested_sell_range.min) : null;
  const sellHigh = suggested_sell_range ? formatCurrency(suggested_sell_range.max) : null;

  const lines: string[] = [];

  // Opening line based on confidence
  if (confidence === 'HIGH') {
    const openers = [
      `Yeah mate, that's a good fighter.`,
      `Right, I know this one well.`,
      `This is honest bit of gear.`,
    ];
    lines.push(openers[Math.floor(Math.random() * openers.length)]);
  } else if (confidence === 'MEDIUM') {
    lines.push(`Alright, I've got a feel for this one, but ${tier === 'network' ? "I'm pulling from the broader network here" : "the sample's a bit thin"}.`);
  } else {
    lines.push(`Look, I'm working off proxy data here so take this with a grain of salt.`);
  }

  // Buy range advice
  if (confidence === 'HIGH') {
    lines.push(`I'd want to be ${buyLow} to ${buyHigh} to buy it. Money disappears if you get silly above that.`);
  } else if (confidence === 'MEDIUM') {
    lines.push(`I'd be thinking ${buyLow} to ${buyHigh} to get into it, but I'd want eyes on it first.`);
  } else {
    lines.push(`Rough guide, you're probably looking at ${buyLow} to ${buyHigh} range, but don't hold me to that.`);
  }

  // Sell range and days
  if (sellLow && sellHigh) {
    if (typical_days_to_sell && typical_days_to_sell <= 30) {
      lines.push(`Should move quick – these are turning in about ${Math.round(typical_days_to_sell)} days. Retail it around ${sellLow} to ${sellHigh}.`);
    } else if (typical_days_to_sell) {
      lines.push(`Expect to sit on it for ${Math.round(typical_days_to_sell)} days or so. Pitch it ${sellLow} to ${sellHigh} retail.`);
    } else {
      lines.push(`Retail it around ${sellLow} to ${sellHigh}.`);
    }
  }

  // Sample size context
  if (sample_size >= 5) {
    lines.push(`Got ${sample_size} comps backing this up.`);
  } else if (sample_size >= 2) {
    lines.push(`Only ${sample_size} comps to go on, so keep that in mind.`);
  }

  // Missing fields / condition warning
  const conditionUncertain = !parsed.km || parsed.missing_fields.includes('km');
  if (conditionUncertain) {
    lines.push(`Can't see the kays on this one – that'll shift things either way.`);
  }

  // Assumptions callout
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

  const handleRequestBuyerReview = () => {
    toast.info('Buyer Review feature coming soon – photos upload will be required');
    // TODO: Implement photo upload and review request creation
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

  // Determine if buyer review should be shown
  const showBuyerReview = result && (result.confidence !== 'HIGH' || (parsed && !parsed.km));

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

        {/* Request Buyer Review button */}
        {showBuyerReview && (
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <p className="font-medium">Need more certainty?</p>
                  <p className="text-sm text-muted-foreground">
                    Upload photos and get a reviewed valuation from our buyers
                  </p>
                </div>
                <Button variant="outline" onClick={handleRequestBuyerReview} className="gap-2">
                  <Camera className="h-4 w-4" />
                  Request Buyer Review
                </Button>
              </div>
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
