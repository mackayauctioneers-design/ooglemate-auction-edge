import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { searchOogleBot, searchOogleBotDirect, type OogleBotResponse, type OogleBotResult } from "@/lib/api/ooglebot";
import { searchTiered, searchDealerSpecs, parseSearchQuery, type InternalMatch, type TieredSearchResult } from "@/lib/api/ooglebot-internal";
import { extractSeries } from "@/utils/derivePlatform";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
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
  ExternalLink, Mic, MicOff, Building2, ChevronDown, X, Gavel,
} from "lucide-react";
import { KitingLoader } from "@/components/ui/KitingLoader";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
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

function numericOrInfinity(value: number | null | undefined) {
  return value == null ? Number.POSITIVE_INFINITY : value;
}

// ── Unified Result (canonical shape for merged display) ──

interface UnifiedResult {
  id: string;
  title: string;
  year: number | null;
  price: number | null;
  effective_price: number | null;
  price_type: string | null;
  km: number | null;
  location: string | null;
  source: string;
  source_class: string | null;
  auction_house: string | null;
  variant: string | null;
  url: string | null;
  dealer_name: string | null;
  days_listed: number | null;
  score: number | null;
  match_reason: string[];
  is_auction: boolean;
  is_discovery: boolean;
}

const AUCTION_SOURCES = new Set([
  "pickles", "manheim", "slattery", "grays", "f3", "aav",
  "auto_auctions", "vma", "bidsonline",
  "auto_auctions_aav", "uaa_nsw",
]);

function isAuctionResult(r: { source?: string; source_class?: string | null; auction_house?: string | null }): boolean {
  return r.source_class === "auction" || !!r.auction_house || AUCTION_SOURCES.has(r.source || "");
}

// ── Result Cards ──

// ── Unified Result Card ──

function UnifiedResultCard({ result, isBestPrice, isOperator }: { result: UnifiedResult; isBestPrice?: boolean; isOperator?: boolean }) {
  const hasUrl = !!result.url;
  return (
    <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border transition-colors ${
      isBestPrice
        ? "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15"
        : "border-border bg-card hover:bg-muted/30"
    }`}>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isBestPrice && (
            <Badge className="text-[9px] px-1 py-0 bg-emerald-500 text-white border-emerald-600 leading-tight">
              Best
            </Badge>
          )}
          <span className="font-medium text-xs text-foreground truncate">{result.title}</span>
          {result.variant && <span className="text-[10px] text-muted-foreground">{result.variant}</span>}
        </div>
        <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground flex-wrap">
          {result.price != null && (
            <span className="font-medium text-foreground">
              {formatPrice(result.price)}
              {result.price_type === 'excl_govt' && (
                <span className="text-[9px] text-muted-foreground font-normal ml-0.5">ex govt</span>
              )}
            </span>
          )}
          {result.km != null && (
            <span>{formatKm(result.km)}</span>
          )}
          {result.location && (
            <span>{result.location}</span>
          )}
          {result.days_listed != null && <span>{result.days_listed}d</span>}
          {result.dealer_name && (
            <span className="truncate max-w-[100px]">{result.dealer_name}</span>
          )}
          <Badge variant="outline" className="text-[9px] px-1 py-0 leading-tight">
            {result.is_discovery ? "AI" : (result.is_auction && result.auction_house ? result.auction_house : (result.source_class || result.source))}
          </Badge>
          {isOperator && result.score != null && <span className="text-[9px]">S:{result.score}</span>}
        </div>
        {isOperator && result.match_reason.length > 0 && (
          <div className="flex flex-wrap gap-0.5">
            {result.match_reason.map((r, i) => (
              <Badge key={i} variant="outline" className="text-[8px] px-0.5 py-0 text-muted-foreground">{r}</Badge>
            ))}
          </div>
        )}
      </div>
      {hasUrl ? (
        <a href={result.url!} target="_blank" rel="noopener noreferrer" className="shrink-0">
          <Button variant="ghost" size="iconSm" className="h-6 w-6 text-muted-foreground hover:text-primary">
            <ExternalLink className="h-3 w-3" />
          </Button>
        </a>
      ) : result.is_discovery ? (
        <span className="text-[9px] text-muted-foreground shrink-0 italic">AI est.</span>
      ) : null}
    </div>
  );
}

// OutwardResult shape kept for polling data
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
const TERMINAL_STATUSES = new Set(["complete", "failed", "timeout"]);

/** Detect which LC series a result belongs to (for series gate) */
function detectSeriesFromText(text: string): string | null {
  const t = text.toUpperCase();
  if (/\b7[0689]\b/.test(t) || /70[\-_\s]?SERIES|LANDCRUISER70|LC7[0689]/.test(t) || /\bWORKMATE\b/.test(t)) return "LC70";
  if (/\b300\b/.test(t) || /GR[\-_\s]?SPORT|GR[\-_\s]?S\b|LC300/.test(t)) return "LC300";
  if (/\b200\b/.test(t) || /LC200/.test(t)) return "LC200";
  return null;
}

/** Convert all result types into UnifiedResult[] */
function mergeAllResults(
  internalResults: InternalMatch[],
  scoredResults: OogleBotResult[],
  outwardResults: OutwardResult[],
  badgeFilter?: string | null,
  intentSeries?: string | null,
): UnifiedResult[] {
  const all: UnifiedResult[] = [];

  // Client-side badge filter helper — checks if variant contains the badge as a whole token
  // AND excludes variants with sub-badge qualifiers (e.g. "XLT" should NOT match "XLT HI-RIDER")
  const badgeUpper = badgeFilter?.trim().toUpperCase().replace(/[^A-Z0-9\s\-]/g, "").replace(/\s+/g, " ") || null;
  const badgeRe = badgeUpper ? new RegExp(`(^|[\\s\\-\\/,])${badgeUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\\-\\/,])`, "i") : null;

  // Known sub-badge qualifiers that create distinct trims when appended to a base badge
  const SUB_BADGE_QUALIFIERS = ["HI-RIDER", "HIRIDER", "HI RIDER", "WILDTRAK", "RAPTOR", "SPORT"];
  const badgeHasQualifier = (q: string) => badgeUpper ? badgeUpper.includes(q.replace(/[\s\-]/g, "")) : false;

  const matchesBadge = (variant: string | null | undefined, ...extraFields: (string | null | undefined)[]): boolean => {
    if (!badgeUpper || !badgeRe) return true; // no filter
    if (!variant) return false;

    // Check ALL text fields for sub-badge qualifiers the user didn't specify
    const allText = [variant, ...extraFields].filter(Boolean).join(" ").toUpperCase().replace(/[\s\-]/g, "");
    for (const qual of SUB_BADGE_QUALIFIERS) {
      const qualNorm = qual.replace(/[\s\-]/g, "");
      if (allText.includes(qualNorm) && !badgeHasQualifier(qual)) {
        return false;
      }
    }

    const vNorm = variant.toUpperCase().replace(/[^A-Z0-9\s\-\/,]/g, "");
    if (!(vNorm === badgeUpper || badgeRe.test(variant))) return false;
    return true;
  };

  // Series gate helper — reject cross-generation results
  const matchesSeries = (r: { title?: string; variant?: string | null; id?: string; url?: string | null }): boolean => {
    if (!intentSeries) return true;
    const text = [r.title, r.variant, r.id, r.url].filter(Boolean).join(" ");
    const ls = detectSeriesFromText(text);
    return ls === null || ls === intentSeries;
  };

  // Internal results
  for (const m of internalResults) {
    if (!matchesBadge(m.variant_raw)) continue;
    all.push({
      id: m.id,
      title: `${m.year ?? ""} ${m.make ?? ""} ${m.model ?? ""}`.trim(),
      year: m.year ?? null,
      price: m.asking_price ?? null,
      effective_price: m.asking_price ?? null,
      price_type: null,
      km: m.km ?? null,
      location: m.location || null,
      source: m.source || "internal",
      source_class: m.source_class || null,
      auction_house: m.auction_house || null,
      variant: m.variant_raw || null,
      url: m.listing_url || null,
      dealer_name: m.source_class === "auction" ? (m.auction_house || null) : null,
      days_listed: null,
      score: null,
      match_reason: [],
      is_auction: isAuctionResult(m),
      is_discovery: false,
    });
  }

  // Scored / ooglebot-search results
  for (const r of scoredResults) {
    if (!matchesBadge(r.variant, r.listing_url)) continue;
    all.push({
      id: r.listing_id,
      title: `${r.year ?? ""} ${r.make ?? ""} ${r.model ?? ""}`.trim(),
      year: r.year,
      price: r.price ?? null,
      effective_price: r.effective_cost ?? r.price ?? null,
      price_type: null,
      km: r.km ?? null,
      location: r.location || r.state || null,
      source: r.source,
      source_class: r.source_class || null,
      auction_house: r.auction_house || null,
      variant: r.variant || null,
      url: r.listing_url || null,
      dealer_name: r.source_class === "auction" ? (r.auction_house || null) : null,
      days_listed: r.days_listed ?? null,
      score: r.score,
      match_reason: r.match_reason || [],
      is_auction: isAuctionResult(r),
      is_discovery: false,
    });
  }

  // Outward results
  for (const r of outwardResults) {
    if (!matchesBadge(r.badge || r.title)) continue;
    const effPrice = r.price != null
      ? (r.price_type === 'excl_govt' ? r.price + EGC_ON_ROAD_ESTIMATE : r.price)
      : null;
    all.push({
      id: r.url || `${r.title}|${r.year}|${r.km}`,
      title: r.title || "Untitled",
      year: r.year,
      price: r.price,
      effective_price: effPrice,
      price_type: r.price_type || null,
      km: r.km,
      location: r.location,
      source: r.source,
      source_class: null,
      auction_house: null,
      variant: r.badge || null,
      url: r.url,
      dealer_name: r.dealer_name,
      days_listed: null,
      score: null,
      match_reason: [],
      is_auction: isAuctionResult({ source: r.source }),
      is_discovery: r.source === "lindy_discovery" || r.source === "perplexity" || r.source === "caroogleai",
    });
  }

  // Deduplicate by URL, keep lowest effective price
  const map = new Map<string, UnifiedResult>();
  for (const r of all) {
    const key = r.url || r.id;
    const existing = map.get(key);
    if (!existing || (r.effective_price != null && (existing.effective_price == null || r.effective_price < existing.effective_price))) {
      map.set(key, r);
    }
  }

  // Apply series gate as final safety net, then sort
  return Array.from(map.values())
    .filter(r => matchesSeries(r))
    .sort((a, b) => numericOrInfinity(a.effective_price) - numericOrInfinity(b.effective_price));
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN: OogleBotSearch — Structured-First Search
// ══════════════════════════════════════════════════════════════════════════════

export function OogleBotSearch() {
  const { toast } = useToast();
  const { isAdmin, dealerProfile } = useAuth();

  // ── Entitlement: fetch plan_tier for discovery eligibility ──
  const [planTier, setPlanTier] = useState<string | null>(null);
  useEffect(() => {
    if (!dealerProfile?.account_id) return;
    supabase
      .from("dealer_entitlements")
      .select("plan_tier")
      .eq("account_id", dealerProfile.account_id)
      .maybeSingle()
      .then(({ data }) => setPlanTier(data?.plan_tier ?? null));
  }, [dealerProfile?.account_id]);

  // Enterprise + Operator always get AI Market Discovery
  const canUseDiscovery = isAdmin || planTier === "enterprise" || planTier === "premium";

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
  // Discovery users always get full market scan — no toggle needed
  const fullMarketScan = canUseDiscovery;

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

   // ── Active Hunt state ──
   const [huntId, setHuntId] = useState<string | null>(null);
   const [huntStatus, setHuntStatus] = useState<"idle" | "hunting" | "complete">("idle");
   const [huntSources, setHuntSources] = useState<string[]>([]);
   const [huntQueueIds, setHuntQueueIds] = useState<string[]>([]);
   const huntPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
   const huntReQueryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   const huntNeedsFinalRequeryRef = useRef(false);
   const MIN_RESULTS_FOR_HUNT = 20;

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

  // ── Unified result merge ──
  // Extract intent series from make + model for LC generation gating
  const intentSeries = useMemo(() => extractSeries(make, model), [make, model]);
  const allUnified = useMemo(
    () => mergeAllResults(internalResults, externalResponse?.results ?? [], outwardResults, badge, intentSeries),
    [internalResults, externalResponse?.results, outwardResults, badge, intentSeries],
  );
  const marketResults = useMemo(() => allUnified.filter(r => !r.is_auction), [allUnified]);
  const auctionResults = useMemo(() => allUnified.filter(r => r.is_auction), [allUnified]);

  // Outward polling state
  const [showAllMarket, setShowAllMarket] = useState(false);
  const [showAllAuction, setShowAllAuction] = useState(false);
  const [msgIndex, setMsgIndex] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const prevOutwardCountRef = useRef(0);
  const [jobStatuses, setJobStatuses] = useState<Array<{ source_key: string; status: string; result_count: number }>>([]);

  // ── CaroogleAI Market Insight (auto, top 3 only) ──
  const [insightText, setInsightText] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const insightFiredRef = useRef<string | null>(null); // track which search triggered insight

  // Elapsed timer while outward polling
  useEffect(() => {
    if (!outwardPolling || outwardPending === 0) { setElapsedSec(0); return; }
    const start = Date.now();
    const interval = setInterval(() => setElapsedSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [outwardPolling, outwardPending > 0]);

  useEffect(() => {
    if (outwardPending === 0) return;
    const interval = setInterval(() => setMsgIndex(i => (i + 1) % REASSURANCE_MESSAGES.length), 15_000);
    return () => clearInterval(interval);
  }, [outwardPending]);

  // ── Auto-fire CaroogleAI insight when top 3 have listing age data ──
  useEffect(() => {
    if (marketResults.length < 3) return;
    const top3 = marketResults.slice(0, 3);
    // Gate: only fire if at least 2 of top 3 have days_listed
    const withAge = top3.filter(r => r.days_listed != null);
    if (withAge.length < 2) return;

    const top3Key = top3.map(r => r.id).join("|");
    if (insightFiredRef.current === top3Key) return;
    insightFiredRef.current = top3Key;

    const floorPrice = top3[0].effective_price ?? top3[0].price ?? 0;
    const secondPrice = top3[1].effective_price ?? top3[1].price ?? 0;
    const thirdPrice = top3[2].effective_price ?? top3[2].price ?? 0;
    const spread = floorPrice > 0 ? (((thirdPrice - floorPrice) / floorPrice) * 100).toFixed(1) : "0";
    const vehicleLabel = `${make} ${model} ${badge}`.trim();

    setInsightLoading(true);
    setInsightText(null);

    supabase.functions.invoke("ooglebot-gemini-insight", {
      body: {
        vehicle: vehicleLabel,
        floor: floorPrice,
        second: secondPrice,
        third: thirdPrice,
        spread_pct: parseFloat(spread),
        count: marketResults.length,
        outlier_flag: false,
        floor_days_listed: top3[0].days_listed,
        second_days_listed: top3[1].days_listed,
        third_days_listed: top3[2].days_listed,
      },
    }).then(({ data, error }) => {
      if (error) {
        console.error("CaroogleAI insight error:", error);
        setInsightText(null);
      } else {
        setInsightText(data?.insight || null);
      }
    }).catch((err) => {
      console.error("CaroogleAI insight error:", err);
      setInsightText(null);
    }).finally(() => {
      setInsightLoading(false);
    });
  }, [marketResults, make, model, badge]);

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
          source: r.source_key || "caroogleai",
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
    setJobStatuses(jobs.map(j => ({ source_key: j.source_key, status: j.status, result_count: j.result_count ?? 0 })));
    if (pending === 0) {
      setOutwardPolling(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, []);

  // Notify user when new outward results arrive
  useEffect(() => {
    const prev = prevOutwardCountRef.current;
    const curr = outwardResults.length;
    if (curr > prev && prev > 0) {
      const newCount = curr - prev;
      sonnerToast.success(`${newCount} new result${newCount > 1 ? "s" : ""} found`, {
        description: `${curr} total vehicles from dealer sites`,
      });
    }
    prevOutwardCountRef.current = curr;
  }, [outwardResults.length]);

  // Notify when outward search completes
  useEffect(() => {
    if (!outwardPolling && outwardTotal > 0 && hasSearched && !outwardTimedOut) {
      sonnerToast.success("Market search complete", {
        description: `${outwardResults.length} vehicle${outwardResults.length !== 1 ? "s" : ""} found across ${outwardTotal} dealer sites`,
        duration: 8000,
      });
    }
  }, [outwardPolling, outwardTotal, hasSearched, outwardTimedOut]);

   useEffect(() => {
     return () => {
       if (pollRef.current) clearInterval(pollRef.current);
       if (timeoutRef.current) clearTimeout(timeoutRef.current);
       if (huntPollRef.current) clearInterval(huntPollRef.current);
       if (huntReQueryRef.current) clearTimeout(huntReQueryRef.current);
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
          initiated_by: isAdmin ? "operator" : "dealer",
          full_market_scan: canUseDiscovery,
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

      // If CaroogleAI jobs were dispatched, start polling
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
    setShowAllMarket(false);
    setShowAllAuction(false);
    setOutwardTimedOut(false);
    setInternalResults([]);
    setDealerSpecs([]);
    setExternalResponse(null);
    setSearchRunId(null);
    setOutwardResults([]);
    setOutwardPending(0);
    setOutwardTotal(0);
    setPhase1Count(0);
    setInsightText(null);
    setInsightLoading(false);
    insightFiredRef.current = null;
     if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
     if (huntPollRef.current) { clearInterval(huntPollRef.current); huntPollRef.current = null; }
     if (huntReQueryRef.current) { clearTimeout(huntReQueryRef.current); huntReQueryRef.current = null; }
     seenJobIdsRef.current.clear();
     prevOutwardCountRef.current = 0;
     huntNeedsFinalRequeryRef.current = false;
     setJobStatuses([]);
     setHuntId(null);
     setHuntStatus("idle");
     setHuntSources([]);
     setHuntQueueIds([]);

    try {
      const structuredIntent = {
        make: structuredFilters.make,
        model: structuredFilters.model,
        badge: structuredFilters.badge,
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

      // Count total results
      const directCount = directResult.status === "fulfilled" ? (directResult.value.results?.length ?? 0) : 0;
      const totalResults = listings.length + directCount;
      console.log(`[Search] Total internal results: ${totalResults} (tiered: ${listings.length}, direct: ${directCount})`);

      // Outward gate — always trigger outward search for AI discovery
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

      // ── ACTIVE HUNT: If fewer than MIN_RESULTS, trigger scrapers ──
      if (totalResults < MIN_RESULTS_FOR_HUNT) {
        console.log(`[Active Hunt] Only ${totalResults} results (< ${MIN_RESULTS_FOR_HUNT}), launching scrapers…`);
        setHuntStatus("hunting");

        try {
          const { data: huntData, error: huntError } = await supabase.functions.invoke("ooglebot-active-hunt", {
            body: {
              make: structuredFilters.make,
              model: structuredFilters.model,
              badge: structuredFilters.badge,
              year_min: structuredFilters.year_min,
              year_max: structuredFilters.year_max,
              km_max: structuredFilters.max_km,
              price_max: structuredFilters.price_max,
              state: structuredFilters.state,
              account_id: dealerProfile?.account_id || null,
              initiated_by: isAdmin ? "operator" : "user",
              internal_count: totalResults,
            },
          });

          if (huntError) {
            console.error("[Active Hunt] Error:", huntError);
            setHuntStatus("idle");
          } else if (huntData?.hunt_id) {
            setHuntId(huntData.hunt_id);
            setHuntSources(huntData.sources_triggered || []);
            setHuntQueueIds(huntData.apify_queue_ids || []);
            console.log(`[Active Hunt] Launched: ${huntData.sources_triggered?.join(", ")} (hunt_id: ${huntData.hunt_id})`);

            sonnerToast.info("Hunting the market…", {
              description: `Searching ${huntData.sources_triggered?.length || 0} external sources: ${huntData.sources_triggered?.join(", ")}`,
              duration: 6000,
            });

            // Poll apify_runs_queue for completion, then re-query
            const queueIds = huntData.apify_queue_ids || [];
            if (queueIds.length > 0) {
              let reQueryDone = false;
              huntPollRef.current = setInterval(async () => {
                const { data: queueRows } = await supabase
                  .from("apify_runs_queue")
                  .select("id, status, items_upserted")
                  .in("id", queueIds);

                if (!queueRows) return;
                const completed = queueRows.filter(r => r.status === "completed" || r.status === "failed");
                const totalUpserted = queueRows.reduce((sum, r) => sum + (r.items_upserted || 0), 0);

                if (totalUpserted > 0 && !reQueryDone) {
                  reQueryDone = true;
                  console.log(`[Active Hunt] ${totalUpserted} items ingested — re-running search`);
                  // Re-query internal DB
                  const reQuery = await searchTiered(instruction, structuredIntent);
                  const newListings = [...reQuery.tier0_auctions, ...reQuery.tier1_internal];
                  setInternalResults(newListings);
                  sonnerToast.success(`${totalUpserted} new vehicles discovered`, {
                    description: `Total results now: ${newListings.length}`,
                  });
                }

                if (completed.length === queueRows.length) {
                  // All done
                  setHuntStatus("complete");
                  if (huntPollRef.current) { clearInterval(huntPollRef.current); huntPollRef.current = null; }

                  // Final re-query if we haven't already
                  if (!reQueryDone && totalUpserted > 0) {
                    const finalReQuery = await searchTiered(instruction, structuredIntent);
                    setInternalResults([...finalReQuery.tier0_auctions, ...finalReQuery.tier1_internal]);
                  }

                  // Update hunt record
                  supabase.from("ooglebot_active_hunts").update({
                    status: "complete",
                    results_found: totalUpserted,
                    completed_at: new Date().toISOString(),
                  }).eq("id", huntData.hunt_id).then(() => {});
                }
              }, 10_000); // Poll every 10s

              // Safety timeout: stop polling after 5 minutes
              huntReQueryRef.current = setTimeout(() => {
                if (huntPollRef.current) { clearInterval(huntPollRef.current); huntPollRef.current = null; }
                setHuntStatus(prev => prev === "hunting" ? "complete" : prev);
              }, 5 * 60 * 1000);
            } else {
              // No Apify queue IDs (e.g. only CaroogleAI), wait and re-query once
              huntReQueryRef.current = setTimeout(async () => {
                const reQuery = await searchTiered(instruction, structuredIntent);
                setInternalResults([...reQuery.tier0_auctions, ...reQuery.tier1_internal]);
                setHuntStatus("complete");
              }, 30_000);
            }
          }
        } catch (huntErr) {
          console.error("[Active Hunt] Failed:", huntErr);
          setHuntStatus("idle");
        }
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

          {/* AI Market Discovery — auto-enabled for enterprise/operator, hidden for others */}
          {canUseDiscovery && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/20 bg-primary/5">
              <Search className="h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium text-primary">AI Market Discovery Enabled</p>
                <p className="text-[10px] text-muted-foreground">External marketplaces will be searched automatically</p>
              </div>
              <Badge variant="outline" className="ml-auto text-[9px] shrink-0">Premium</Badge>
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
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2">
              <div className="flex items-center gap-3">
                <div className="relative flex h-3 w-3 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    AI Discovery — {outwardTotal - outwardPending}/{outwardTotal} sources complete
                  </p>
                  <p className="text-[11px] text-amber-600/70 dark:text-amber-500/70">
                    {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')} elapsed
                  </p>
                </div>
                <Loader2 className="h-4 w-4 animate-spin text-amber-600 shrink-0" />
              </div>
              {/* Per-source progress list */}
              {jobStatuses.length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-6">
                  {jobStatuses.map((j) => {
                    const displayName: Record<string, string> = {
                      autotrader: "Autotrader",
                      drive: "Drive",
                      gumtree_dealer: "Gumtree",
                      gumtree_private: "Gumtree Private",
                      carsales: "Carsales",
                      carsguide: "CarsGuide",
                    };
                    const name = displayName[j.source_key] || j.source_key;
                    const isComplete = j.status === "complete";
                    const isFailed = j.status === "failed" || j.status === "timeout";
                    const isPending = !isComplete && !isFailed;
                    return (
                      <div key={j.source_key} className="flex items-center gap-1.5 text-[11px]">
                        {isComplete && <span className="text-emerald-500">✓</span>}
                        {isFailed && <span className="text-red-400">✗</span>}
                        {isPending && <Loader2 className="h-3 w-3 animate-spin text-amber-500" />}
                        <span className={isComplete ? "text-emerald-600 dark:text-emerald-400" : isFailed ? "text-red-500/70" : "text-amber-600 dark:text-amber-400"}>
                          {name}
                        </span>
                        {isComplete && j.result_count > 0 && (
                          <span className="text-emerald-500/70">({j.result_count})</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px] text-amber-600/50 dark:text-amber-500/50 pl-6 animate-pulse">
                {REASSURANCE_MESSAGES[msgIndex]}
              </p>
            </div>
          )}

          {/* Outward Complete Banner */}
          {!outwardPolling && outwardTotal > 0 && hasSearched && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-2">
              <div className="flex items-center gap-3">
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shrink-0"></span>
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  AI Discovery complete — {outwardResults.length} vehicle{outwardResults.length !== 1 ? "s" : ""} found
                </p>
              </div>
              {jobStatuses.length > 0 && (() => {
                const displayName: Record<string, string> = {
                  autotrader: "Autotrader",
                  drive: "Drive",
                  gumtree_dealer: "Gumtree",
                  gumtree_private: "Gumtree Private",
                  carsales: "Carsales",
                  carsguide: "CarsGuide",
                };
                const succeeded = jobStatuses.filter(j => j.status === "complete" && j.result_count > 0);
                const scannedNoResults = jobStatuses.filter(j => j.status === "complete" && j.result_count === 0);
                const failedCount = jobStatuses.filter(j => j.status === "failed" || j.status === "timeout").length;
                return (
                  <div className="pl-6 space-y-1">
                    {succeeded.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {succeeded.map(j => (
                          <span key={j.source_key} className="text-[11px] text-emerald-600 dark:text-emerald-400">
                            ✓ {displayName[j.source_key] || j.source_key} ({j.result_count})
                          </span>
                        ))}
                      </div>
                    )}
                    {(scannedNoResults.length > 0 || failedCount > 0) && (
                      <p className="text-[10px] text-muted-foreground">
                        {scannedNoResults.length + failedCount} source{scannedNoResults.length + failedCount !== 1 ? "s" : ""} scanned — no matching inventory
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Active Hunt Banner ── */}
          {huntStatus === "hunting" && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/30 space-y-2">
              <div className="flex items-center gap-3">
                <div className="relative flex h-3 w-3 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary">
                    🔍 Hunting the market…
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Scraping {huntSources.length} sources for live inventory. Results will appear automatically.
                  </p>
                </div>
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              </div>
              {huntSources.length > 0 && (
                <div className="flex flex-wrap gap-2 pl-6">
                  {huntSources.map(src => {
                    const names: Record<string, string> = {
                      carsales: "Carsales", autotrader: "Autotrader", gumtree: "Gumtree",
                      slattery: "Slattery", caroogleai: "AI Discovery",
                    };
                    return (
                      <Badge key={src} variant="outline" className="text-[10px] border-primary/30 text-primary">
                        {names[src] || src}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {huntStatus === "complete" && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <div className="flex items-center gap-3">
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shrink-0"></span>
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  ✅ Market hunt complete — results updated
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ 1️⃣ MARKET RESULTS (hero section) ═══ */}
      {hasSearched && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <Search className="h-5 w-5 text-primary" />
              Market Results
              {outwardPending > 0 && !outwardTimedOut && (
                <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {outwardTotal - outwardPending}/{outwardTotal} sources complete
                </span>
              )}
              {marketResults.length > 0 && outwardPending === 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  {marketResults.length} vehicle{marketResults.length !== 1 ? "s" : ""}
                </span>
              )}
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Sorted by lowest available market price.
            </p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {/* ── Market Insight (auto, top 3 — only when listing age available) ── */}
            {!internalLoading && marketResults.length >= 3 && marketResults.slice(0, 3).filter(r => r.days_listed != null).length >= 2 && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 mb-3 space-y-2">
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Floor</p>
                    <p className="text-sm font-semibold text-foreground">{formatPrice(marketResults[0].effective_price ?? marketResults[0].price)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">2nd</p>
                    <p className="text-sm font-semibold text-foreground">{formatPrice(marketResults[1].effective_price ?? marketResults[1].price)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">3rd</p>
                    <p className="text-sm font-semibold text-foreground">{formatPrice(marketResults[2].effective_price ?? marketResults[2].price)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Spread</p>
                    <p className="text-sm font-semibold text-foreground">
                      {(() => {
                        const f = marketResults[0].effective_price ?? marketResults[0].price ?? 0;
                        const t = marketResults[2].effective_price ?? marketResults[2].price ?? 0;
                        return f > 0 ? `${(((t - f) / f) * 100).toFixed(1)}%` : "—";
                      })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Listings</p>
                    <p className="text-sm font-semibold text-foreground">{marketResults.length}</p>
                  </div>
                </div>

                {/* CaroogleAI insight */}
                {insightLoading && (
                  <div className="space-y-1.5 pt-2 border-t border-border">
                    <p className="text-xs text-muted-foreground animate-pulse">Analysing market structure…</p>
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                )}
                {!insightLoading && insightText && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Market Insight</p>
                    <div className="text-xs text-foreground whitespace-pre-line leading-relaxed">
                      {insightText}
                    </div>
                  </div>
                )}
              </div>
            )}
            {internalLoading && (
              <div className="flex flex-col items-center py-6 gap-1">
                <KitingLoader size="md" label="Searching…" />
              </div>
            )}
            {!internalLoading && marketResults.length === 0 && outwardPending > 0 && !outwardTimedOut && (
              <div className="flex flex-col items-center py-6 gap-2">
                <KitingLoader size="md" />
                <div className="w-full max-w-xs space-y-1">
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${outwardTotal > 0 ? Math.max(5, ((outwardTotal - outwardPending) / outwardTotal) * 100) : 5}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center animate-pulse">
                    {REASSURANCE_MESSAGES[msgIndex]}
                  </p>
                </div>
              </div>
            )}
            {!internalLoading && marketResults.length > 0 && outwardPending > 0 && !outwardTimedOut && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Extended search in progress… {marketResults.length} result{marketResults.length !== 1 ? "s" : ""} so far
                </p>
              </div>
            )}
            {!internalLoading && marketResults.length === 0 && outwardPending === 0 && (
              <p className="text-sm text-muted-foreground py-4">
                No matching vehicles found. Try broadening your search criteria.
              </p>
            )}
            {/* Results list */}
            {(() => {
              const INITIAL_SHOW = 5;
              const displayed = showAllMarket ? marketResults : marketResults.slice(0, INITIAL_SHOW);
              return (
                <>
                  <div className={!showAllMarket && marketResults.length > INITIAL_SHOW ? "max-h-[420px] overflow-y-auto space-y-1.5 pr-1" : "space-y-1.5"}>
                    {displayed.map((result, i) => (
                      <UnifiedResultCard key={result.id} result={result} isBestPrice={i === 0 && marketResults.length > 1} isOperator={isAdmin} />
                    ))}
                  </div>
                  {marketResults.length > INITIAL_SHOW && !showAllMarket && (
                    <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setShowAllMarket(true)}>
                      Show all {marketResults.length} results
                    </Button>
                  )}
                  {showAllMarket && marketResults.length > INITIAL_SHOW && (
                    <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setShowAllMarket(false)}>
                      Show top {INITIAL_SHOW} only
                    </Button>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* ═══ 2️⃣ AUCTION ALTERNATIVES ═══ */}
      {hasSearched && auctionResults.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Gavel className="h-4 w-4 text-muted-foreground" />
              Auction Alternatives
              <span className="text-xs font-normal text-muted-foreground">
                {auctionResults.length} listing{auctionResults.length !== 1 ? "s" : ""}
              </span>
            </CardTitle>
            <p className="text-[10px] text-muted-foreground">
              Dealer trade channels — not mixed with retail market results.
            </p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(() => {
              const displayed = showAllAuction ? auctionResults : auctionResults.slice(0, 5);
              return (
                <>
                  {displayed.map((result) => (
                    <UnifiedResultCard key={result.id} result={result} isOperator={isAdmin} />
                  ))}
                  {auctionResults.length > 5 && !showAllAuction && (
                    <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setShowAllAuction(true)}>
                      Show all {auctionResults.length} auction listings
                    </Button>
                  )}
                  {showAllAuction && auctionResults.length > 5 && (
                    <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setShowAllAuction(false)}>
                      Show top 5 only
                    </Button>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* ═══ 3️⃣ DEALER SPECS ═══ */}
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
    </div>
  );
}
