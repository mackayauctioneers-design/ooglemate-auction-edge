import { useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, ArrowLeft, Search, Star, Bell, ExternalLink, Loader2 } from "lucide-react";
import { useSalesDrillDown, buildSpecBreakdown, type YearBandRow, type SpecRow } from "@/hooks/useSalesDrillDown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const RANGE_LABELS: Record<string, string> = {
  "3": "3 months",
  "6": "6 months",
  "12": "12 months",
  "all": "all time",
};

function formatPrice(p: number | null) {
  if (p == null) return "—";
  return `$${p.toLocaleString()}`;
}

function profitBadge(dollars: number | null) {
  if (dollars == null) return <span className="text-muted-foreground text-xs">—</span>;
  const label = `$${Math.abs(dollars).toLocaleString()}`;
  if (dollars >= 5000) return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">{label} — higher margin</Badge>;
  if (dollars >= 1000) return <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">{label}</Badge>;
  if (dollars >= 0) return <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">{label} — thin margin</Badge>;
  return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">-{label} — lower realised margin</Badge>;
}

function clearanceBadge(days: number | null) {
  if (days == null) return <span className="text-muted-foreground text-xs">—</span>;
  if (days <= 21) return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">{days}d — clears quickly</Badge>;
  if (days <= 45) return <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">{days}d — clears consistently</Badge>;
  return <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">{days}d — longer clearance observed</Badge>;
}

// ── Match quality badges ──
const MATCH_BADGES: Record<string, { label: string; className: string }> = {
  exact: { label: "Exact match", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  close: { label: "Close match", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  loose: { label: "Loose reference", className: "bg-muted text-muted-foreground border-border" },
};

interface ScoredListing {
  id: string;
  listing_url: string | null;
  make: string;
  model: string;
  variant_used: string | null;
  year: number;
  km: number | null;
  asking_price: number | null;
  source: string;
  source_class: string;
  auction_house: string | null;
  location: string | null;
  match_quality: "exact" | "close" | "loose";
  match_vehicle_index: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  make: string;
  model: string;
  accountId: string;
  range: string;
}

export function SalesDrillDownDrawer({ open, onOpenChange, make, model, accountId, range }: Props) {
  const rangeMonths = range === "all" ? null : parseInt(range);
  const { data, isLoading } = useSalesDrillDown(accountId, make, model, rangeMonths);

  const [selectedBand, setSelectedBand] = useState<YearBandRow | null>(null);
  const [specData, setSpecData] = useState<SpecRow[]>([]);

  // Listing search state
  const [listings, setListings] = useState<ScoredListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsFetched, setListingsFetched] = useState(false);

  const handleBandClick = (band: YearBandRow) => {
    if (!data?.rawRows) return;
    if (band.salesCount < 2) return;
    const specs = buildSpecBreakdown(data.rawRows as any, band.yearMin, band.yearMax);
    setSpecData(specs);
    setSelectedBand(band);
  };

  const handleBack = () => {
    setSelectedBand(null);
    setSpecData([]);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedBand(null);
      setSpecData([]);
      setListings([]);
      setListingsFetched(false);
    }
    onOpenChange(isOpen);
  };

  const searchListings = useCallback(async () => {
    setListingsLoading(true);
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bob-sourcing-links`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            bobResponse: `I recommend looking at ${make} ${model}`,
            accountId,
          }),
        }
      );
      if (resp.ok) {
        const result = await resp.json();
        setListings(result.listings || []);
      }
    } catch (e) {
      console.error("Listing search error:", e);
      toast.error("Failed to search listings");
    }
    setListingsLoading(false);
    setListingsFetched(true);
  }, [make, model, accountId]);

  const totalSales = data?.yearBands?.reduce((s, b) => s + b.salesCount, 0) ?? 0;

  // Derive replication summary from data
  const replicationSummary = data?.rawRows?.length ? deriveReplicationSummary(data.rawRows) : null;

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-lg">
            {selectedBand ? (
              <button onClick={handleBack} className="flex items-center gap-2 text-left hover:text-primary transition-colors">
                <ArrowLeft className="h-4 w-4" />
                {make} {model} — {selectedBand.yearBand}
              </button>
            ) : (
              <span>{make} {model}</span>
            )}
          </SheetTitle>
          <SheetDescription>
            {selectedBand
              ? `Spec breakdown for ${selectedBand.yearBand} (${selectedBand.salesCount} sales)`
              : `${totalSales} completed sales over the last ${RANGE_LABELS[range]}. Different generations of the same model can behave very differently.`}
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Loading breakdown…</p>
          </div>
        ) : selectedBand ? (
          <SpecBreakdownTable data={specData} />
        ) : (
          <div className="space-y-6">
            {/* Section A — What Actually Happened */}
            <YearBandTable
              bands={data?.yearBands || []}
              onBandClick={handleBandClick}
            />

            {/* Section B — What to Replicate */}
            {replicationSummary && totalSales >= 2 && (
              <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
                <p className="text-xs font-medium text-foreground">What to replicate</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  {replicationSummary.typicalKmRange && (
                    <div>
                      <span className="text-foreground font-medium">Typical KM:</span>{" "}
                      {replicationSummary.typicalKmRange}
                    </div>
                  )}
                  {replicationSummary.typicalBuyCeiling && (
                    <div>
                      <span className="text-foreground font-medium">Buy ceiling:</span>{" "}
                      {replicationSummary.typicalBuyCeiling}
                    </div>
                  )}
                  {replicationSummary.clearanceExpectation && (
                    <div>
                      <span className="text-foreground font-medium">Clearance:</span>{" "}
                      {replicationSummary.clearanceExpectation}
                    </div>
                  )}
                  {replicationSummary.medianProfit && (
                    <div>
                      <span className="text-foreground font-medium">Median margin:</span>{" "}
                      {replicationSummary.medianProfit}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Section C — Actions */}
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={searchListings}
                  disabled={listingsLoading}
                >
                  {listingsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Search current listings
                </Button>
                <WatchlistButton make={make} model={model} accountId={accountId} />
              </div>

              {/* Live listings results */}
              {listingsLoading && (
                <div className="grid gap-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
                </div>
              )}

              {listingsFetched && !listingsLoading && listings.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No active listings found matching this vehicle right now.
                </p>
              )}

              {listings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Search className="h-3 w-3 text-primary" />
                    {listings.length} current listing{listings.length !== 1 ? "s" : ""} found
                  </p>
                  <div className="grid gap-2">
                    {listings.map((listing) => (
                      <DrawerListingCard key={listing.id} listing={listing} accountId={accountId} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Replication summary derived from raw rows ──
function deriveReplicationSummary(rows: any[]) {
  const kms = rows.filter(r => r.km).map(r => r.km);
  const buyPrices = rows.filter(r => r.buy_price).map(r => r.buy_price);
  const days = rows.filter(r => r.days_to_clear != null).map(r => r.days_to_clear);
  const profits = rows.filter(r => r.sale_price != null && r.buy_price != null).map(r => r.sale_price - r.buy_price);

  const median = (arr: number[]) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  };

  const p25 = (arr: number[]) => {
    if (arr.length < 2) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.25)];
  };

  const p75 = (arr: number[]) => {
    if (arr.length < 2) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.75)];
  };

  const kmLow = p25(kms);
  const kmHigh = p75(kms);
  const buyMed = median(buyPrices);
  const daysMed = median(days);
  const profitMed = median(profits);

  return {
    typicalKmRange: kmLow != null && kmHigh != null ? `${(kmLow / 1000).toFixed(0)}k – ${(kmHigh / 1000).toFixed(0)}k` : null,
    typicalBuyCeiling: buyMed != null ? `$${buyMed.toLocaleString()}` : null,
    clearanceExpectation: daysMed != null ? `~${daysMed} days` : null,
    medianProfit: profitMed != null ? `$${profitMed.toLocaleString()}` : null,
  };
}

// ── Watchlist button ──
function WatchlistButton({ make, model, accountId }: { make: string; model: string; accountId: string }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!user) { toast.error("Please sign in"); return; }
    const { error } = await supabase.from("sourcing_watchlist").insert({
      user_id: user.id,
      account_id: accountId,
      make,
      model,
      confidence_level: "MEDIUM",
      watch_type: "watch",
      originating_insight: `Drill-down on ${make} ${model}`,
    });
    if (error) { toast.error("Failed to save"); console.error(error); }
    else { setSaved(true); toast.success("Added to watchlist"); }
  };

  if (saved) return <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">✓ On watchlist</Badge>;

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSave}>
      <Star className="h-3.5 w-3.5" /> Add to watchlist
    </Button>
  );
}

// ── Listing card for drawer ──
function DrawerListingCard({ listing, accountId }: { listing: ScoredListing; accountId: string }) {
  const { user } = useAuth();
  const matchBadge = MATCH_BADGES[listing.match_quality];
  const sourceLabel = listing.auction_house || listing.source || "Unknown";
  const [saved, setSaved] = useState(false);

  const handleWatch = async () => {
    if (!user) { toast.error("Please sign in"); return; }
    const { error } = await supabase.from("sourcing_watchlist").insert({
      user_id: user.id,
      account_id: accountId,
      make: listing.make,
      model: listing.model,
      variant: listing.variant_used,
      confidence_level: "MEDIUM",
      watch_type: "watch",
      linked_listing_id: listing.id,
      linked_listing_url: listing.listing_url,
      originating_insight: `Drill-down listing: ${listing.year} ${listing.make} ${listing.model}`,
    });
    if (error) { toast.error("Failed to save"); console.error(error); }
    else { setSaved(true); toast.success("Added to watchlist"); }
  };

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {listing.year} {listing.make} {listing.model}
            {listing.variant_used ? ` ${listing.variant_used}` : ""}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <Badge variant="outline" className={`text-[10px] ${matchBadge.className}`}>
              {matchBadge.label}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{sourceLabel}</span>
          </div>
        </div>
        {listing.listing_url && (
          <a href={listing.listing_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground shrink-0">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {listing.asking_price != null && <span className="font-medium text-foreground">${listing.asking_price.toLocaleString()}</span>}
        {listing.km != null && <span>{listing.km.toLocaleString()} km</span>}
        {listing.location && <span>{listing.location}</span>}
      </div>
      {!saved ? (
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={handleWatch}>
            <Star className="h-3 w-3" /> Watch
          </Button>
        </div>
      ) : (
        <p className="text-[10px] text-primary">✓ Saved</p>
      )}
    </div>
  );
}

// ── Year band table ──
function YearBandTable({ bands, onBandClick }: { bands: YearBandRow[]; onBandClick: (b: YearBandRow) => void }) {
  if (!bands.length) {
    return (
      <p className="text-center text-muted-foreground py-12">
        No year-level data available for this vehicle.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Year Band</TableHead>
          <TableHead className="text-right">Sales</TableHead>
          <TableHead className="text-right">Median Price</TableHead>
          <TableHead className="text-right">Median Margin</TableHead>
          <TableHead className="text-right">Clearance</TableHead>
          <TableHead className="w-8"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bands.map((band) => {
          const canDrill = band.salesCount >= 2;
          return (
            <TableRow
              key={band.yearBand}
              className={canDrill ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
              onClick={() => canDrill && onBandClick(band)}
            >
              <TableCell className="font-medium">{band.yearBand}</TableCell>
              <TableCell className="text-right font-mono">{band.salesCount}</TableCell>
              <TableCell className="text-right">{formatPrice(band.medianSalePrice)}</TableCell>
              <TableCell className="text-right">{profitBadge(band.medianProfitDollars)}</TableCell>
              <TableCell className="text-right">{clearanceBadge(band.medianDaysToClear)}</TableCell>
              <TableCell>
                {canDrill ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">n&lt;2</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ── Spec breakdown table ──
function SpecBreakdownTable({ data }: { data: SpecRow[] }) {
  if (!data.length) {
    return (
      <p className="text-center text-muted-foreground py-12">
        Limited data for deeper breakdown.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Spec</TableHead>
          <TableHead>Drive</TableHead>
          <TableHead className="text-right">Sales</TableHead>
          <TableHead className="text-right">Median Price</TableHead>
          <TableHead className="text-right">Median Margin</TableHead>
          <TableHead className="text-right">Clearance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, i) => {
          const specParts = [row.variant, row.transmission, row.fuelType].filter(Boolean);
          const specLabel = specParts.length ? specParts.join(" · ") : "Unspecified";
          const driveLabel = row.driveType || "—";
          const isSufficientSample = row.salesCount >= 2;
          return (
            <TableRow key={i}>
              <TableCell className="font-medium text-sm">{specLabel}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{driveLabel}</TableCell>
              <TableCell className="text-right font-mono">{row.salesCount}</TableCell>
              <TableCell className="text-right">{formatPrice(row.medianSalePrice)}</TableCell>
              <TableCell className="text-right">
                {!isSufficientSample
                  ? <span className="text-muted-foreground text-[10px] italic">Limited data</span>
                  : row.medianProfitDollars !== null
                    ? profitBadge(row.medianProfitDollars)
                    : <span className="text-muted-foreground text-[10px] italic">Insufficient data</span>}
              </TableCell>
              <TableCell className="text-right">
                {isSufficientSample
                  ? clearanceBadge(row.medianDaysToClear)
                  : <span className="text-muted-foreground text-[10px] italic">Limited data</span>}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
