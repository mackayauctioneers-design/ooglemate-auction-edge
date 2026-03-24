import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, ExternalLink, X, SlidersHorizontal, Car } from "lucide-react";
import { DealerLayout } from "@/components/layout/DealerLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatDistanceToNow } from "date-fns";

const ACTIVE_LIFECYCLE = ["NEW", "ACTIVE", "WATCH", "BUY", "RELISTED"];
const PAGE_SIZE = 50;

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];

interface MarketListing {
  id: string;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  source: string | null;
  source_class: string | null;
  listing_url: string | null;
  location: string | null;
  state: string | null;
  auction_house: string | null;
  listing_type: string | null;
  last_seen_at: string | null;
  first_seen_at: string | null;
  lifecycle_status: string | null;
  seller_name: string | null;
  price_badge: string | null;
  transmission: string | null;
  fuel_type: string | null;
  colour: string | null;
}

interface Filters {
  make: string;
  model: string;
  yearMin: string;
  yearMax: string;
  kmMax: string;
  priceMax: string;
  state: string;
  sourceClass: string;
  priceBadge: string;
  sortBy: string;
}

const PRICE_BADGES = [
  "Well Below Market",
  "Below Market",
  "Fair Price",
  "Above Market",
];

const defaultFilters: Filters = {
  make: "",
  model: "",
  yearMin: "",
  yearMax: "",
  kmMax: "",
  priceMax: "",
  state: "all",
  sourceClass: "all",
  priceBadge: "all",
  sortBy: "recent",
};

async function searchMarketListings(filters: Filters, page: number) {
  let q = supabase
    .from("market_listings")
    .select("id, make, model, variant_raw, year, km, asking_price, source, source_class, listing_url, location, state, auction_house, listing_type, last_seen_at, first_seen_at, lifecycle_status, seller_name, price_badge, transmission, fuel_type, colour", { count: "exact" })
    .in("lifecycle_status", ACTIVE_LIFECYCLE)
    .eq("is_historical_result", false)
    .not("asking_price", "is", null);

  if (filters.make) q = q.ilike("make", `%${filters.make.trim()}%`);
  if (filters.model) q = q.ilike("model", `%${filters.model.trim()}%`);
  if (filters.yearMin) q = q.gte("year", parseInt(filters.yearMin));
  if (filters.yearMax) q = q.lte("year", parseInt(filters.yearMax));
  if (filters.kmMax) q = q.lte("km", parseInt(filters.kmMax));
  if (filters.priceMax) q = q.lte("asking_price", parseInt(filters.priceMax));
  if (filters.state !== "all") q = q.eq("state", filters.state);
  if (filters.sourceClass !== "all") q = q.eq("source_class", filters.sourceClass);
  if (filters.priceBadge !== "all") q = q.ilike("price_badge", `${filters.priceBadge}%`);

  // Sort
  if (filters.sortBy === "price_asc") {
    q = q.order("asking_price", { ascending: true, nullsFirst: false });
  } else if (filters.sortBy === "price_desc") {
    q = q.order("asking_price", { ascending: false });
  } else if (filters.sortBy === "km_asc") {
    q = q.order("km", { ascending: true, nullsFirst: false });
  } else if (filters.sortBy === "year_desc") {
    q = q.order("year", { ascending: false });
  } else {
    q = q.order("last_seen_at", { ascending: false });
  }

  q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  const { data, error, count } = await q;
  if (error) throw error;
  return { listings: (data || []) as MarketListing[], total: count || 0 };
}

function formatCurrency(n: number | null) {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-AU", { maximumFractionDigits: 0 });
}

function formatKm(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-AU") + " km";
}

function sourceLabel(source: string | null, sourceClass: string | null) {
  if (sourceClass === "auction") return "Auction";
  if (sourceClass === "retail") return "Retail";
  return source || "Unknown";
}

function sourceBadgeVariant(sourceClass: string | null): "default" | "secondary" | "outline" {
  if (sourceClass === "auction") return "default";
  if (sourceClass === "retail") return "secondary";
  return "outline";
}

export default function FindCarsPage() {
  useDocumentTitle(0);

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(true);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["find-cars", appliedFilters, page],
    queryFn: () => searchMarketListings(appliedFilters, page),
    placeholderData: (prev: { listings: MarketListing[]; total: number } | undefined) => prev,
  });

  const listings = data?.listings || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const applyFilters = useCallback(() => {
    setPage(0);
    setAppliedFilters({ ...filters });
  }, [filters]);

  const clearFilters = useCallback(() => {
    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setPage(0);
  }, []);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const hasActiveFilters = Object.entries(appliedFilters).some(
    ([k, v]) => v !== defaultFilters[k as keyof Filters]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") applyFilters();
  };

  return (
    <DealerLayout>
      <div className="p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Car className="h-6 w-6" />
              Find Cars
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Browse {total.toLocaleString()} active listings across auction and retail sources
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </Button>
        </div>

        {/* Filters */}
        {showFilters && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <Input
                  placeholder="Make (e.g. Toyota)"
                  value={filters.make}
                  onChange={(e) => updateFilter("make", e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <Input
                  placeholder="Model (e.g. Hilux)"
                  value={filters.model}
                  onChange={(e) => updateFilter("model", e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="Year from"
                    type="number"
                    value={filters.yearMin}
                    onChange={(e) => updateFilter("yearMin", e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                  <Input
                    placeholder="Year to"
                    type="number"
                    value={filters.yearMax}
                    onChange={(e) => updateFilter("yearMax", e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
                <Input
                  placeholder="Max KM"
                  type="number"
                  value={filters.kmMax}
                  onChange={(e) => updateFilter("kmMax", e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <Input
                  placeholder="Max Price"
                  type="number"
                  value={filters.priceMax}
                  onChange={(e) => updateFilter("priceMax", e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <Select value={filters.state} onValueChange={(v) => updateFilter("state", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="State" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All States</SelectItem>
                    {STATES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filters.sourceClass} onValueChange={(v) => updateFilter("sourceClass", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Source Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="auction">Auction Only</SelectItem>
                    <SelectItem value="retail">Retail Only</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filters.priceBadge} onValueChange={(v) => updateFilter("priceBadge", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Price Badge" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Badges</SelectItem>
                    {PRICE_BADGES.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filters.sortBy} onValueChange={(v) => updateFilter("sortBy", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">Most Recent</SelectItem>
                    <SelectItem value="price_asc">Price: Low → High</SelectItem>
                    <SelectItem value="price_desc">Price: High → Low</SelectItem>
                    <SelectItem value="km_asc">Lowest KM</SelectItem>
                    <SelectItem value="year_desc">Newest Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Button onClick={applyFilters} size="sm" className="gap-2">
                  <Search className="h-4 w-4" />
                  Search
                </Button>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
                    <X className="h-3 w-3" />
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Car className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">No listings found</p>
            <p className="text-sm mt-1">Try adjusting your filters</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {listings.map((l) => (
                <Card key={l.id} className="hover:bg-muted/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-foreground">
                            {l.year} {l.make} {l.model}
                          </h3>
                          <Badge variant={sourceBadgeVariant(l.source_class)}>
                            {sourceLabel(l.source, l.source_class)}
                          </Badge>
                          {l.price_badge && (
                            <Badge variant={l.price_badge === "Well Below Market" ? "default" : "outline"} className={l.price_badge === "Well Below Market" ? "bg-green-600" : ""}>
                              {l.price_badge}
                            </Badge>
                          )}
                        </div>
                        {l.variant_raw && (
                          <p className="text-sm text-muted-foreground mt-0.5 truncate">{l.variant_raw}</p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                          <span>{formatKm(l.km)}</span>
                          {l.transmission && <span>{l.transmission}</span>}
                          {l.location && <span>{l.location}</span>}
                          {l.state && <span className="font-medium">{l.state}</span>}
                          {l.auction_house && <span>{l.auction_house}</span>}
                          {l.seller_name && l.source_class === "retail" && <span>{l.seller_name}</span>}
                          {l.last_seen_at && (
                            <span className="text-xs">
                              Seen {formatDistanceToNow(new Date(l.last_seen_at), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-foreground">{formatCurrency(l.asking_price)}</p>
                        {l.listing_url && (
                          <a
                            href={l.listing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
                          >
                            View <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-muted-foreground">
                  Page {page + 1} of {totalPages} ({total.toLocaleString()} results)
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {isFetching && !isLoading && (
          <div className="fixed bottom-4 right-4 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-sm flex items-center gap-2 shadow-lg">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </div>
        )}
      </div>
    </DealerLayout>
  );
}
