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

// ── Result Cards ──

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
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {match.auction_house}
            </span>
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

// ── Outward Result types + section ──

interface OutwardResult {
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
function sortablePrice(r: OutwardResult): number {
  if (r.price == null) return Infinity;
  if (r.price_type === 'excl_govt') return r.price + EGC_ON_ROAD_ESTIMATE;
  return r.price;
}

function OutwardResultCard({ result, isBestPrice }: { result: OutwardResult; isBestPrice?: boolean }) {
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {result.dealer_name && (
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {result.dealer_name}
            </span>
          )}
          {result.source && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {result.source}
            </Badge>
          )}
        </div>
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

const OUTWARD_TIMEOUT_MS = 5 * 60 * 1000;

/** Terminal statuses for outward_jobs */
const TERMINAL_STATUSES = new Set(["complete", "failed", "timeout"]);

function OutwardResultsSection({
  outwardTriggered, searchRunId, outwardPolling, outwardPending, outwardTotal, outwardResults, outwardTimedOut, phase1Count,
}: {
  outwardTriggered: boolean;
  searchRunId: string | null;
  outwardPolling: boolean;
  outwardPending: number;
  outwardTotal: number;
  outwardResults: OutwardResult[];
  outwardTimedOut: boolean;
  phase1Count: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (outwardPending === 0) return;
    const interval = setInterval(() => {
      setMsgIndex(i => (i + 1) % REASSURANCE_MESSAGES.length);
    }, 30_000);
    return () => clearInterval(interval);
  }, [outwardPending]);

  // Deduplicate by listing URL (primary key), keeping lowest price
  const deduped = (() => {
    const map = new Map<string, OutwardResult>();
    for (const r of outwardResults) {
      const key = r.url || r.stock_no || `${r.title}|${r.year ?? ""}|${r.km ?? ""}|${r.location ?? ""}`;
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
  const completedCount = outwardTotal - outwardPending;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Search className="h-4 w-4 text-primary" />
          Market Results
          {outwardPending > 0 && !outwardTimedOut && (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {completedCount}/{outwardTotal} complete
            </span>
          )}
          {outwardPending === 0 && outwardTotal > 0 && deduped.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              Top 3 of {deduped.length} results
            </span>
          )}
        </CardTitle>
        {/* Phase 1 indicator */}
        {phase1Count > 0 && outwardPending > 0 && (
          <p className="text-[10px] text-muted-foreground">
            ✓ {phase1Count} internal results ready · Extended search in progress…
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-1.5">
        {outwardTriggered && !searchRunId && !outwardPolling && outwardResults.length === 0 && !outwardTimedOut && (
          <div className="flex flex-col items-center py-4 gap-1">
            <KitingLoader size="md" label="Connecting to search network…" />
          </div>
        )}
        {outwardResults.length === 0 && outwardPending > 0 && !outwardTimedOut && (
          <div className="flex flex-col items-center py-4 gap-2">
            <KitingLoader size="md" />
            <div className="w-full max-w-xs space-y-1">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${outwardTotal > 0 ? Math.max(5, (completedCount / outwardTotal) * 100) : 5}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center animate-pulse">
                {REASSURANCE_MESSAGES[msgIndex]}
              </p>
            </div>
          </div>
        )}
        {outwardResults.length > 0 && outwardPending > 0 && !outwardTimedOut && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
            <p className="text-xs text-muted-foreground">
              {completedCount}/{outwardTotal} sites searched · {deduped.length} result{deduped.length !== 1 ? "s" : ""} so far
            </p>
          </div>
        )}
        {outwardTimedOut && deduped.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">
            Search complete — no matching vehicles found at this time. Try broadening your search criteria.
          </p>
        )}
        {!outwardTimedOut && outwardTriggered && deduped.length === 0 && outwardPending === 0 && searchRunId && (
          <p className="text-sm text-muted-foreground py-2">
            No matching vehicles found.
          </p>
        )}
        {displayed.map((result, i) => (
          <OutwardResultCard key={result.url || i} result={result} isBestPrice={i === 0 && deduped.length > 1} />
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

  // ── Outward search state (Phase 2) ──
  const [searchRunId, setSearchRunId] = useState<string | null>(null);
  const [outwardResults, setOutwardResults] = useState<OutwardResult[]>([]);
  const [outwardPending, setOutwardPending] = useState(0);
  const [outwardTotal, setOutwardTotal] = useState(0);
  const [outwardPolling, setOutwardPolling] = useState(false);
  const [outwardTriggered, setOutwardTriggered] = useState(false);
  const [outwardTimedOut, setOutwardTimedOut] = useState(false);
  const [phase1Count, setPhase1Count] = useState(0);
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

  // ── Outward polling (poll outward_jobs + outward_search_results by search_run_id) ──
  // FIX #1: Correct column names (source_key not source) and terminal statuses
  // FIX #2: job_id in outward_search_results references outward_jobs.id (confirmed)
  // FIX #3: MERGE results instead of overwrite — dedupe by listing_url
  // Track which job IDs we've already fetched results for — prevents duplicate queries
  const seenJobIdsRef = useRef<Set<string>>(new Set());

  const pollOutwardJobs = useCallback(async (runId: string) => {
    const { data: jobs } = await supabase
      .from("outward_jobs")
      .select("id, status, source_key, result_count")
      .eq("search_run_id", runId);
    if (!jobs) return;

    const pending = jobs.filter(j => !TERMINAL_STATUSES.has(j.status)).length;

    // Fetch results for jobs that have results OR are terminal — but only NEW ones
    const fetchable = jobs.filter(j =>
      !seenJobIdsRef.current.has(j.id) &&
      ((j.result_count ?? 0) > 0 || TERMINAL_STATUSES.has(j.status))
    );

    if (fetchable.length > 0) {
      const newJobIds = fetchable.map(j => j.id);
      const { data: results, error: fetchErr } = await supabase
        .from("outward_search_results")
        .select("title, price_aud, odometer_km, year, state, listing_url, make_norm, model_norm, variant_family, source_key")
        .in("job_id", newJobIds);

      // Only mark as seen if fetch succeeded — allows retry on transient failures
      if (!fetchErr) {
        newJobIds.forEach(id => seenJobIdsRef.current.add(id));
      }

      if (results && results.length > 0) {
        const newResults: OutwardResult[] = results.map(r => ({
          title: r.title || `${r.year || ""} ${r.make_norm || ""} ${r.model_norm || ""}`.trim(),
          price: r.price_aud ? Number(r.price_aud) : null,
          price_type: null,
          km: r.odometer_km ? Number(r.odometer_km) : null,
          year: r.year,
          location: r.state,
          dealer_name: null,
          url: r.listing_url,
          badge: r.variant_family || null,
          source: r.source_key || "lindy",
          colour: null,
          stock_no: null,
        }));

        // Merge with existing results — deduplicate by URL, keep lowest price
        setOutwardResults(prev => {
          const merged = [...prev, ...newResults];
          const urlMap = new Map<string, OutwardResult>();
          for (const r of merged) {
            const key = r.url || `${r.title}|${r.year ?? ""}|${r.km ?? ""}|${r.location ?? ""}`;
            const existing = urlMap.get(key);
            if (!existing || (r.price != null && (existing.price == null || r.price < existing.price))) {
              urlMap.set(key, r);
            }
          }
          return Array.from(urlMap.values());
        });
      }
    }

    setOutwardPending(pending);
    setOutwardTotal(jobs.length);
    if (pending === 0) {
      setOutwardPolling(false);
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
    if (!searchRunId) return;
    setOutwardPolling(true);
    setOutwardTimedOut(false);
    const initialTimeout = setTimeout(() => {
      pollOutwardJobs(searchRunId);
      pollRef.current = setInterval(() => pollOutwardJobs(searchRunId), 8000);
    }, 3000);
    const channel = supabase
      .channel(`outward-jobs-${searchRunId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "outward_jobs",
        filter: `search_run_id=eq.${searchRunId}`,
      }, () => pollOutwardJobs(searchRunId))
      .subscribe();
    timeoutRef.current = setTimeout(() => {
      setOutwardTimedOut(true); setOutwardPolling(false); setOutwardPending(0);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }, OUTWARD_TIMEOUT_MS);
    return () => {
      clearTimeout(initialTimeout);
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [searchRunId, pollOutwardJobs]);

  // FIX #5: Pass full_market_scan to edge function
  const triggerOutwardSearch = async (filters: {
    make: string; model?: string; badge?: string | null;
    year_min?: number | null; year_max?: number | null;
    max_km?: number | null; price_max?: number | null;
  }) => {
    try {
      const instructionParts = [filters.make, filters.model].filter(Boolean);
      if (filters.badge) instructionParts.push(filters.badge);
      if (filters.year_min) instructionParts.push(`${filters.year_min}`);
      if (filters.max_km) instructionParts.push(`under ${filters.max_km}km`);
      if (filters.price_max) instructionParts.push(`under $${filters.price_max}`);
      const instruction = instructionParts.join(" ");

      const { data, error } = await supabase.functions.invoke("run-outward-search-v2", {
        body: {
          instruction,
          account_id: dealerProfile?.account_id || null,
          initiated_by: "dealer",
          full_market_scan: fullMarketScan,
          filters: {
            make: filters.make,
            model: filters.model,
            badge: filters.badge,
            year_min: filters.year_min,
            year_max: filters.year_max,
            max_km: filters.max_km,
            price_max: filters.price_max,
          },
        },
      });
      if (error) { console.error("Outward search v2 error:", error); return; }

      // FIX #4: Phase 1 results — merge into outward results with "internal" source tag
      if (data?.results && Array.isArray(data.results) && data.results.length > 0) {
        const mapped: OutwardResult[] = data.results.map((r: any) => ({
          title: r.title || "",
          price: r.price ?? r.effective_cost ?? null,
          price_type: null,
          km: r.km ?? null,
          year: r.year ?? null,
          location: r.state || r.location || null,
          dealer_name: r.source_class === "auction" ? (r.auction_house || r.source || null) : (r.source_class || r.source || null),
          url: r.url || r.listing_url || "",
          badge: r.variant || null,
          source: r.source || "internal",
          colour: null,
          stock_no: null,
        }));
        setPhase1Count(mapped.length);
        // Merge Phase 1 results (don't overwrite — these are the baseline)
        setOutwardResults(prev => {
          const merged = [...prev, ...mapped];
          const urlMap = new Map<string, OutwardResult>();
          for (const r of merged) {
            const key = r.url || `${r.title}|${r.year ?? ""}|${r.km ?? ""}|${r.location ?? ""}`;
            const existing = urlMap.get(key);
            if (!existing || (r.price != null && (existing.price == null || r.price < existing.price))) {
              urlMap.set(key, r);
            }
          }
          return Array.from(urlMap.values());
        });
      }

      // If Lindy jobs were dispatched, start polling
      if (data?.search_run_id && data?.outward_jobs?.length > 0) {
        const dispatchedJobs = data.outward_jobs.filter((j: any) => !TERMINAL_STATUSES.has(j.status));
        if (dispatchedJobs.length > 0) {
          setSearchRunId(data.search_run_id);
          setOutwardTotal(data.outward_jobs.length);
          setOutwardPending(dispatchedJobs.length);
          toast({ title: `Searching ${dispatchedJobs.length} external source${dispatchedJobs.length > 1 ? "s" : ""}`, description: "Results will arrive in 2–5 minutes." });
        }
      } else if (data?.results?.length > 0) {
        setOutwardTotal(0); setOutwardPending(0);
      }
    } catch (err) { console.error("Outward search v2 failed:", err); }
  };

  // ── Main search handler ──
  const handleSearch = async () => {
    if (!canSearch) return;

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

    const instructionParts = [structuredFilters.make, structuredFilters.model];
    if (structuredFilters.badge) instructionParts.push(structuredFilters.badge);
    if (structuredFilters.year_min) instructionParts.push(`${structuredFilters.year_min}`);
    if (structuredFilters.max_km) instructionParts.push(`under ${structuredFilters.max_km}km`);
    if (structuredFilters.price_max) instructionParts.push(`under $${structuredFilters.price_max}`);
    const instruction = query.trim() || instructionParts.join(" ");

    setHasSearched(true);
    setInternalLoading(true);
    setOutwardTriggered(true);
    setOutwardTimedOut(false);
    setInternalResults([]);
    setDealerSpecs([]);
    setExternalResponse(null);
    setSearchRunId(null);
    setOutwardResults([]);
    setOutwardPending(0);
    setOutwardTotal(0);
    setPhase1Count(0);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    seenJobIdsRef.current.clear();

    try {
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
        const outwardFilters = {
          make: structuredFilters.make,
          model: structuredFilters.model,
          badge: structuredFilters.badge,
          year_min: structuredFilters.year_min,
          year_max: structuredFilters.year_max,
          max_km: structuredFilters.max_km,
          price_max: structuredFilters.price_max,
        };
        triggerOutwardSearch(outwardFilters);
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

          {/* Outward Activity Banner */}
          {outwardPolling && outwardPending > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 animate-pulse">
              <div className="relative flex h-3 w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  CaroogleAI searching {outwardPending} dealer site{outwardPending > 1 ? "s" : ""}…
                </p>
                <p className="text-[11px] text-amber-600/70 dark:text-amber-500/70">
                  {outwardTotal - outwardPending}/{outwardTotal} complete · Results arrive in 2–5 min
                </p>
              </div>
              <Loader2 className="h-4 w-4 animate-spin text-amber-600 shrink-0" />
            </div>
          )}

          {/* Outward Complete Banner */}
          {!outwardPolling && outwardTotal > 0 && hasSearched && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shrink-0"></span>
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                CaroogleAI complete — {outwardResults.length} vehicle{outwardResults.length !== 1 ? "s" : ""} found from {outwardTotal} dealer site{outwardTotal > 1 ? "s" : ""}
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
      {(outwardTriggered || outwardPolling || outwardResults.length > 0) && (
        <OutwardResultsSection
          outwardTriggered={outwardTriggered}
          searchRunId={searchRunId}
          outwardPolling={outwardPolling}
          outwardPending={outwardPending}
          outwardTotal={outwardTotal}
          outwardResults={outwardResults}
          outwardTimedOut={outwardTimedOut}
          phase1Count={phase1Count}
        />
      )}
    </div>
  );
}
