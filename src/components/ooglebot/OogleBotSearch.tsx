import { useState } from "react";
import { searchOogleBot } from "@/lib/api/ooglebot";
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
import { Loader2, Search, Database, Globe, MapPin, Calendar, Gauge, DollarSign, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
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

export function OogleBotSearch() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [query, setQuery] = useState("");
  const [internalResults, setInternalResults] = useState<InternalMatch[]>([]);
  const [dealerSpecs, setDealerSpecs] = useState<{ id: string; name: string; make: string; model: string; dealer_name: string }[]>([]);
  const [externalResults, setExternalResults] = useState<string>("");
  const [internalLoading, setInternalLoading] = useState(false);
  const [externalLoading, setExternalLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setHasSearched(true);
    setInternalLoading(true);
    setInternalResults([]);
    setDealerSpecs([]);
    setExternalResults("");

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
      const reply = await searchOogleBot(query);
      setExternalResults(reply);
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
              placeholder="e.g. Isuzu D-MAX 2024 under 55000"
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

          {/* Parsed query feedback */}
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
              <p className="font-medium">Example searches:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Isuzu D-MAX 2024 under 55000</li>
                <li>Toyota HiAce Commuter 2024 under 80k</li>
                <li>Prado GX 2024 under 20000km</li>
                <li>Ford Ranger Wildtrak 2022 low km</li>
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
      {hasSearched && !internalLoading && !externalResults && (
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
              Search External Marketplaces
            </Button>
          </CardContent>
        </Card>
      )}

      {/* External Results */}
      {externalResults && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4 text-primary" />
              External Results
            </CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{externalResults}</ReactMarkdown>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
