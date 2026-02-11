import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FingerprintTarget } from "@/hooks/useBuyAgainTargets";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  days_listed: number | null;
  below_median: boolean;
  delta_pct: number | null;
}

export function ListingsSearchModal({ target, open, onOpenChange }: Props) {
  const { data: listings, isLoading } = useQuery({
    queryKey: ["fingerprint-listings", target?.id],
    queryFn: async () => {
      if (!target) return [];

      // Build query against vehicle_listings
      let q = supabase
        .from("vehicle_listings")
        .select("id, make, model, variant, year, km, price, url, source, first_seen_at")
        .ilike("make", target.make)
        .ilike("model", target.model)
        .eq("status", "active")
        .order("price", { ascending: true })
        .limit(20);

      if (target.year_from) q = q.gte("year", target.year_from);
      if (target.year_to) q = q.lte("year", target.year_to);
      if (target.transmission) q = q.ilike("transmission", target.transmission);

      const { data, error } = await q;
      if (error) throw error;

      const medianSale = target.median_sale_price || 0;
      return (data || []).map((l: any) => {
        const price = l.price || 0;
        const belowMedian = medianSale > 0 && price < medianSale;
        const deltaPct = medianSale > 0 ? ((price - medianSale) / medianSale) * 100 : null;
        const daysListed = l.first_seen_at
          ? Math.floor((Date.now() - new Date(l.first_seen_at).getTime()) / 86400000)
          : null;

        return {
          id: l.id,
          make: l.make,
          model: l.model,
          variant: l.variant,
          year: l.year,
          km: l.km,
          price: l.price,
          url: l.url,
          source: l.source,
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
            No active listings found matching this fingerprint.
          </p>
        ) : (
          <div className="space-y-2">
            {listings.map((l) => (
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
                    <Button
                      size="sm"
                      variant="ghost"
                      asChild
                    >
                      <a href={l.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
