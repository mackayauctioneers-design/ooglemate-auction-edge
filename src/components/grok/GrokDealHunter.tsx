import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Car, TrendingUp, AlertTriangle, ExternalLink, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface DealOpportunity {
  title: string;
  year: number;
  km: number;
  offRoadPrice: number;
  marginPct: number;
  link: string;
  risks: string;
  notes: string;
}

interface GrokResponse {
  opportunities?: DealOpportunity[];
  rawResponse?: string;
  error?: string;
}

export function GrokDealHunter() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<DealOpportunity[]>([]);
  const [rawResponse, setRawResponse] = useState<string | null>(null);
  
  // Form state
  const [model, setModel] = useState('');
  const [yearMin, setYearMin] = useState(2018);
  const [yearMax, setYearMax] = useState(2024);
  const [maxKm, setMaxKm] = useState(100000);
  const [maxPrice, setMaxPrice] = useState(50000);
  const [location, setLocation] = useState('');

  const handleHunt = async () => {
    if (!model.trim()) {
      toast({
        title: 'Model required',
        description: 'Please enter a car model to search for',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setResults([]);
    setRawResponse(null);

    try {
      const { data, error } = await supabase.functions.invoke('grok-deal-hunter', {
        body: {
          model: model.trim(),
          yearMin,
          yearMax,
          maxKm,
          maxPrice,
          location: location.trim() || 'Australia-wide',
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      const response = data as GrokResponse;
      
      if (response.error) {
        toast({
          title: 'Hunt failed',
          description: response.error,
          variant: 'destructive',
        });
        if (response.rawResponse) {
          setRawResponse(response.rawResponse);
        }
        return;
      }

      if (response.opportunities && response.opportunities.length > 0) {
        setResults(response.opportunities);
        toast({
          title: 'Hunt complete!',
          description: `Found ${response.opportunities.length} opportunities`,
        });
      } else {
        toast({
          title: 'No opportunities found',
          description: 'Try broadening your search criteria',
        });
      }
    } catch (err) {
      console.error('Grok hunt error:', err);
      toast({
        title: 'Hunt failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getMarginBadgeVariant = (margin: number): "default" | "secondary" | "destructive" | "outline" => {
    if (margin >= 15) return 'default';
    if (margin >= 10) return 'default';
    if (margin >= 5) return 'secondary';
    return 'outline';
  };

  const getMarginLabel = (margin: number) => {
    if (margin >= 15) return 'Hot';
    if (margin >= 10) return 'Good';
    return '';
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                Grok Deal Hunter
                <Badge variant="outline" className="text-xs">xAI Powered</Badge>
              </CardTitle>
              <CardDescription>
                AI-powered arbitrage analysis using xAI Grok for deep market reasoning
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Model */}
            <div className="space-y-2">
              <Label htmlFor="model">Car Model</Label>
              <Input
                id="model"
                placeholder="e.g. Toyota Hilux, Ford Ranger"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>

            {/* Year Range */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="yearMin">Year From</Label>
                <Input
                  id="yearMin"
                  type="number"
                  min={2000}
                  max={2025}
                  value={yearMin}
                  onChange={(e) => setYearMin(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="yearMax">Year To</Label>
                <Input
                  id="yearMax"
                  type="number"
                  min={2000}
                  max={2025}
                  value={yearMax}
                  onChange={(e) => setYearMax(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Max KM */}
            <div className="space-y-2">
              <Label htmlFor="maxKm">Max Odometer (km)</Label>
              <Input
                id="maxKm"
                type="number"
                min={0}
                step={10000}
                value={maxKm}
                onChange={(e) => setMaxKm(Number(e.target.value))}
              />
            </div>

            {/* Max Price */}
            <div className="space-y-2">
              <Label htmlFor="maxPrice">Max Off-Road Price ($)</Label>
              <Input
                id="maxPrice"
                type="number"
                min={0}
                step={1000}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
              />
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label htmlFor="location">Location (optional)</Label>
              <Input
                id="location"
                placeholder="e.g. Sydney, QLD, Australia-wide"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>

            {/* Submit Button */}
            <div className="flex items-end">
              <Button
                onClick={handleHunt}
                disabled={isLoading}
                className="w-full gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Hunting...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Hunt Deals with Grok
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <Card className="border-dashed">
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-medium">Grok is analyzing the market...</p>
                <p className="text-sm text-muted-foreground">
                  Searching dealer, private, and auction patterns across Australia
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Grid */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Opportunities Found
            </h3>
            <Badge variant="secondary">{results.length} deals</Badge>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((deal, index) => (
              <Card key={index} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Car className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-base leading-tight">{deal.title}</CardTitle>
                    </div>
                    <Badge variant={getMarginBadgeVariant(deal.marginPct)} className="shrink-0">
                      +{deal.marginPct}% {getMarginLabel(deal.marginPct)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Key Stats */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Year:</span>
                      <span className="font-medium">{deal.year}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">KM:</span>
                      <span className="font-medium">{deal.km.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                    <span className="text-sm text-muted-foreground">Off-road price</span>
                    <span className="text-lg font-bold text-primary">
                      ${deal.offRoadPrice.toLocaleString()}
                    </span>
                  </div>

                  {/* Link/Search */}
                  <div className="text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Search tip:</span>
                    </div>
                    <p className="text-foreground">{deal.link}</p>
                  </div>

                  {/* Risks */}
                  {deal.risks && (
                    <div className="text-sm">
                      <div className="flex items-center gap-1.5 text-destructive mb-1">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>Risks:</span>
                      </div>
                      <p className="text-muted-foreground">{deal.risks}</p>
                    </div>
                  )}

                  {/* Notes */}
                  {deal.notes && (
                    <div className="text-sm pt-2 border-t">
                      <p className="text-muted-foreground italic">{deal.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Raw Response Fallback */}
      {rawResponse && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Raw Response
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded-lg overflow-auto max-h-60">
              {rawResponse}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
