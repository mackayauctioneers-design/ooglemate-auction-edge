import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, Bell, X, ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface VehicleMention {
  make: string;
  model: string;
  variant?: string;
  year_min?: number;
  year_max?: number;
  drivetrain?: string;
  fuel_type?: string;
  transmission?: string;
  confidence_level: string;
}

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
  bobResponse: string;
  accountId: string;
}

const CONFIDENCE_LABELS: Record<string, { label: string; className: string }> = {
  HIGH: { label: "Actively hunt", className: "bg-primary/10 text-primary border-primary/20" },
  MEDIUM: { label: "Watch closely", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  LOW: { label: "Outcome signal — monitor for repeat", className: "bg-muted text-muted-foreground border-border" },
};

const MATCH_BADGES: Record<string, { label: string; className: string }> = {
  exact: { label: "Exact match", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  close: { label: "Close match", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  loose: { label: "Loose reference", className: "bg-muted text-muted-foreground border-border" },
};

export function BobSourcingLinks({ bobResponse, accountId }: Props) {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState<VehicleMention[]>([]);
  const [listings, setListings] = useState<ScoredListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!bobResponse || bobResponse.length < 50 || fetched) return;

    const fetchLinks = async () => {
      setLoading(true);
      try {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bob-sourcing-links`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({ bobResponse, accountId }),
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          setVehicles(data.vehicles || []);
          setListings(data.listings || []);
        }
      } catch (e) {
        console.error("Sourcing links fetch error:", e);
      }
      setLoading(false);
      setFetched(true);
    };

    fetchLinks();
  }, [bobResponse, accountId, fetched]);

  const saveToWatchlist = useCallback(
    async (listing: ScoredListing, watchType: "watch" | "hunt") => {
      if (!user) {
        toast.error("Please sign in to save to watchlist");
        return;
      }
      const vehicle = vehicles[listing.match_vehicle_index];
      if (!vehicle) return;

      const { error } = await supabase.from("sourcing_watchlist").insert({
        user_id: user.id,
        account_id: accountId,
        make: vehicle.make,
        model: vehicle.model,
        variant: vehicle.variant || null,
        year_min: vehicle.year_min || null,
        year_max: vehicle.year_max || null,
        drivetrain: vehicle.drivetrain || null,
        fuel_type: vehicle.fuel_type || null,
        transmission: vehicle.transmission || null,
        confidence_level: vehicle.confidence_level,
        watch_type: watchType,
        linked_listing_id: listing.id,
        linked_listing_url: listing.listing_url,
        originating_insight: bobResponse.slice(0, 500),
      });

      if (error) {
        console.error("Save to watchlist error:", error);
        toast.error("Failed to save to watchlist");
      } else {
        setSavedIds((prev) => new Set([...prev, listing.id]));
        toast.success(watchType === "hunt" ? "Added to hunt list" : "Added to watchlist");
      }
    },
    [user, accountId, vehicles, bobResponse]
  );

  if (!fetched && !loading) return null;

  if (loading) {
    return (
      <div className="space-y-2 pt-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Finding relevant vehicles to watch…
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!listings.length) return null;

  // Group by confidence
  const grouped = vehicles.map((v, vi) => ({
    vehicle: v,
    listings: listings.filter((l) => l.match_vehicle_index === vi),
  })).filter((g) => g.listings.length > 0);

  if (!grouped.length) return null;

  return (
    <div className="space-y-3 pt-3 border-t border-border/50">
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium text-foreground">
          Relevant vehicles to watch
        </span>
        <span className="text-xs text-muted-foreground">
          Based on your proven outcomes
        </span>
      </div>

      {grouped.map((group, gi) => {
        const conf = CONFIDENCE_LABELS[group.vehicle.confidence_level] || CONFIDENCE_LABELS.LOW;
        return (
          <div key={gi} className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-foreground">
                {group.vehicle.make} {group.vehicle.model}
                {group.vehicle.variant ? ` ${group.vehicle.variant}` : ""}
                {group.vehicle.year_min ? ` (${group.vehicle.year_min}${group.vehicle.year_max && group.vehicle.year_max !== group.vehicle.year_min ? `–${group.vehicle.year_max}` : ""})` : ""}
              </span>
              <Badge variant="outline" className={`text-[10px] ${conf.className}`}>
                {conf.label}
              </Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.listings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  isSaved={savedIds.has(listing.id)}
                  onWatch={() => saveToWatchlist(listing, "watch")}
                  onHunt={() => saveToWatchlist(listing, "hunt")}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListingCard({
  listing,
  isSaved,
  onWatch,
  onHunt,
}: {
  listing: ScoredListing;
  isSaved: boolean;
  onWatch: () => void;
  onHunt: () => void;
}) {
  const matchBadge = MATCH_BADGES[listing.match_quality];
  const sourceLabel = listing.auction_house || listing.source || "Unknown";

  return (
    <Card className="border-border/60 bg-card/50">
      <CardContent className="p-3 space-y-2">
        {/* Title row */}
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
            <a
              href={listing.listing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        {/* Details */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {listing.asking_price != null && (
            <span className="font-medium text-foreground">
              ${listing.asking_price.toLocaleString()}
            </span>
          )}
          {listing.km != null && <span>{listing.km.toLocaleString()} km</span>}
          {listing.location && <span>{listing.location}</span>}
        </div>

        {/* Actions */}
        {!isSaved ? (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2 gap-1"
              onClick={onWatch}
            >
              <Star className="h-3 w-3" /> Watch
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2 gap-1"
              onClick={onHunt}
            >
              <Bell className="h-3 w-3" /> Hunt
            </Button>
          </div>
        ) : (
          <p className="text-[10px] text-primary">✓ Saved</p>
        )}
      </CardContent>
    </Card>
  );
}
