import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, TrendingUp, DollarSign, Clock, BarChart3, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ValoParsedVehicle, ValoResult, ValoTier, ValuationConfidence, formatCurrency } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { dataService } from '@/services/dataService';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

      toast.success(`Valuation complete (${valuation.tier_label})`);
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
          top_comps: [] // Would need to expose this from the service
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
      // Don't pass km for network - it's ignored anyway
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
      year_tolerance: 3, // Wider tolerance
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
            <p className="text-muted-foreground">AI-powered instant valuation</p>
          </div>
        </div>

        {/* Input Form */}
        <Card>
          <CardHeader>
            <CardTitle>Describe the Vehicle</CardTitle>
            <CardDescription>
              Enter any text describing the car - we'll extract the details automatically
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
                    Parsing...
                  </>
                ) : isValuating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Valuating...
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
                  Dealer: {currentUser.dealer_name}
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

        {/* Parsed Vehicle Display */}
        {parsed && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                Parsed Vehicle
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
              
              {parsed.notes && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-muted-foreground text-sm">Notes</p>
                  <p className="text-sm">{parsed.notes}</p>
                </div>
              )}

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

        {/* Valuation Results */}
        {result && (
          <Card className="border-primary">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Valuation Result
                </CardTitle>
                <div className="flex items-center gap-2">
                  {getConfidenceBadge(result.confidence)}
                  {getTierBadge(result.tier)}
                  <Badge variant="secondary">n = {result.sample_size}</Badge>
                </div>
              </div>
              <CardDescription>
                Based on: {result.tier_label}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {result.sample_size > 0 ? (
                <>
                  {/* Metrics Grid */}
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

                  {/* Comparables Table (for dealer tier) */}
                  {result.tier === 'dealer' && result.top_comps.length > 0 && (
                    <div className="pt-4 border-t">
                      <h4 className="font-medium mb-3">Top Comparables</h4>
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
                    </div>
                  )}

                  {/* Network disclaimer */}
                  {(result.tier === 'network' || result.tier === 'proxy') && (
                    <p className="text-sm text-muted-foreground italic">
                      Data is anonymised. Dealer identities are never exposed.
                    </p>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>No comparable sales found.</p>
                  <p className="text-sm mt-1">Try a different vehicle or check the parsed details.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
