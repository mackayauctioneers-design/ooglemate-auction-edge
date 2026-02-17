import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FingerprintTarget } from "@/components/buy-again/TargetCard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, TrendingDown } from "lucide-react";

interface Props {
  target: FingerprintTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ListingMatch {
  id: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  url: string | null;
  source: string | null;
  status: string | null;
  days_listed: number | null;
  below_median: boolean;
  delta_pct: number | null;
}

export function ListingsSearchModal({ target, open, onOpenChange }: Props) {
  const { data: listings, isLoading } = useQuery({
    queryKey: ["fingerprint-listings", target?.id],
    queryFn: async () => {
      if (!target) return [];

      // Build query against vehicle_listings (7-day freshness enforced)
      const freshCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      let q = supabase
        .from("vehicle_listings")
        .select("id, make, model, variant_raw, variant_family, year, km, asking_price, listing_url, source, first_seen_at, status")
        .in("status", ["catalogue", "listed"])
        .gte("last_seen_at", freshCutoff)
        .ilike("make", target.make)
        .ilike("model", target.model)
        .order("asking_price", { ascending: true, nullsFirst: false })
        .limit(40);

      if (target.year_from) q = q.gte("year", target.year_from);
      if (target.year_to) q = q.lte("year", target.year_to);
      if (target.transmission) q = q.ilike("transmission", target.transmission);

      const { data, error } = await q;
      if (error) throw error;

      const medianSale = target.median_sale_price || 0;
      return (data || []).map((l: any) => {
        const price = l.asking_price || 0;
        const belowMedian = medianSale > 0 && price < medianSale;
        const deltaPct = medianSale > 0 ? ((price - medianSale) / medianSale) * 100 : null;
        const daysListed = l.first_seen_at
          ? Math.floor((Date.now() - new Date(l.first_seen_at).getTime()) / 86400000)
          : null;

        return {
          id: l.id,
          make: l.make,
          model: l.model,
          variant: l.variant_raw || l.variant_family,
          year: l.year,
          km: l.km,
          price: l.asking_price,
          url: l.listing_url,
          source: l.source,
          status: l.status,
          days_listed: daysListed,
          below_median: belowMedian,
          delta_pct: deltaPct,
        } as ListingMatch;
      });
    },
    enabled: !!target && open,
  });

  if (!target) return null;

  const dna = [target.make, target.model, target.variant].filter(Boolean).join(" ");

  const ACTIVE_STATUSES = ["catalogue", "listed"];
  const SOLD_STATUSES = ["sold", "cleared", "closed"];

  const activeListings = listings?.filter((l) => ACTIVE_STATUSES.includes(l.status ?? "")) ?? [];
  const soldListings = listings?.filter((l) => SOLD_STATUSES.includes(l.status ?? "")) ?? [];
  const otherListings = listings?.filter(
    (l) => !ACTIVE_STATUSES.includes(l.status ?? "") && !SOLD_STATUSES.includes(l.status ?? "")
  ) ?? [];

  const renderList = (items: ListingMatch[]) => {
    if (!items.length) {
      return (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No listings in this category.
        </p>
      );
    }
    return (
      <div className="space-y-2">
        {items.map((l) => (
          <div
            key={l.id}
            className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
          >
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {[l.year, l.make, l.model, l.variant].filter(Boolean).join(" ")}
              </p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {l.km != null && <span>{(l.km / 1000).toFixed(0)}k km</span>}
                {l.source && <span>{l.source}</span>}
                {l.days_listed != null && <span>{l.days_listed}d listed</span>}
                {l.status && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {l.status}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-semibold">
                  {l.price ? `$${l.price.toLocaleString()}` : "N/A"}
                </p>
                {l.below_median && l.delta_pct != null && (
                  <p className="text-xs text-green-600 flex items-center gap-0.5 justify-end">
                    <TrendingDown className="h-3 w-3" />
                    {Math.abs(l.delta_pct).toFixed(0)}% below median
                  </p>
                )}
              </div>
              {l.url && (
                <Button size="sm" variant="ghost" asChild>
                  <a href={l.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Listings for {dna}
            {target.median_sale_price != null && (
              <Badge variant="outline" className="text-xs font-normal">
                Median sale ${target.median_sale_price.toLocaleString()}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !listings?.length ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No listings found matching this fingerprint.
          </p>
        ) : (
          <Tabs defaultValue="active">
            <TabsList>
              <TabsTrigger value="active">Active ({activeListings.length})</TabsTrigger>
              <TabsTrigger value="sold">Sold ({soldListings.length})</TabsTrigger>
              {otherListings.length > 0 && (
                <TabsTrigger value="other">Other ({otherListings.length})</TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="active">{renderList(activeListings)}</TabsContent>
            <TabsContent value="sold">{renderList(soldListings)}</TabsContent>
            {otherListings.length > 0 && (
              <TabsContent value="other">{renderList(otherListings)}</TabsContent>
            )}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
