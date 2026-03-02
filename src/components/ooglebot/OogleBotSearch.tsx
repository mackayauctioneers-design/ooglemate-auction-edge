import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { searchOogleBot, searchOogleBotDirect, type OogleBotResponse, type OogleBotResult } from "@/lib/api/ooglebot";
import { searchTiered, searchDealerSpecs, parseSearchQuery, type InternalMatch, type TieredSearchResult } from "@/lib/api/ooglebot-internal";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2, Search, Database, Globe, MapPin, Gauge, DollarSign,
  ExternalLink, Mic, MicOff, Building2, ChevronDown, X,
} from "lucide-react";
import { KitingLoader } from "@/components/ui/KitingLoader";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

// ── Constants ──

const COMMON_MAKES = [
  'Toyota', 'Ford', 'Mazda', 'Hyundai', 'Kia', 'Nissan', 'Mitsubishi',
  'Isuzu', 'Subaru', 'Volkswagen', 'Land Rover', 'Holden', 'Honda',
  'BMW', 'Mercedes-Benz', 'Audi', 'Lexus', 'Jeep', 'RAM', 'Suzuki',
  'Volvo', 'Porsche', 'LDV', 'GWM', 'BYD', 'MG', 'Peugeot', 'Skoda',
];

const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const ACCESSORY_PRESETS = [
  'Bullbar', 'Towbar', 'Canopy', 'ARB', 'Norweld Tray',
  'Snorkel', 'Lift Kit', 'Roof Racks', 'Side Steps', 'Winch',
];

// ── Formatters ──

function formatPrice(price: number | null) {
  if (!price) return "—";
  return `$${price.toLocaleString()}`;
}

function formatKm(km: number | null) {
  if (!km) return "—";
  return `${km.toLocaleString()} km`;
}

// ── Result Cards (unchanged) ──

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

function ScoredResultCard({ result, showUrl, isOperator }: { result: OogleBotResult; showUrl: boolean; isOperator?: boolean }) {
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
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1 font-medium text-foreground">
            <DollarSign className="h-3 w-3" />
            {formatPrice(result.price)}
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
          {result.days_listed !== null && (
            <span>{result.days_listed}d listed</span>
          )}
        </div>
        {isOperator && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {result.source_class || result.source}
            </Badge>
            <span>Score: {result.score}</span>
            {result.effective_cost && <span>eff: {formatPrice(result.effective_cost)}</span>}
            {result.auction_house && <span>{result.auction_house}</span>}
          </div>
        )}
        {isOperator && result.match_reason.length > 0 && (
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

// ── Manus types + section ──

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

const REASSURANCE_MESSAGES = [
  "Searching dealer inventory sites…",
  "Checking stock listings…",
  "Scanning dealer catalogues…",
  "Checking EasyAuto123…",
  "Searching CarsGuide…",
  "Scanning Tony White Group…",
  "Cross-checking dealer stock…",
  "Almost done — finalising results…",
];

const MANUS_TIMEOUT_MS = 5 * 60 * 1000;

function ManusResultsSection({
  manusTriggered, manusSessionId, manusPolling, manusPending, manusTotal, manusResults, manusTimedOut,
}: {
  manusTriggered: boolean;
  manusSessionId: string | null;
  manusPolling: boolean;
  manusPending: number;
  manusTotal: number;
  manusResults: ManusResult[];
  manusTimedOut: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (manusPending === 0) return;
    const interval = setInterval(() => {
      setMsgIndex(i => (i + 1) % REASSURANCE_MESSAGES.length);
    }, 30_000);
    return () => clearInterval(interval);
  }, [manusPending]);

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
  const completedCount = manusTotal - manusPending;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Search className="h-4 w-4 text-primary" />
          Market Results
          {manusPending > 0 && !manusTimedOut && (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {completedCount}/{manusTotal} complete
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
        {manusTriggered && !manusSessionId && !manusPolling && manusResults.length === 0 && !manusTimedOut && (
          <div className="flex flex-col items-center py-4 gap-1">
            <KitingLoader size="md" label="Connecting to search network…" />
          </div>
        )}
        {manusResults.length === 0 && manusPending > 0 && !manusTimedOut && (
          <div className="flex flex-col items-center py-4 gap-2">
            <KitingLoader size="md" />
            <div className="w-full max-w-xs space-y-1">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${manusTotal > 0 ? Math.max(5, (completedCount / manusTotal) * 100) : 5}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center animate-pulse">
                {REASSURANCE_MESSAGES[msgIndex]}
              </p>
            </div>
          </div>
        )}
        {manusResults.length > 0 && manusPending > 0 && !manusTimedOut && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
            <p className="text-xs text-muted-foreground">
              {completedCount}/{manusTotal} sites searched · {deduped.length} result{deduped.length !== 1 ? "s" : ""} so far
            </p>
          </div>
        )}
        {manusTimedOut && deduped.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">
            Search complete — no matching vehicles found at this time. Try broadening your search criteria.
          </p>
        )}
        {!manusTimedOut && manusTriggered && deduped.length === 0 && manusPending === 0 && manusSessionId && (
          <p className="text-sm text-muted-foreground py-2">
            No matching vehicles found.
          </p>
        )}
        {displayed.map((result, i) => (
          <ManusResultCard key={result.url || i} result={result} isBestPrice={i === 0 && deduped.length > 1} />
        ))}
        {hasMore && !showAll && (
          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setShowAll(true)}>
            Show all {deduped.length} results
          </Button>
        )}
        {showAll && hasMore && (
          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setShowAll(false)}>
            Show top 3 only
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN: OogleBotSearch — Structured-First Search
// ══════════════════════════════════════════════════════════════════════════════

export function OogleBotSearch() {
  const { toast } = useToast();
  const { isAdmin, dealerProfile } = useAuth();

  // ── Structured identity fields ──
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [makeSearch, setMakeSearch] = useState("");
  const [makeOpen, setMakeOpen] = useState(false);
  const [badge, setBadge] = useState("");
  const [yearMin, setYearMin] = useState("");
  const [yearMax, setYearMax] = useState("");
  const [kmMax, setKmMax] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);
  const [customAccessory, setCustomAccessory] = useState("");
  const [fullMarketScan, setFullMarketScan] = useState(false);

  // ── Quick search (secondary) ──
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  // ── Model suggestions from taxonomy ──
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (!make) { setModelSuggestions([]); return; }
    const fetchModels = async () => {
      const { data } = await supabase
        .from("taxonomy_models")
        .select("canonical_model")
        .eq("make", make.trim())
        .order("canonical_model");
      if (data) setModelSuggestions([...new Set(data.map(d => d.canonical_model).filter(Boolean))]);
    };
    fetchModels();
  }, [make]);

  const filteredMakes = useMemo(() => {
    if (!makeSearch) return COMMON_MAKES;
    const q = makeSearch.toLowerCase();
    return COMMON_MAKES.filter(m => m.toLowerCase().includes(q));
  }, [makeSearch]);

  // ── Voice ──
  const { isListening, isSupported, toggle: toggleVoice } = useSpeechToText({
    onResult: (transcript) => setQuery(transcript),
    lang: "en-AU",
  });

  // ── Results state ──
  const [internalResults, setInternalResults] = useState<InternalMatch[]>([]);
  const [dealerSpecs, setDealerSpecs] = useState<{ id: string; name: string; make: string; model: string; dealer_name: string }[]>([]);
  const [externalResponse, setExternalResponse] = useState<OogleBotResponse | null>(null);
  const [internalLoading, setInternalLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // ── Manus state ──
  const [manusSessionId, setManusSessionId] = useState<string | null>(null);
  const [manusResults, setManusResults] = useState<ManusResult[]>([]);
  const [manusPending, setManusPending] = useState(0);
  const [manusTotal, setManusTotal] = useState(0);
  const [manusPolling, setManusPolling] = useState(false);
  const [manusTriggered, setManusTriggered] = useState(false);
  const [manusTimedOut, setManusTimedOut] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Accessory helpers ──
  const toggleAccessory = (acc: string) => {
    setSelectedAccessories(prev =>
      prev.includes(acc) ? prev.filter(a => a !== acc) : [...prev, acc]
    );
  };
  const addCustomAccessory = () => {
    const trimmed = customAccessory.trim();
    if (trimmed && !selectedAccessories.includes(trimmed)) {
      setSelectedAccessories(prev => [...prev, trimmed]);
      setCustomAccessory("");
    }
  };

  // ── Validation ──
  const authReady = !!(dealerProfile?.account_id);
  const canSearch = make.trim().length > 0 && model.trim().length > 0;
  const badgeMissing = canSearch && !badge.trim();

  // ── Manus polling (unchanged logic) ──
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
    if (pending === 0) {
      setManusPolling(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!manusSessionId) return;
    setManusPolling(true);
    setManusTimedOut(false);
    const initialTimeout = setTimeout(() => {
      pollManusTasks(manusSessionId);
      pollRef.current = setInterval(() => pollManusTasks(manusSessionId), 8000);
    }, 3000);
    const channel = supabase
      .channel(`manus-tasks-${manusSessionId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "manus_search_tasks",
        filter: `search_session_id=eq.${manusSessionId}`,
      }, () => pollManusTasks(manusSessionId))
      .subscribe();
    timeoutRef.current = setTimeout(() => {
      setManusTimedOut(true); setManusPolling(false); setManusPending(0);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }, MANUS_TIMEOUT_MS);
    return () => {
      clearTimeout(initialTimeout);
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [manusSessionId, pollManusTasks]);

  const triggerManusSearch = async (filters: {
    make: string; model?: string; badge?: string | null;
    year_min?: number | null; year_max?: number | null;
    max_km?: number | null; price_max?: number | null;
  }) => {
    try {
      const { data, error } = await supabase.functions.invoke("trigger-manus-search", {
        body: { filters },
      });
      if (error) { console.error("Manus trigger error:", error); return; }
      if (data?.instant_results && Array.isArray(data.instant_results) && data.instant_results.length > 0) {
        setManusResults(prev => [...prev, ...data.instant_results]);
      }
      if (data?.session_id && data?.tasks_created > 0) {
        setManusSessionId(data.session_id);
        setManusTotal(data.tasks_created);
        setManusPending(data.tasks_created);
        toast({ title: `Searching ${data.tasks_created} dealer sites`, description: "Results will arrive in 2–5 minutes." });
      } else if (data?.instant_results?.length > 0) {
        setManusTotal(0); setManusPending(0);
      }
    } catch (err) { console.error("Manus trigger failed:", err); }
  };

  // ── Main search handler ──
  const handleSearch = async () => {
    if (!canSearch) return;

    // Build structured filters from form
    const structuredFilters = {
      make: make.trim(),
      model: model.trim(),
      badge: badge.trim() || null,
      year_min: yearMin ? parseInt(yearMin, 10) : null,
      year_max: yearMax ? parseInt(yearMax, 10) : null,
      max_km: kmMax ? parseInt(kmMax.replace(/,/g, ""), 10) : null,
      price_max: priceMax ? parseInt(priceMax.replace(/,/g, ""), 10) : null,
      state: stateFilter || null,
      accessory_terms: selectedAccessories.map(a => a.toUpperCase()),
      prefer_terms: selectedAccessories.map(a => a.toUpperCase()),
    };

    // Build instruction text from structured fields (for backend compatibility)
    const instructionParts = [structuredFilters.make, structuredFilters.model];
    if (structuredFilters.badge) instructionParts.push(structuredFilters.badge);
    if (structuredFilters.year_min) instructionParts.push(`${structuredFilters.year_min}`);
    if (structuredFilters.max_km) instructionParts.push(`under ${structuredFilters.max_km}km`);
    if (structuredFilters.price_max) instructionParts.push(`under $${structuredFilters.price_max}`);
    const instruction = query.trim() || instructionParts.join(" ");

    setHasSearched(true);
    setInternalLoading(true);
    setManusTriggered(true);
    setManusTimedOut(false);
    setInternalResults([]);
    setDealerSpecs([]);
    setExternalResponse(null);
    setManusSessionId(null);
    setManusResults([]);
    setManusPending(0);
    setManusTotal(0);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    try {
      // Run tiered search with structured filters (no LLM dependency)
      // Build structured intent for tiered search (bypasses text parsing)
      const structuredIntent = {
        make: structuredFilters.make,
        model: structuredFilters.model,
        yearMin: structuredFilters.year_min,
        yearMax: structuredFilters.year_max,
        kmMax: structuredFilters.max_km,
        priceMax: structuredFilters.price_max,
      };

      const [tieredResult, specsResult, directResult] = await Promise.allSettled([
        searchTiered(instruction, structuredIntent),
        searchDealerSpecs(instruction),
        searchOogleBotDirect(structuredFilters),
      ]);

      const tiered: TieredSearchResult | null = tieredResult.status === "fulfilled" ? tieredResult.value : null;
      const listings = tiered ? [...tiered.tier0_auctions, ...tiered.tier1_internal] : [];
      const specs = specsResult.status === "fulfilled" ? specsResult.value : [];
      setInternalResults(listings);
      setDealerSpecs(specs);

      if (tiered) {
        console.log(`[Search] Tier 0: ${tiered.tier0_auctions.length} | Tier 1: ${tiered.tier1_internal.length} | Outward: ${tiered.outward_allowed ? "ALLOWED" : "BLOCKED"} (${tiered.outward_reason}) | ${tiered.duration_ms}ms`);
      }

      if (directResult.status === "fulfilled") {
        setExternalResponse(directResult.value);
      }

      // Outward gate
      const outwardAllowed = tiered?.outward_allowed ?? true;
      if (outwardAllowed || fullMarketScan) {
        const manusFilters = {
          make: structuredFilters.make,
          model: structuredFilters.model,
          badge: structuredFilters.badge,
          year_min: structuredFilters.year_min,
          year_max: structuredFilters.year_max,
          max_km: structuredFilters.max_km,
          price_max: structuredFilters.price_max,
        };
        triggerManusSearch(manusFilters);
      } else {
        console.log(`[Search] Outward search BLOCKED: ${tiered?.outward_reason}`);
      }
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setInternalLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ═══ STRUCTURED SEARCH FORM ═══ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5 text-primary" />
            Vehicle Search
          </CardTitle>
          <p className="text-xs text-muted-foreground">Structured search for accurate results</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Row 1: Make + Model */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Make */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Make <span className="text-destructive">*</span></Label>
              <Popover open={makeOpen} onOpenChange={setMakeOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-10">
                    {make || "Select make…"}
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search make…" value={makeSearch} onValueChange={setMakeSearch} />
                    <CommandList>
                      <CommandEmpty>
                        {makeSearch.trim() ? (
                          <button
                            className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded cursor-pointer"
                            onClick={() => { setMake(makeSearch.trim()); setModel(""); setMakeOpen(false); setMakeSearch(""); }}
                          >
                            Use "{makeSearch.trim()}"
                          </button>
                        ) : "No makes found."}
                      </CommandEmpty>
                      <CommandGroup>
                        {filteredMakes.map(m => (
                          <CommandItem key={m} value={m} onSelect={() => { setMake(m); setModel(""); setMakeOpen(false); setMakeSearch(""); }}>
                            {m}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Model <span className="text-destructive">*</span></Label>
              <Input
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder={make ? "Type or select model…" : "Select make first"}
                disabled={!make}
                list="ooglebot-model-suggestions"
              />
              <datalist id="ooglebot-model-suggestions">
                {modelSuggestions.map(m => <option key={m} value={m} />)}
              </datalist>
            </div>
          </div>

          {/* Row 2: Badge */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Variant / Badge</Label>
            <Input
              value={badge}
              onChange={e => setBadge(e.target.value)}
              placeholder="e.g. SR5, GXL, Wildtrak"
            />
            <p className="text-[10px] text-muted-foreground">
              {badgeMissing ? (
                <span className="text-amber-500">Badge not provided — matching will be broader.</span>
              ) : (
                "Improves matching accuracy (recommended)"
              )}
            </p>
          </div>

          {/* Row 3: Year / KM / Price / State */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Year min</Label>
              <Input type="number" value={yearMin} onChange={e => setYearMin(e.target.value)} placeholder="2018" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Year max</Label>
              <Input type="number" value={yearMax} onChange={e => setYearMax(e.target.value)} placeholder="2024" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">KM max</Label>
              <Input type="number" value={kmMax} onChange={e => setKmMax(e.target.value)} placeholder="80000" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Price max</Label>
              <Input type="number" value={priceMax} onChange={e => setPriceMax(e.target.value)} placeholder="65000" />
            </div>
          </div>

          {/* State */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">State</Label>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Any state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                {AU_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Accessories / Features */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Accessories / Features</Label>
            <div className="flex flex-wrap gap-1.5">
              {ACCESSORY_PRESETS.map(acc => (
                <Badge
                  key={acc}
                  variant={selectedAccessories.includes(acc) ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => toggleAccessory(acc)}
                >
                  {acc}
                  {selectedAccessories.includes(acc) && <X className="ml-1 h-3 w-3" />}
                </Badge>
              ))}
            </div>
            <div className="flex gap-2 mt-1">
              <Input
                value={customAccessory}
                onChange={e => setCustomAccessory(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addCustomAccessory()}
                placeholder="Add custom feature…"
                className="h-8 text-xs"
              />
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={addCustomAccessory} disabled={!customAccessory.trim()}>
                Add
              </Button>
            </div>
            {/* Custom accessories shown */}
            {selectedAccessories.filter(a => !ACCESSORY_PRESETS.includes(a)).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedAccessories.filter(a => !ACCESSORY_PRESETS.includes(a)).map(acc => (
                  <Badge key={acc} variant="default" className="cursor-pointer text-xs" onClick={() => toggleAccessory(acc)}>
                    {acc} <X className="ml-1 h-3 w-3" />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* CaroogleAI Full Market Scan toggle — enterprise only */}
          {dealerProfile?.account_id && (
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div>
                <p className="text-sm font-medium">CaroogleAI Full Market Scan</p>
                <p className="text-[10px] text-muted-foreground">Search all external dealer sites and marketplaces</p>
              </div>
              <Switch checked={fullMarketScan} onCheckedChange={setFullMarketScan} />
            </div>
          )}

          {/* Quick Search (collapsed secondary) */}
          <Collapsible open={quickSearchOpen} onOpenChange={setQuickSearchOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground gap-1">
                <ChevronDown className={`h-3 w-3 transition-transform ${quickSearchOpen ? "rotate-180" : ""}`} />
                Quick Search (optional free-text)
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSearch()}
                    placeholder="e.g. 2024 Toyota HiAce under 40000km"
                    className={isListening ? "border-destructive ring-1 ring-destructive/50" : ""}
                  />
                  {isSupported && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      onClick={toggleVoice}
                      className={`absolute right-1 top-1/2 -translate-y-1/2 ${isListening ? "text-destructive animate-pulse" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Structured fields above override free-text parsing when filled.</p>
            </CollapsibleContent>
          </Collapsible>

          {/* Search button */}
          <Button
            onClick={handleSearch}
            disabled={internalLoading || !canSearch || !authReady}
            className="w-full gap-2"
            size="lg"
            title={!authReady ? "Loading dealer profile…" : !canSearch ? "Make and Model are required" : undefined}
          >
            {internalLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Searching…</>
            ) : (
              <><Search className="h-4 w-4" /> Search</>
            )}
          </Button>

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
        </CardContent>
      </Card>

      {/* ═══ DEALER SPECS MATCHES ═══ */}
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

      {/* ═══ INTERNAL RESULTS ═══ */}
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

      {/* ═══ SCORED RESULTS ═══ */}
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
                <ScoredResultCard key={result.listing_id || i} result={result} showUrl={isAdmin} isOperator={isAdmin} />
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ MARKET RESULTS ═══ */}
      {(manusTriggered || manusPolling || manusResults.length > 0) && (
        <ManusResultsSection
          manusTriggered={manusTriggered}
          manusSessionId={manusSessionId}
          manusPolling={manusPolling}
          manusPending={manusPending}
          manusTotal={manusTotal}
          manusResults={manusResults}
          manusTimedOut={manusTimedOut}
        />
      )}
    </div>
  );
}
