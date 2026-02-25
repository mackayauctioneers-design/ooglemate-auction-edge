import { useState } from "react";
import { searchOogleBot, searchOogleBotDirect, runOutwardSearch, type OogleBotResponse, type OogleBotResult, type OutwardSearchResponse, type OutwardSearchResult } from "@/lib/api/ooglebot";
import { searchInternalInventory, searchDealerSpecs, parseSearchQuery, type InternalMatch } from "@/lib/api/ooglebot-internal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Database, Globe, MapPin, Gauge, DollarSign, ExternalLink, Radar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

function formatPrice(price: number | null) {
  if (!price) return "—";
  return `$${price.toLocaleString()}`;
}

function formatKm(km: number | null) {
  if (!km) return "—";
  return `${km.toLocaleString()} km`;
}

function InternalResultCard({ match, showUrl }: { match: InternalMatch; showUrl: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-foreground">
            {match.year} {match.make} {match.model}
          </span>
          {match.variant_raw && (
            <span className="text-xs text-muted-foreground">{match.variant_raw}</span>
          )}
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {match.source_class || match.source}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {match.asking_price && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <DollarSign className="h-3 w-3" />
              {formatPrice(match.asking_price)}
            </span>
          )}
          {match.km && (
            <span className="flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              {formatKm(match.km)}
            </span>
          )}
          {(match.location || match.state) && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {match.location || match.state}
            </span>
          )}
          {match.auction_house && (
            <span>{match.auction_house}</span>
          )}
        </div>
      </div>
      {showUrl && match.listing_url && (
        <a href={match.listing_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
          <Button variant="ghost" size="iconSm" className="text-muted-foreground hover:text-primary">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
      )}
    </div>
  );
}

function ScoredResultCard({ result, showUrl }: { result: OogleBotResult; showUrl: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-foreground">
            {result.year} {result.make} {result.model}
          </span>
          {result.variant && (
            <span className="text-xs text-muted-foreground">{result.variant}</span>
          )}
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {result.source_class || result.source}
          </Badge>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            Score: {result.score}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 font-medium text-foreground">
            <DollarSign className="h-3 w-3" />
            {formatPrice(result.price)}
          </span>
          <span className="text-muted-foreground">
            eff: {formatPrice(result.effective_cost)}
          </span>
          {result.km && (
            <span className="flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              {formatKm(result.km)}
            </span>
          )}
          {(result.location || result.state) && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {result.location || result.state}
            </span>
          )}
          {result.auction_house && <span>{result.auction_house}</span>}
          {result.days_listed !== null && (
            <span>{result.days_listed}d listed</span>
          )}
        </div>
        {result.match_reason.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {result.match_reason.map((r, i) => (
              <Badge key={i} variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">
                {r}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {showUrl && result.listing_url && (
        <a href={result.listing_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
          <Button variant="ghost" size="iconSm" className="text-muted-foreground hover:text-primary">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
      )}
    </div>
  );
}

function OutwardResultCard({ result }: { result: OutwardSearchResult }) {
  return (
    <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-foreground">
            {result.title || "Untitled Listing"}
          </span>
          <Badge variant="default" className="text-[10px] px-1.5 py-0">
            {result.source}
          </Badge>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            Score: {result.score}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {result.year && (
            <span className="font-medium text-foreground">{result.year}</span>
          )}
          {result.variant && (
            <span className="text-xs text-muted-foreground">{result.variant}</span>
          )}
          {result.price != null && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <DollarSign className="h-3 w-3" />
              {formatPrice(result.price)}
            </span>
          )}
          {result.km != null && (
            <span className="flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              {formatKm(result.km)}
            </span>
          )}
          {result.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {result.location}
            </span>
          )}
        </div>
      </div>
      <a href={result.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
        <Button variant="ghost" size="iconSm" className="text-muted-foreground hover:text-primary">
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </a>
    </div>
  );
}

export function OogleBotSearch() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [query, setQuery] = useState("");
  const [internalResults, setInternalResults] = useState<InternalMatch[]>([]);
  const [dealerSpecs, setDealerSpecs] = useState<{ id: string; name: string; make: string; model: string; dealer_name: string }[]>([]);
  const [externalResponse, setExternalResponse] = useState<OogleBotResponse | null>(null);
  const [outwardResponse, setOutwardResponse] = useState<OutwardSearchResponse | null>(null);
  const [internalLoading, setInternalLoading] = useState(false);
  const [externalLoading, setExternalLoading] = useState(false);
  const [outwardLoading, setOutwardLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setHasSearched(true);
    setInternalLoading(true);
    setInternalResults([]);
    setDealerSpecs([]);
    setExternalResponse(null);
    setOutwardResponse(null);

    try {
      const [listings, specs] = await Promise.all([
        searchInternalInventory(query),
        searchDealerSpecs(query),
      ]);
      setInternalResults(listings);
      setDealerSpecs(specs);
    } catch (err) {
      console.error("Internal search error:", err);
    } finally {
      setInternalLoading(false);
    }
  };

  const handleExternalSearch = async () => {
    setExternalLoading(true);
    try {
      const response = await searchOogleBot(query);
      setExternalResponse(response);
    } catch (err) {
      console.error("External search error:", err);
      toast({
        title: "External search failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setExternalLoading(false);
    }
  };

  const handleOutwardSearch = async () => {
    setOutwardLoading(true);
    try {
      const response = await runOutwardSearch(query, internalResults.length);
      setOutwardResponse(response);
      if (response.gated) {
        toast({
          title: "Outward search skipped",
          description: response.reason || "Sufficient internal matches available.",
        });
      } else if (response.results?.length === 0) {
        toast({
          title: "No external results",
          description: response.message || "No qualifying vehicles found across external sources.",
        });
      }
    } catch (err) {
      console.error("Outward search error:", err);
      toast({
        title: "Outward search failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setOutwardLoading(false);
    }
  };

  const parsed = query.trim() ? parseSearchQuery(query) : null;

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5 text-primary" />
            OogleBot — Active Hunt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="e.g. 2024 Toyota HiAce Commuter under 40000 km"
              disabled={internalLoading}
            />
            <Button
              onClick={handleSearch}
              disabled={internalLoading || !query.trim()}
            >
              {internalLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </div>

          {parsed?.make && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge variant="secondary">{parsed.make}</Badge>
              {parsed.model && <Badge variant="secondary">{parsed.model}</Badge>}
              {parsed.yearMin && <Badge variant="outline">{parsed.yearMin}{parsed.yearMax ? `–${parsed.yearMax}` : "+"}</Badge>}
              {parsed.kmMax && <Badge variant="outline">≤{parsed.kmMax.toLocaleString()} km</Badge>}
              {parsed.priceMax && <Badge variant="outline">≤${parsed.priceMax.toLocaleString()}</Badge>}
            </div>
          )}

          {!hasSearched && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">Be specific — include badge/variant for better results:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Isuzu D-MAX <strong>SX</strong> 2022 under 50000</li>
                <li>Toyota Landcruiser <strong>GXL</strong> 2024 low km</li>
                <li>Ford Ranger <strong>Wildtrak</strong> 2022-2024 under 65000</li>
                <li>Toyota HiLux <strong>SR5</strong> 2023 under 40000km</li>
                <li>Toyota Prado <strong>GX</strong> 2024 under 80k</li>
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dealer Specs Matches */}
      {dealerSpecs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Search className="h-4 w-4" />
              Matching Dealer Specs ({dealerSpecs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {dealerSpecs.map(spec => (
                <Badge key={spec.id} variant="secondary" className="text-xs">
                  {spec.dealer_name}: {spec.make} {spec.model} — {spec.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Internal Results */}
      {hasSearched && !internalLoading && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4 text-primary" />
              Our Inventory ({internalResults.length} found)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {internalResults.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No matching vehicles in our database.</p>
            ) : (
              <div className="space-y-1.5">
                {internalResults.map(match => (
                  <InternalResultCard key={match.id} match={match} showUrl={isAdmin} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* External Search Button */}
      {hasSearched && !internalLoading && !externalResponse && (
        <Card>
          <CardContent className="py-4">
            <Button
              onClick={handleExternalSearch}
              disabled={externalLoading}
              variant="outline"
              className="w-full"
            >
              {externalLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Globe className="h-4 w-4 mr-2" />
              )}
              AI-Powered Search (NLP → Structured)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* External Structured Results */}
      {externalResponse && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4 text-primary" />
              Scored Results ({externalResponse.count || 0})
            </CardTitle>
            {externalResponse.filters && (
              <div className="flex flex-wrap gap-1.5 text-xs mt-1">
                {externalResponse.filters.make && <Badge variant="secondary">{externalResponse.filters.make}</Badge>}
                {externalResponse.filters.model && <Badge variant="secondary">{externalResponse.filters.model}</Badge>}
                {externalResponse.filters.badge && <Badge variant="default" className="text-[10px]">{externalResponse.filters.badge}</Badge>}
                {externalResponse.filters.year_min && <Badge variant="outline">{externalResponse.filters.year_min}+</Badge>}
                {externalResponse.filters.max_km && <Badge variant="outline">≤{externalResponse.filters.max_km.toLocaleString()} km</Badge>}
                {externalResponse.filters.price_max && <Badge variant="outline">≤${externalResponse.filters.price_max.toLocaleString()}</Badge>}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(externalResponse.results?.length || 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No scored results found.</p>
            ) : (
              externalResponse.results!.map((result, i) => (
                <ScoredResultCard key={result.listing_id || i} result={result} showUrl={isAdmin} />
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ OUTWARD SEARCH ═══ */}
      {hasSearched && !internalLoading && !outwardResponse && (
        <Card className="border-primary/30">
          <CardContent className="py-4">
            <Button
              onClick={handleOutwardSearch}
              disabled={outwardLoading}
              className="w-full"
            >
              {outwardLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Searching 10 domains...
                </>
              ) : (
                <>
                  <Radar className="h-4 w-4 mr-2" />
                  🔍 Outward Search — Scan External Markets
                </>
              )}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              {internalResults.length >= 3
                ? `⚠️ ${internalResults.length} internal matches — outward search will be gated unless urgency is high`
                : `${internalResults.length} internal matches — outward search enabled`}
              {" · "}Pickles · Grays · Manheim · Slattery · Lloyds · Carsales · Autotrader · Drive · Carsguide · EasyAuto
            </p>
          </CardContent>
        </Card>
      )}

      {/* Outward Search Results */}
      {outwardResponse && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Radar className="h-4 w-4 text-primary" />
              External Market Results — Top {outwardResponse.results?.length || 0}
            </CardTitle>
            {outwardResponse.intent && (
              <div className="flex flex-wrap gap-1.5 text-xs mt-1">
                {outwardResponse.intent.make && <Badge variant="secondary">{outwardResponse.intent.make}</Badge>}
                {outwardResponse.intent.model_keywords?.map((k, i) => (
                  <Badge key={i} variant="secondary">{k}</Badge>
                ))}
                {outwardResponse.intent.year && (
                  <Badge variant="outline">{outwardResponse.intent.year}</Badge>
                )}
                {outwardResponse.intent.max_km && <Badge variant="outline">≤{outwardResponse.intent.max_km.toLocaleString()} km</Badge>}
                {outwardResponse.intent.price_max && <Badge variant="outline">≤${outwardResponse.intent.price_max.toLocaleString()}</Badge>}
              </div>
            )}
            <div className="flex gap-3 text-[10px] text-muted-foreground mt-1">
              {outwardResponse.total_searched != null && <span>Scanned: {outwardResponse.total_searched} listings</span>}
              {outwardResponse.duration_ms != null && <span>Time: {(outwardResponse.duration_ms / 1000).toFixed(1)}s</span>}
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(outwardResponse.results?.length || 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No qualifying vehicles found within current filters.
              </p>
            ) : (
              outwardResponse.results!.map((result, i) => (
                <OutwardResultCard key={result.url || i} result={result} />
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
