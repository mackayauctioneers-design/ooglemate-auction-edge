import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { 
  Loader2, 
  Sparkles, 
  Car, 
  TrendingUp, 
  ExternalLink, 
  MapPin, 
  CheckCircle2,
  AlertCircle,
  FileText,
  Link2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Mission {
  mission_name: string;
  make: string;
  model: string;
  variant_allow?: string[];
  year_min?: number;
  year_max?: number;
  km_max?: number;
  price_max?: number | null;
  location?: string;
  seller_type?: string[];
  exclude_sources?: string[];
  allowed_domains?: string[];
  notes?: string;
}

interface GrokCandidate {
  listing_url: string;
  dealer_name: string | null;
  location: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  km: number | null;
  price: number | null;
  vin: string | null;
  stock_number: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence_snippet: string;
}

interface MissionResponse {
  success: boolean;
  mission?: string;
  found?: number;
  upserted?: number;
  candidates?: GrokCandidate[];
  error?: string;
  rawResponse?: string;
}

const SELLER_TYPES = [
  { id: 'dealer', label: 'Dealer' },
  { id: 'private', label: 'Private' },
  { id: 'auction', label: 'Auction' },
];

const DEFAULT_DOMAINS = [
  'carsales.com.au',
  'dealer.toyota.com.au',
  'gumtree.com.au',
  'drive.com.au',
];

export function GrokMissionHunter() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<GrokCandidate[]>([]);
  const [lastMission, setLastMission] = useState<string | null>(null);
  const [upsertCount, setUpsertCount] = useState<number>(0);
  const [rawResponse, setRawResponse] = useState<string | null>(null);

  // Form state
  const [missionName, setMissionName] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [variantAllow, setVariantAllow] = useState('');
  const [yearMin, setYearMin] = useState<number>(2020);
  const [yearMax, setYearMax] = useState<number>(2024);
  const [kmMax, setKmMax] = useState<number>(100000);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [location, setLocation] = useState('Australia');
  const [sellerTypes, setSellerTypes] = useState<string[]>(['dealer', 'private']);
  const [excludeSources, setExcludeSources] = useState<string[]>(['auction']);
  const [allowedDomains, setAllowedDomains] = useState<string>(DEFAULT_DOMAINS.join('\n'));
  const [notes, setNotes] = useState('');

  const handleSellerTypeToggle = (type: string) => {
    setSellerTypes(prev => 
      prev.includes(type) 
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
    // Auto-update excludeSources when toggling auction
    if (type === 'auction') {
      setExcludeSources(prev => 
        prev.includes('auction')
          ? prev.filter(s => s !== 'auction')
          : [...prev, 'auction']
      );
    }
  };

  const handleHunt = async () => {
    if (!make.trim() || !model.trim()) {
      toast({
        title: 'Make and Model required',
        description: 'Please enter both make and model to search',
        variant: 'destructive',
      });
      return;
    }

    const autoMissionName = missionName.trim() || 
      `${make} ${model} ${variantAllow || ''} ${yearMin}-${yearMax}`.trim();

    const mission: Mission = {
      mission_name: autoMissionName,
      make: make.trim(),
      model: model.trim(),
      variant_allow: variantAllow.trim() ? variantAllow.split(',').map(v => v.trim()) : undefined,
      year_min: yearMin,
      year_max: yearMax,
      km_max: kmMax,
      price_max: priceMax,
      location: location.trim() || 'Australia',
      seller_type: sellerTypes.length > 0 ? sellerTypes : undefined,
      exclude_sources: excludeSources.length > 0 ? excludeSources : undefined,
      allowed_domains: allowedDomains.trim() 
        ? allowedDomains.split('\n').map(d => d.trim()).filter(Boolean)
        : undefined,
      notes: notes.trim() || undefined,
    };

    setIsLoading(true);
    setResults([]);
    setRawResponse(null);
    setUpsertCount(0);

    try {
      console.log('[GrokMissionHunter] Sending mission:', mission);
      
      const { data, error } = await supabase.functions.invoke('run-grok-mission', {
        body: mission,
      });

      if (error) {
        throw new Error(error.message);
      }

      const response = data as MissionResponse;

      if (!response.success) {
        toast({
          title: 'Mission failed',
          description: response.error || 'Unknown error',
          variant: 'destructive',
        });
        if (response.rawResponse) {
          setRawResponse(response.rawResponse);
        }
        return;
      }

      setLastMission(response.mission || autoMissionName);
      setUpsertCount(response.upserted || 0);

      if (response.candidates && response.candidates.length > 0) {
        setResults(response.candidates);
        toast({
          title: 'Mission complete!',
          description: `Found ${response.found} candidates, ${response.upserted} queued for review`,
        });
      } else {
        toast({
          title: 'No candidates found',
          description: 'Try broadening your search criteria',
        });
      }
    } catch (err) {
      console.error('[GrokMissionHunter] Error:', err);
      toast({
        title: 'Mission failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getConfidenceBadgeVariant = (confidence: string): "default" | "secondary" | "outline" => {
    switch (confidence) {
      case 'HIGH': return 'default';
      case 'MEDIUM': return 'secondary';
      default: return 'outline';
    }
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
                CaroogleAi Mission Hunter
                <Badge variant="outline" className="text-xs">AI Web Search</Badge>
              </CardTitle>
              <CardDescription>
                AI-powered sourcing with live web search — results queue for Josh to review
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Row 1: Core vehicle info */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="make">Make *</Label>
              <Input
                id="make"
                placeholder="e.g. Toyota"
                value={make}
                onChange={(e) => setMake(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model *</Label>
              <Input
                id="model"
                placeholder="e.g. LandCruiser 300"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="variant">Variants (comma-sep)</Label>
              <Input
                id="variant"
                placeholder="e.g. VX, Sahara"
                value={variantAllow}
                onChange={(e) => setVariantAllow(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="missionName">Mission Name</Label>
              <Input
                id="missionName"
                placeholder="Auto-generated if blank"
                value={missionName}
                onChange={(e) => setMissionName(e.target.value)}
              />
            </div>
          </div>

          {/* Row 2: Criteria */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="kmMax">Max KM</Label>
              <Input
                id="kmMax"
                type="number"
                min={0}
                step={10000}
                value={kmMax}
                onChange={(e) => setKmMax(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="priceMax">Max Price ($)</Label>
              <Input
                id="priceMax"
                type="number"
                min={0}
                step={1000}
                placeholder="No limit"
                value={priceMax ?? ''}
                onChange={(e) => setPriceMax(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                placeholder="Australia"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          {/* Row 3: Seller types */}
          <div className="space-y-2">
            <Label>Seller Types</Label>
            <div className="flex flex-wrap gap-4">
              {SELLER_TYPES.map((type) => (
                <div key={type.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`seller-${type.id}`}
                    checked={sellerTypes.includes(type.id)}
                    onCheckedChange={() => handleSellerTypeToggle(type.id)}
                  />
                  <Label htmlFor={`seller-${type.id}`} className="text-sm font-normal">
                    {type.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Row 4: Domains & Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="domains">Allowed Domains (one per line)</Label>
              <Textarea
                id="domains"
                placeholder="carsales.com.au"
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                rows={3}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes for AI</Label>
              <Textarea
                id="notes"
                placeholder="e.g. Return VIN or stock number if present. No flood damage."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          {/* Submit */}
          <Button
            onClick={handleHunt}
            disabled={isLoading}
            size="lg"
            className="w-full md:w-auto gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                CaroogleAi is searching the web...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Run Mission
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <Card className="border-dashed">
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-medium">CaroogleAi is searching live web sources...</p>
                <p className="text-sm text-muted-foreground">
                  This may take 15-30 seconds for thorough results
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success Summary */}
      {lastMission && upsertCount > 0 && !isLoading && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">Mission "{lastMission}" complete</p>
                <p className="text-sm text-muted-foreground">
                  {upsertCount} candidate(s) added to queue for review
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
              Candidates Found
            </h3>
            <Badge variant="secondary">{results.length} results</Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((candidate, index) => (
              <Card key={index} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Car className="h-5 w-5 text-muted-foreground shrink-0" />
                      <CardTitle className="text-base leading-tight truncate">
                        {candidate.year} {candidate.make} {candidate.model}
                        {candidate.variant && ` ${candidate.variant}`}
                      </CardTitle>
                    </div>
                    <Badge 
                      variant={getConfidenceBadgeVariant(candidate.confidence)} 
                      className="shrink-0"
                    >
                      {candidate.confidence}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Key Stats */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {candidate.km && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">KM:</span>
                        <span className="font-medium">{candidate.km.toLocaleString()}</span>
                      </div>
                    )}
                    {candidate.price && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Price:</span>
                        <span className="font-medium">${candidate.price.toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  {/* Location & Dealer */}
                  {(candidate.location || candidate.dealer_name) && (
                    <div className="text-sm space-y-1">
                      {candidate.dealer_name && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Dealer:</span>
                          <span className="font-medium truncate">{candidate.dealer_name}</span>
                        </div>
                      )}
                      {candidate.location && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{candidate.location}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* VIN/Stock */}
                  {(candidate.vin || candidate.stock_number) && (
                    <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded font-mono">
                      {candidate.vin && <div>VIN: {candidate.vin}</div>}
                      {candidate.stock_number && <div>Stock: {candidate.stock_number}</div>}
                    </div>
                  )}

                  {/* Evidence */}
                  {candidate.evidence_snippet && (
                    <div className="text-sm">
                      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                        <FileText className="h-3.5 w-3.5" />
                        <span>Evidence:</span>
                      </div>
                      <p className="text-xs text-muted-foreground italic line-clamp-2">
                        "{candidate.evidence_snippet}"
                      </p>
                    </div>
                  )}

                  {/* Link */}
                  {candidate.listing_url && (
                    <a
                      href={candidate.listing_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      View Listing
                      <ExternalLink className="h-3 w-3" />
                    </a>
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
              <AlertCircle className="h-4 w-4 text-destructive" />
              Raw Response (Parse Failed)
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
