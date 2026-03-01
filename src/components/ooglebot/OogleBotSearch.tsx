import { useState, useEffect, useRef, useCallback } from "react";
import { searchOogleBot, searchOogleBotDirect, runOutwardSearch, type OogleBotResponse, type OogleBotResult, type OutwardSearchResponse, type OutwardSearchResult } from "@/lib/api/ooglebot";
import { searchInternalInventory, searchDealerSpecs, parseSearchQuery, type InternalMatch } from "@/lib/api/ooglebot-internal";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Database, Globe, MapPin, Gauge, DollarSign, ExternalLink, Radar, Mic, MicOff, Building2 } from "lucide-react";
import { KitingLoader } from "@/components/ui/KitingLoader";
import { useSpeechToText } from "@/hooks/useSpeechToText";
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

interface ManusResult {
  title: string;
  price: number | null;
  price_type: string | null;
  km: number | null;
  year: number | null;
  location: string | null;
  dealer_name: string | null;
  url: string;
  badge: string | null;
  source: string;
  colour: string | null;
  stock_no: string | null;
}

/** For sorting: normalise excl_govt prices by adding estimated on-road cost */
const EGC_ON_ROAD_ESTIMATE = 3500;
function sortablePrice(r: ManusResult): number {
  if (r.price == null) return Infinity;
  if (r.price_type === 'excl_govt') return r.price + EGC_ON_ROAD_ESTIMATE;
  return r.price;
}

function ManusResultCard({ result, isBestPrice }: { result: ManusResult; isBestPrice?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 p-3 rounded-lg border transition-colors ${
      isBestPrice
        ? "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15 ring-1 ring-emerald-500/20"
        : "border-border bg-card hover:bg-muted/30"
    }`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {isBestPrice && (
            <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500 text-white border-emerald-600">
              Best Price
            </Badge>
          )}
          <span className="font-semibold text-sm text-foreground">
            {result.title || "Untitled"}
          </span>
          {result.badge && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {result.badge}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          {result.price != null && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <DollarSign className="h-3 w-3" />
              {formatPrice(result.price)}
              {result.price_type === 'excl_govt' && (
                <span className="text-[10px] text-muted-foreground font-normal">excl. govt charges</span>
              )}
            </span>
          )}
          {result.km != null && (
            <span className="flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              {formatKm(result.km)}
            </span>
          )}
          {result.colour && (
            <span className="text-muted-foreground">{result.colour}</span>
          )}
          {result.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {result.location}
            </span>
          )}
        </div>
        {result.dealer_name && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3" />
            <span>{result.dealer_name}</span>
          </div>
        )}
      </div>
      {result.url && (
        <a href={result.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
          <Button variant="ghost" size="iconSm" className="text-muted-foreground hover:text-primary">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
      )}
    </div>
  );
}
function ManusResultsSection({
  manusTriggered, manusSessionId, manusPolling, manusPending, manusTotal, manusResults,
}: {
  manusTriggered: boolean;
  manusSessionId: string | null;
  manusPolling: boolean;
  manusPending: number;
  manusTotal: number;
  manusResults: ManusResult[];
}) {
  const [showAll, setShowAll] = useState(false);

  // Deduplicate by stock_no (prefer lower price), then sort cheapest first
  const deduped = (() => {
    const map = new Map<string, ManusResult>();
    for (const r of manusResults) {
      const key = r.stock_no || r.url || crypto.randomUUID();
      const existing = map.get(key);
      if (!existing || (r.price != null && (existing.price == null || r.price < existing.price))) {
        map.set(key, r);
      }
    }
    return Array.from(map.values()).sort((a, b) => sortablePrice(a) - sortablePrice(b));
  })();

  const DEFAULT_SHOW = 3;
  const top3 = deduped.slice(0, DEFAULT_SHOW);
  const hasMore = deduped.length > DEFAULT_SHOW;
  const displayed = showAll ? deduped : top3;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Search className="h-4 w-4 text-primary" />
          Market Results
          {manusPending > 0 && (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {manusPending}/{manusTotal} searching...
            </span>
          )}
          {manusPending === 0 && manusTotal > 0 && deduped.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              Top 3 of {deduped.length} results
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {/* Connecting */}
        {manusTriggered && !manusSessionId && !manusPolling && manusResults.length === 0 && (
          <div className="flex flex-col items-center py-4 gap-1">
            <KitingLoader size="md" label="Connecting to search network…" />
          </div>
        )}
        {/* Waiting for results */}
        {manusResults.length === 0 && manusPending > 0 && (
          <div className="flex flex-col items-center py-4 gap-1">
            <KitingLoader size="md" label="Searching the market — results arrive in 2–5 min…" />
          </div>
        )}
        {/* Done, nothing found */}
        {manusTriggered && deduped.length === 0 && manusPending === 0 && manusSessionId && (
          <p className="text-sm text-muted-foreground py-2">
            No matching vehicles found.
          </p>
        )}
        {/* Results */}
        {displayed.map((result, i) => (
          <ManusResultCard key={result.url || i} result={result} isBestPrice={i === 0 && deduped.length > 1} />
        ))}
        {/* Show all toggle */}
        {hasMore && !showAll && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setShowAll(true)}
          >
            Show all {deduped.length} results
          </Button>
        )}
        {showAll && hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setShowAll(false)}
          >
            Show top 3 only
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function VoiceSearchInput({ query, setQuery, onSearch, isLoading }: {
  query: string;
  setQuery: (v: string) => void;
  onSearch: () => void;
  isLoading: boolean;
}) {
  const { isListening, isSupported, toggle } = useSpeechToText({
    onResult: (transcript) => setQuery(transcript),
    lang: "en-AU",
  });

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          placeholder="e.g. 2024 Toyota HiAce Commuter under 40000 km"
          disabled={isLoading}
          className={isListening ? "border-destructive ring-1 ring-destructive/50" : ""}
        />
        {isSupported && (
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            onClick={toggle}
            className={`absolute right-1 top-1/2 -translate-y-1/2 ${isListening ? "text-destructive animate-pulse" : "text-muted-foreground hover:text-foreground"}`}
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}
      </div>
      <Button
        onClick={onSearch}
        disabled={isLoading || !query.trim()}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Search"
        )}
      </Button>
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

  // Manus state
  const [manusSessionId, setManusSessionId] = useState<string | null>(null);
  const [manusResults, setManusResults] = useState<ManusResult[]>([]);
  const [manusPending, setManusPending] = useState(0);
  const [manusTotal, setManusTotal] = useState(0);
  const [manusPolling, setManusPolling] = useState(false);
  const [manusTriggered, setManusTriggered] = useState(false); // true from the moment search fires
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll Manus tasks by session_id
  const pollManusTasks = useCallback(async (sessionId: string) => {
    const { data: tasks } = await supabase
      .from("manus_search_tasks")
      .select("status, results, source_url")
      .eq("search_session_id", sessionId);

    if (!tasks) return;

    const pending = tasks.filter(t => t.status === "pending").length;
    const completed = tasks.filter(t => t.status === "complete");
    const allResults: ManusResult[] = [];

    for (const t of completed) {
      if (t.results && Array.isArray(t.results)) {
        allResults.push(...(t.results as unknown as ManusResult[]));
      }
    }

    setManusPending(pending);
    setManusTotal(tasks.length);
    setManusResults(allResults);

    // Stop polling when all done
    if (pending === 0) {
      setManusPolling(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Start polling when session changes
  useEffect(() => {
    if (!manusSessionId) return;

    setManusPolling(true);
    // Initial poll after 5s (Manus needs time)
    const initialTimeout = setTimeout(() => {
      pollManusTasks(manusSessionId);
      // Then poll every 15s
      pollRef.current = setInterval(() => pollManusTasks(manusSessionId), 15000);
    }, 5000);

    return () => {
      clearTimeout(initialTimeout);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [manusSessionId, pollManusTasks]);

  const triggerManusSearch = async (filters: {
    make: string;
    model?: string;
    badge?: string | null;
    year_min?: number | null;
    year_max?: number | null;
    max_km?: number | null;
    price_max?: number | null;
  }) => {
    try {
      const { data, error } = await supabase.functions.invoke("trigger-manus-search", {
        body: { filters },
      });
      if (error) {
        console.error("Manus trigger error:", error);
        return;
      }

      // Immediately display tier-1 instant results (auction DB, Drive, Toyota)
      if (data?.instant_results && Array.isArray(data.instant_results) && data.instant_results.length > 0) {
        setManusResults(prev => [...prev, ...data.instant_results]);
      }

      if (data?.session_id && data?.tasks_created > 0) {
        setManusSessionId(data.session_id);
        setManusTotal(data.tasks_created);
        setManusPending(data.tasks_created);
        toast({
          title: `Searching ${data.tasks_created} dealer sites`,
          description: "Results will arrive in 2–5 minutes.",
        });
      } else if (data?.instant_results?.length > 0) {
        // No Manus tasks dispatched but we have instant results — mark as done
        setManusTotal(0);
        setManusPending(0);
      }
    } catch (err) {
      console.error("Manus trigger failed:", err);
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;

    setHasSearched(true);
    setInternalLoading(true);
    setManusTriggered(true); // show dealer sites card immediately
    setInternalResults([]);
    setDealerSpecs([]);
    setExternalResponse(null);
    setOutwardResponse(null);
    setManusSessionId(null);
    setManusResults([]);
    setManusPending(0);
    setManusTotal(0);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    try {
      // Run internal search + AI intent parse in parallel
      const [listingsResult, specsResult, oogleBotResult] = await Promise.allSettled([
        searchInternalInventory(query),
        searchDealerSpecs(query),
        searchOogleBot(query),
      ]);

      const listings = listingsResult.status === "fulfilled" ? listingsResult.value : [];
      const specs = specsResult.status === "fulfilled" ? specsResult.value : [];
      setInternalResults(listings);
      setDealerSpecs(specs);

      if (oogleBotResult.status === "fulfilled") {
        setExternalResponse(oogleBotResult.value);
      }

      // Trigger Manus dealer search — always fires regardless of OogleBot success.
      // Prefer structured filters from OogleBot NLP; fall back to regex parser.
      const oogFilters =
        oogleBotResult.status === "fulfilled" ? oogleBotResult.value.filters : null;
      const fallback = parseSearchQuery(query);
      const manusFilters = {
        make: oogFilters?.make || fallback.make || "",
        model: oogFilters?.model || fallback.model || undefined,
        badge: oogFilters?.badge ?? null,
        year_min: oogFilters?.year_min ?? fallback.yearMin,
        year_max: oogFilters?.year_max ?? fallback.yearMax,
        max_km: oogFilters?.max_km ?? fallback.kmMax,
        price_max: oogFilters?.price_max ?? fallback.priceMax,
      };
      if (manusFilters.make) {
        triggerManusSearch(manusFilters);
      }

      // Always auto-fire CaroogleAI — no button press needed.
      // Pass internal count + parsed filters so badge/model constraints stay strict.
      triggerOutwardSearch(query, listings.length, manusFilters);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setInternalLoading(false);
    }
  };

  const triggerOutwardSearch = async (
    searchQuery: string,
    internalCount: number,
    filters?: {
      make?: string | null;
      model?: string | null;
      badge?: string | null;
      year_min?: number | null;
      year_max?: number | null;
      max_km?: number | null;
      price_max?: number | null;
    },
  ) => {
    setOutwardLoading(true);
    try {
      const response = await runOutwardSearch(searchQuery, internalCount, "normal", filters);
      setOutwardResponse(response);
      if (response.gated) {
        toast({
          title: "CaroogleAI skipped",
          description: response.reason || "Sufficient internal matches available.",
        });
      } else if (response.results?.length === 0) {
        toast({
          title: "No external results",
          description: response.message || "No qualifying vehicles found across external sources.",
        });
      }
    } catch (err) {
      console.error("CaroogleAI search error:", err);
      toast({
        title: "CaroogleAI search failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setOutwardLoading(false);
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
    triggerOutwardSearch(query, internalResults.length);
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
          <VoiceSearchInput
            query={query}
            setQuery={setQuery}
            onSearch={handleSearch}
            isLoading={internalLoading}
          />

          {parsed?.make && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge variant="secondary">{parsed.make}</Badge>
              {parsed.model && <Badge variant="secondary">{parsed.model}</Badge>}
              {parsed.yearMin && <Badge variant="outline">{parsed.yearMin}{parsed.yearMax ? `–${parsed.yearMax}` : "+"}</Badge>}
              {parsed.kmMax && <Badge variant="outline">≤{parsed.kmMax.toLocaleString()} km</Badge>}
              {parsed.priceMax && <Badge variant="outline">≤${parsed.priceMax.toLocaleString()}</Badge>}
            </div>
          )}

          {/* Manus Activity Banner */}
          {manusPolling && manusPending > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 animate-pulse">
              <div className="relative flex h-3 w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  CaroogleAI searching {manusPending} dealer site{manusPending > 1 ? "s" : ""}…
                </p>
                <p className="text-[11px] text-amber-600/70 dark:text-amber-500/70">
                  {manusTotal - manusPending}/{manusTotal} complete · Results arrive in 2–5 min
                </p>
              </div>
              <Loader2 className="h-4 w-4 animate-spin text-amber-600 shrink-0" />
            </div>
          )}

          {/* Manus Complete Banner */}
          {!manusPolling && manusTotal > 0 && hasSearched && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shrink-0"></span>
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                CaroogleAI complete — {manusResults.length} vehicle{manusResults.length !== 1 ? "s" : ""} found from {manusTotal} dealer site{manusTotal > 1 ? "s" : ""}
              </p>
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

      {/* External Structured Results (auto-triggered) */}
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

      {/* ═══ MARKET RESULTS — TOP 3 CHEAPEST ═══ */}
      {(manusTriggered || manusPolling || manusResults.length > 0) && (
        <ManusResultsSection
          manusTriggered={manusTriggered}
          manusSessionId={manusSessionId}
          manusPolling={manusPolling}
          manusPending={manusPending}
          manusTotal={manusTotal}
          manusResults={manusResults}
        />
      )}

      {/* CaroogleAI loading indicator — auto-fires, no button needed */}
      {hasSearched && outwardLoading && !outwardResponse && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Scanning auctions, classifieds &amp; dealer stock…</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CaroogleAI Results */}
      {outwardResponse && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Radar className="h-4 w-4 text-primary" />
              CaroogleAI Results — Top {outwardResponse.results?.length || 0}
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
              [...outwardResponse.results!]
                .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
                .map((result, i) => (
                  <OutwardResultCard key={result.url || i} result={result} />
                ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
