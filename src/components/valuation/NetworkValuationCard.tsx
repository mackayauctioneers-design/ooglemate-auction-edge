import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, DollarSign, Clock, BarChart3, Eye, EyeOff } from 'lucide-react';
import { dataService } from '@/services/dataService';
import { NetworkValuationResult, NetworkValuationRequest, formatCurrency } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface NetworkValuationCardProps {
  initialRequest?: Partial<NetworkValuationRequest>;
}

export function NetworkValuationCard({ initialRequest }: NetworkValuationCardProps) {
  const { currentUser, isAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NetworkValuationResult | null>(null);
  const [showFingerprintIds, setShowFingerprintIds] = useState(false);
  
  // Form state
  const [make, setMake] = useState(initialRequest?.make || '');
  const [model, setModel] = useState(initialRequest?.model || '');
  const [variantFamily, setVariantFamily] = useState(initialRequest?.variant_family || '');
  const [year, setYear] = useState(initialRequest?.year?.toString() || new Date().getFullYear().toString());

  const handleGetValuation = async () => {
    if (!make || !model || !year) {
      toast.error('Make, Model, and Year are required');
      return;
    }

    setLoading(true);
    try {
      const request: NetworkValuationRequest = {
        make,
        model,
        year: parseInt(year),
        variant_family: variantFamily || undefined,
        requesting_dealer: currentUser?.dealer_name,
      };

      const valuation = await dataService.getNetworkValuation(request, isAdmin);
      setResult(valuation);
      
      if (valuation.sample_size === 0) {
        toast.warning('No comparable sales found in the network');
      } else {
        toast.success(`Valuation complete (${valuation.sample_size} comparables)`);
      }
    } catch (error) {
      console.error('Valuation error:', error);
      toast.error('Failed to get valuation');
    } finally {
      setLoading(false);
    }
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'HIGH':
        return <Badge className="bg-green-500 hover:bg-green-600">HIGH</Badge>;
      case 'MEDIUM':
        return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">MEDIUM</Badge>;
      case 'LOW':
        return <Badge variant="destructive">LOW</Badge>;
      default:
        return <Badge variant="secondary">{confidence}</Badge>;
    }
  };

  const getDataSourceLabel = (source: string) => {
    switch (source) {
      case 'internal':
        return <Badge variant="outline" className="border-green-500 text-green-700">Internal Data</Badge>;
      case 'network':
        return <Badge variant="outline" className="border-blue-500 text-blue-700">Network Data</Badge>;
      case 'none':
        return <Badge variant="outline" className="border-muted-foreground">No Data</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Network Proxy Valuation
        </CardTitle>
        <CardDescription>
          Get market valuation based on anonymised network outcomes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Input Form */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label htmlFor="make">Make *</Label>
            <Input
              id="make"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="e.g., Toyota"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="model">Model *</Label>
            <Input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g., Hilux"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="variant">Variant Family</Label>
            <Input
              id="variant"
              value={variantFamily}
              onChange={(e) => setVariantFamily(e.target.value)}
              placeholder="e.g., SR5"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="year">Year *</Label>
            <Input
              id="year"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2023"
            />
          </div>
        </div>

        <Button 
          onClick={handleGetValuation} 
          disabled={loading || !make || !model || !year}
          className="w-full md:w-auto"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Calculating...
            </>
          ) : (
            'Get Valuation'
          )}
        </Button>

        {/* Results */}
        {result && (
          <div className="space-y-4 pt-4 border-t">
            {/* Header with confidence */}
            <div className="flex flex-wrap items-center gap-2">
              {getConfidenceBadge(result.confidence)}
              {getDataSourceLabel(result.data_source)}
              <span className="text-sm text-muted-foreground">
                n = {result.sample_size}
              </span>
            </div>

            <p className="text-sm text-muted-foreground italic">
              {result.confidence_reason}
            </p>

            {result.sample_size > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Average Buy Price */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <DollarSign className="h-4 w-4" />
                    Avg Buy Price
                  </div>
                  <div className="text-xl font-semibold">
                    {result.avg_buy_price ? formatCurrency(result.avg_buy_price) : 'N/A'}
                  </div>
                  {result.buy_price_range && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatCurrency(result.buy_price_range.min)} - {formatCurrency(result.buy_price_range.max)}
                    </div>
                  )}
                </Card>

                {/* Average Sell Price */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <TrendingUp className="h-4 w-4" />
                    Avg Sell Price
                  </div>
                  <div className="text-xl font-semibold">
                    {result.avg_sell_price ? formatCurrency(result.avg_sell_price) : 'N/A'}
                  </div>
                  {result.sell_price_range && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatCurrency(result.sell_price_range.min)} - {formatCurrency(result.sell_price_range.max)}
                    </div>
                  )}
                </Card>

                {/* Average Gross Profit */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <BarChart3 className="h-4 w-4" />
                    Avg Gross Profit
                  </div>
                  <div className={`text-xl font-semibold ${result.avg_gross_profit && result.avg_gross_profit > 0 ? 'text-green-600' : result.avg_gross_profit && result.avg_gross_profit < 0 ? 'text-red-600' : ''}`}>
                    {result.avg_gross_profit ? formatCurrency(result.avg_gross_profit) : 'N/A'}
                  </div>
                </Card>

                {/* Days to Sell */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Clock className="h-4 w-4" />
                    Avg Days to Sell
                  </div>
                  <div className="text-xl font-semibold">
                    {result.avg_days_to_sell ? `${Math.round(result.avg_days_to_sell)} days` : 'N/A'}
                  </div>
                </Card>
              </div>
            )}

            {/* Admin: Contributing Fingerprints */}
            {isAdmin && result.contributing_fingerprint_ids && result.contributing_fingerprint_ids.length > 0 && (
              <div className="pt-4 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFingerprintIds(!showFingerprintIds)}
                  className="mb-2"
                >
                  {showFingerprintIds ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-2" />
                      Hide Contributing IDs
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-2" />
                      Show Contributing IDs (Admin)
                    </>
                  )}
                </Button>
                
                {showFingerprintIds && (
                  <div className="bg-muted/50 p-3 rounded-md">
                    <p className="text-xs text-muted-foreground mb-2">
                      Contributing Fingerprint IDs (for audit only):
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {result.contributing_fingerprint_ids.map(id => (
                        <Badge key={id} variant="outline" className="text-xs font-mono">
                          {id}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {result.sample_size === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No comparable sales found in the network.</p>
                <p className="text-sm mt-1">Try broadening your search criteria.</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
