import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  SYNTHETIC_FINGERPRINTS,
  SYNTHETIC_MISSED,
  PRICE_RANGES,
  AVAILABLE_MAKES,
  MODELS_BY_MAKE,
  SyntheticFingerprint,
} from "@/lib/syntheticFingerprints";
import {
  ArrowRight,
  ArrowLeft,
  Target,
  TrendingUp,
  AlertTriangle,
  Bell,
  Flame,
  Clock,
  CheckCircle2,
  Zap,
} from "lucide-react";

// ============================================================================
// FIRST 5 MINUTE WIN — Dealer Conversion Flow
// ============================================================================

type Step = "profile" | "winners" | "live-match" | "missed" | "activate";
const STEPS: Step[] = ["profile", "winners", "live-match", "missed", "activate"];

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(val);
}

function formatKm(val: number) {
  return `${Math.round(val / 1000).toLocaleString()}k km`;
}

export default function WinFlowPage() {
  const navigate = useNavigate();
  const { user, dealerProfile } = useAuth();
  const [step, setStep] = useState<Step>("profile");

  // Step 1 state
  const [selectedMake, setSelectedMake] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedPriceRange, setSelectedPriceRange] = useState<number | null>(null);

  // Derived data
  const [fingerprints, setFingerprints] = useState<SyntheticFingerprint[]>([]);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);

  const stepIndex = STEPS.indexOf(step);
  const makeKey = selectedMake || "Mixed";

  // When profile step completes, compute fingerprints
  useEffect(() => {
    if (step === "winners" && selectedMake) {
      const all = SYNTHETIC_FINGERPRINTS[makeKey] || SYNTHETIC_FINGERPRINTS["Mixed"];
      const filtered = selectedModels.length > 0
        ? all.filter((f) => selectedModels.includes(f.model))
        : all;
      // Filter by price range
      const priceFilter = selectedPriceRange !== null ? PRICE_RANGES[selectedPriceRange] : null;
      const final = priceFilter
        ? filtered.filter((f) => f.avg_sale >= priceFilter.min && f.avg_sale <= priceFilter.max)
        : filtered;
      setFingerprints(final.length > 0 ? final.slice(0, 5) : all.slice(0, 5));
    }
  }, [step, selectedMake, selectedModels, selectedPriceRange, makeKey]);

  // Fetch live matches from caroogle_finds when entering live-match step
  useEffect(() => {
    if (step !== "live-match" || fingerprints.length === 0) return;

    const fetchMatches = async () => {
      setLoadingMatches(true);
      try {
        // Try to find real matches from caroogle_finds
        const makes = [...new Set(fingerprints.map((f) => f.make))];
        const models = [...new Set(fingerprints.map((f) => f.model))];

        const { data } = await supabase
          .from("caroogle_finds")
          .select("*")
          .in("make", makes)
          .in("model", models)
          .eq("status", "active")
          .order("score", { ascending: false })
          .limit(10);

        if (data && data.length > 0) {
          // Apply KM + margin filtering
          const filtered = data.filter((listing) => {
            const fp = fingerprints.find(
              (f) => f.make === listing.make && f.model === listing.model
            );
            if (!fp) return false;

            // KM filter: ±20%
            if (listing.km) {
              if (listing.km < fp.km_low * 0.8 || listing.km > fp.km_high * 1.2) return false;
            }

            // Margin filter: must be > $2000
            const margin = fp.avg_sale - (listing.price || 0);
            if (margin < 2000) return false;

            return true;
          });

          // Enrich with fingerprint data
          const enriched = filtered.slice(0, 5).map((listing) => {
            const fp = fingerprints.find(
              (f) => f.make === listing.make && f.model === listing.model
            )!;
            const margin = fp.avg_sale - (listing.price || 0);
            return { ...listing, expected_sale: fp.avg_sale, margin, days_to_sell: fp.days_to_sell };
          });

          if (enriched.length > 0) {
            setLiveMatches(enriched);
            setLoadingMatches(false);
            return;
          }
        }

        // Fallback: generate synthetic matches from fingerprints
        const synthetic = fingerprints.slice(0, 4).map((fp, i) => {
          const buyPrice = fp.avg_sale - fp.avg_profit - Math.floor(Math.random() * 1500);
          const km = fp.km_low + Math.floor(Math.random() * (fp.km_high - fp.km_low));
          return {
            id: `synthetic-${i}`,
            make: fp.make,
            model: fp.model,
            variant: fp.variant,
            year: 2021 + Math.floor(Math.random() * 3),
            km,
            price: buyPrice,
            expected_sale: fp.avg_sale,
            margin: fp.avg_sale - buyPrice,
            days_to_sell: fp.days_to_sell,
            source: ["AutoTrader", "Pickles", "Manheim", "GraysOnline"][i % 4],
            listing_url: null,
            is_synthetic: true,
          };
        });
        setLiveMatches(synthetic);
      } catch (err) {
        console.error("Error fetching matches:", err);
      } finally {
        setLoadingMatches(false);
      }
    };

    fetchMatches();
  }, [step, fingerprints]);

  const handleActivate = async () => {
    localStorage.setItem('carbitrage_onboarding_complete', 'true');
    toast.success("Dealer feed activated! You'll get daily alerts.");
    navigate("/dealer-home", { replace: true });
  };

  const toggleModel = (model: string) => {
    setSelectedModels((prev) =>
      prev.includes(model) ? prev.filter((m) => m !== model) : prev.length < 3 ? [...prev, model] : prev
    );
  };

  const canAdvanceFromProfile = selectedMake !== null;
  const missedData = SYNTHETIC_MISSED[makeKey] || SYNTHETIC_MISSED["Mixed"];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Progress bar */}
      <div className="w-full px-4 pt-6 pb-4">
        <div className="max-w-2xl mx-auto flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1.5 rounded-full flex-1 transition-all duration-500",
                i <= stepIndex ? "bg-foreground" : "bg-border"
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 pb-8 pt-2">
        <div className="w-full max-w-2xl">

          {/* ============ STEP 1: PROFILE SNAPSHOT ============ */}
          {step === "profile" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold text-foreground tracking-tight">
                  What do you sell?
                </h1>
                <p className="text-muted-foreground">30 seconds — then we'll show you money on the table.</p>
              </div>

              {/* Make selection */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">Primary brand</label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {AVAILABLE_MAKES.map((make) => (
                    <button
                      key={make}
                      onClick={() => {
                        setSelectedMake(make);
                        setSelectedModels([]);
                      }}
                      className={cn(
                        "px-4 py-3 rounded-lg border text-sm font-medium transition-all",
                        selectedMake === make
                          ? "border-foreground bg-foreground text-primary-foreground"
                          : "border-border bg-card text-foreground hover:border-foreground/40"
                      )}
                    >
                      {make}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model selection */}
              {selectedMake && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <label className="text-sm font-medium text-foreground">
                    Top models <span className="text-muted-foreground font-normal">(pick up to 3)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(MODELS_BY_MAKE[selectedMake] || []).map((model) => (
                      <button
                        key={model}
                        onClick={() => toggleModel(model)}
                        className={cn(
                          "px-4 py-2.5 rounded-lg border text-sm font-medium transition-all",
                          selectedModels.includes(model)
                            ? "border-foreground bg-foreground text-primary-foreground"
                            : "border-border bg-card text-foreground hover:border-foreground/40"
                        )}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Price range */}
              {selectedMake && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <label className="text-sm font-medium text-foreground">Typical price range</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PRICE_RANGES.map((range, i) => (
                      <button
                        key={range.label}
                        onClick={() => setSelectedPriceRange(selectedPriceRange === i ? null : i)}
                        className={cn(
                          "px-4 py-3 rounded-lg border text-sm font-medium transition-all",
                          selectedPriceRange === i
                            ? "border-foreground bg-foreground text-primary-foreground"
                            : "border-border bg-card text-foreground hover:border-foreground/40"
                        )}
                      >
                        {range.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Button
                className="w-full h-12 text-base"
                onClick={() => setStep("winners")}
                disabled={!canAdvanceFromProfile}
              >
                Show me what I should be buying <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          )}

          {/* ============ STEP 2: YOUR PROVEN WINNERS ============ */}
          {step === "winners" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
                  <Target className="h-4 w-4" /> YOUR SALES TRUTH
                </div>
                <h1 className="text-3xl font-bold text-foreground tracking-tight">
                  Your Proven Winners
                </h1>
                <p className="text-muted-foreground">
                  These specs move fast and make money.
                </p>
              </div>

              <div className="space-y-3">
                {fingerprints.map((fp, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">
                        {fp.make} {fp.model} {fp.variant}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        KM: {formatKm(fp.km_low)}–{formatKm(fp.km_high)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm text-muted-foreground">Avg Sale</p>
                      <p className="font-semibold text-foreground">{formatCurrency(fp.avg_sale)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm text-muted-foreground">Profit</p>
                      <p className="font-bold text-foreground">{formatCurrency(fp.avg_profit)}</p>
                    </div>
                    <div className="text-right shrink-0 hidden sm:block">
                      <p className="text-sm text-muted-foreground">Days</p>
                      <div className="flex items-center gap-1 justify-end">
                        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-semibold text-foreground">{fp.days_to_sell}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("profile")} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button onClick={() => setStep("live-match")} className="flex-1 h-12">
                  Show me what's available now <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </div>
          )}

          {/* ============ STEP 3: LIVE MARKET MATCH ============ */}
          {step === "live-match" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
                  <Flame className="h-4 w-4" /> LIVE MARKET
                </div>
                <h1 className="text-3xl font-bold text-foreground tracking-tight">
                  Cars You Should Be Buying Right Now
                </h1>
              </div>

              {loadingMatches ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="rounded-lg border border-border bg-card p-6 animate-pulse">
                      <div className="h-5 w-3/4 bg-muted rounded mb-3" />
                      <div className="h-4 w-1/2 bg-muted rounded" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {liveMatches.map((match, i) => (
                    <div
                      key={match.id || i}
                      className="rounded-lg border border-border bg-card p-5 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold text-foreground text-lg">
                            {match.year} {match.make} {match.model} {match.variant || ""}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            KM: {match.km ? match.km.toLocaleString() : "N/A"} · Source: {match.source || "Market"}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Buy Price</p>
                          <p className="font-semibold text-foreground">{formatCurrency(match.price || 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Expected Sale</p>
                          <p className="font-semibold text-foreground">{formatCurrency(match.expected_sale)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Margin</p>
                          <p className="font-bold text-foreground text-lg">
                            +{formatCurrency(match.margin)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Speed</p>
                          <div className="flex items-center gap-1">
                            <Zap className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold text-foreground">{match.days_to_sell}d</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-xs">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-secondary text-secondary-foreground">
                          <CheckCircle2 className="h-3 w-3" /> Fingerprint match
                        </span>
                        {match.margin > 3000 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-secondary text-secondary-foreground">
                            <TrendingUp className="h-3 w-3" /> High margin
                          </span>
                        )}
                        {match.days_to_sell < 20 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-secondary text-secondary-foreground">
                            <Zap className="h-3 w-3" /> Fast mover
                          </span>
                        )}
                      </div>

                      {match.listing_url && (
                        <a
                          href={match.listing_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground transition-colors"
                        >
                          View Listing <ArrowRight className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("winners")} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button onClick={() => setStep("missed")} className="flex-1 h-12">
                  What am I missing? <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </div>
          )}

          {/* ============ STEP 4: MISSED OPPORTUNITY (FOMO) ============ */}
          {step === "missed" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 text-sm font-medium text-destructive mb-1">
                  <AlertTriangle className="h-4 w-4" /> MISSED
                </div>
                <h1 className="text-3xl font-bold text-foreground tracking-tight">
                  You Missed This
                </h1>
                <p className="text-muted-foreground">
                  These matched your profile but sold before you saw them.
                </p>
              </div>

              <div className="space-y-3">
                {missedData.map((missed, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-card p-5 space-y-3 opacity-90"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-foreground text-lg">{missed.title}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>Listed {missed.listed_ago}</span>
                          <span>·</span>
                          <span>{missed.source}</span>
                        </div>
                      </div>
                      <span className="shrink-0 px-2.5 py-1 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold">
                        SOLD
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Listed Price</p>
                        <p className="font-semibold text-foreground">{formatCurrency(missed.price)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Market Value</p>
                        <p className="font-semibold text-foreground">{formatCurrency(missed.market_price)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Missed Margin</p>
                        <p className="font-bold text-foreground text-lg">
                          +{formatCurrency(missed.missed_margin)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-border bg-card p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Without alerts, you'll keep missing these.
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("live-match")} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button onClick={() => setStep("activate")} className="flex-1 h-12">
                  Don't miss another <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </div>
          )}

          {/* ============ STEP 5: ACTIVATE ============ */}
          {step === "activate" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-secondary mx-auto">
                  <Bell className="h-8 w-8 text-foreground" />
                </div>
                <h1 className="text-3xl font-bold text-foreground tracking-tight">
                  Want alerts like this daily?
                </h1>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Get 2–5 high-confidence matches sent to your dashboard every day.
                  Only vehicles that match your fingerprint with real margin.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-foreground">What you'll get:</h3>
                <div className="space-y-3">
                  {[
                    "Exact fingerprint matches from auctions & dealers",
                    "Margin calculated instantly — no guesswork",
                    "Fast movers flagged so you buy with confidence",
                    "Missed opportunity alerts so you never lose another",
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-foreground shrink-0 mt-0.5" />
                      <p className="text-sm text-foreground">{item}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Button onClick={handleActivate} className="w-full h-14 text-lg font-semibold">
                  <Bell className="mr-2 h-5 w-5" /> Activate Dealer Feed
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => navigate("/dealer-home", { replace: true })}
                  className="w-full text-muted-foreground"
                >
                  Skip for now
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
