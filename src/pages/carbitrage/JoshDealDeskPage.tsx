import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle,
  XCircle,
  ExternalLink,
  AlertTriangle,
  Ban,
  Plus,
  Loader2,
  Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface CheapCar {
  id: string;
  source: string;
  listing_id: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  market_price: number | null;
  discount_pct: number | null;
  deal_tag: string | null;
  location: string | null;
  seller_type: string | null;
  listing_url: string | null;
  image_url: string | null;
  detected_at: string;
  status: string;
  josh_verified: boolean;
  josh_score: number | null;
  condition_notes: string | null;
  flag_damage: boolean | null;
  flag_wrong_variant: boolean | null;
  flag_km_issue: boolean | null;
  flag_sold: boolean | null;
  verified_at: string | null;
  engine_type: string | null;
  price_badge: string | null;
  deal_score: number | null;
  source_type: string | null;
}

export default function JoshDealDeskPage() {
  const queryClient = useQueryClient();
  const [reviewCar, setReviewCar] = useState<CheapCar | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [queueFilter, setQueueFilter] = useState<"NEW" | "VERIFIED" | "REJECTED" | "ALL">("NEW");

  // Review form state
  const [variantOk, setVariantOk] = useState(true);
  const [kmOk, setKmOk] = useState(true);
  const [photosOk, setPhotosOk] = useState(true);
  const [stillActive, setStillActive] = useState(true);
  const [flagDamage, setFlagDamage] = useState(false);
  const [flagWrongVariant, setFlagWrongVariant] = useState(false);
  const [flagKmIssue, setFlagKmIssue] = useState(false);
  const [sellerType, setSellerType] = useState("Unknown");
  const [score, setScore] = useState(3);
  const [notes, setNotes] = useState("");

  const { data: cars, isLoading } = useQuery({
    queryKey: ["cheap-car-queue", queueFilter],
    queryFn: async () => {
      let q = supabase
        .from("cheap_car_queue")
        .select("*")
        .order("deal_score", { ascending: false, nullsFirst: false })
        .order("discount_pct", { ascending: true })
        .limit(50);

      if (queueFilter === "NEW") {
        q = q.in("status", ["NEW", "PRE_APPROVED"]).eq("josh_verified", false);
      } else if (queueFilter === "VERIFIED") {
        q = q.eq("status", "VERIFIED");
      } else if (queueFilter === "REJECTED") {
        q = q.eq("status", "REJECTED");
      }
      // ALL → no status filter

      const { data, error } = await q;
      if (error) throw error;
      return data as CheapCar[];
    },
    refetchInterval: queueFilter === "NEW" ? 30_000 : false,
  });

  const { data: stats } = useQuery({
    queryKey: ["cheap-car-stats"],
    queryFn: async () => {
      const [detected, reviewed, verified, rejected] = await Promise.all([
        supabase.from("cheap_car_queue").select("id", { count: "exact", head: true }),
        supabase.from("cheap_car_queue").select("id", { count: "exact", head: true }).in("status", ["VERIFIED", "REJECTED", "SOLD"]),
        supabase.from("cheap_car_queue").select("id", { count: "exact", head: true }).eq("status", "VERIFIED"),
        supabase.from("cheap_car_queue").select("id", { count: "exact", head: true }).eq("status", "REJECTED"),
      ]);
      return {
        detected: detected.count || 0,
        reviewed: reviewed.count || 0,
        verified: verified.count || 0,
        rejected: rejected.count || 0,
      };
    },
  });

  // Manual link submission
  const submitMutation = useMutation({
    mutationFn: async (url: string) => {
      const { data, error } = await supabase.functions.invoke("josh-scrape-listing", {
        body: { url, submitted_by: "josh" },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Scrape failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["cheap-car-queue"] });
      queryClient.invalidateQueries({ queryKey: ["cheap-car-stats"] });
      setManualUrl("");
      const ext = data.extracted;
      toast.success(
        `Added: ${ext.year || "?"} ${ext.make || "?"} ${ext.model || "?"} — ${ext.source}`,
        { description: ext.discount_pct ? `Market delta: ${ext.discount_pct.toFixed(1)}%` : undefined }
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Record<string, unknown>;
    }) => {
      const { error } = await supabase
        .from("cheap_car_queue")
        .update(updates)
        .eq("id", id);
      if (error) throw error;

      if (updates.status === "VERIFIED") {
        const car = reviewCar!;
        const joshScore = updates.josh_score as number;
        const isWellBelowMarket = car.price_badge?.toLowerCase().includes("well below");
        const shouldPromote = joshScore >= 4 || isWellBelowMarket;

        if (shouldPromote) {
          await supabase.from("verified_deals").insert({
            cheap_car_queue_id: id,
            make: car.make,
            model: car.model,
            variant: car.variant,
            year: car.year,
            km: car.km,
            price: car.price,
            market_price: car.market_price,
            discount_pct: car.discount_pct,
            listing_url: car.listing_url,
            location: car.location,
            seller_type: updates.seller_type as string || car.seller_type,
            josh_score: joshScore,
            condition_notes: updates.condition_notes as string,
            engine_type: car.engine_type,
          });

          // Surface on Trading Desk — Well Below Market always CODE_RED, others HIGH
          const tier = isWellBelowMarket ? "CODE_RED" : "HIGH";
          const listingId = car.listing_id || `josh-${id}`;
          await supabase.from("operator_opportunities").upsert({
            listing_id: listingId,
            listing_source: car.source || "josh_verified",
            source_url: car.listing_url,
            make: car.make,
            model: car.model,
            variant: car.variant,
            year: car.year,
            km: car.km,
            asking_price: car.price,
            tier,
            status: "new",
            best_under_buy: car.market_price && car.price ? car.market_price - car.price : null,
            best_expected_margin: car.market_price && car.price ? car.market_price - car.price : null,
            is_starred: true,
            motivation_signal: `Josh verified (score ${joshScore}/5)${isWellBelowMarket ? " · Well Below Market" : ""}`,
          }, { onConflict: "listing_id" });

          try {
            await supabase.functions.invoke("josh-deal-alert", {
              body: {
                year: car.year,
                make: car.make,
                model: car.model,
                variant: car.variant,
                price: car.price,
                market_price: car.market_price,
                discount_pct: car.discount_pct,
                km: car.km,
                location: car.location,
                seller_type: updates.seller_type || car.seller_type,
                score: updates.josh_score,
                listing_url: car.listing_url,
              },
            });
          } catch (e) {
            console.error("Alert send failed:", e);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cheap-car-queue"] });
      queryClient.invalidateQueries({ queryKey: ["cheap-car-stats"] });
      toast.success("Updated");
      closeReview();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openReview = (car: CheapCar) => {
    setReviewCar(car);
    setVariantOk(true);
    setKmOk(true);
    setPhotosOk(true);
    setStillActive(true);
    setFlagDamage(false);
    setFlagWrongVariant(false);
    setFlagKmIssue(false);
    setSellerType(car.seller_type || "Unknown");
    setScore(3);
    setNotes("");
  };

  const closeReview = () => setReviewCar(null);

  const handleVerify = () => {
    if (!reviewCar) return;
    updateMutation.mutate({
      id: reviewCar.id,
      updates: {
        status: "VERIFIED",
        josh_verified: true,
        josh_score: score,
        condition_notes: notes || null,
        flag_damage: flagDamage,
        flag_wrong_variant: flagWrongVariant,
        flag_km_issue: flagKmIssue,
        seller_type: sellerType,
        verified_at: new Date().toISOString(),
      },
    });
  };

  const handleReject = () => {
    if (!reviewCar) return;
    updateMutation.mutate({
      id: reviewCar.id,
      updates: {
        status: "REJECTED",
        josh_verified: false,
        condition_notes: notes || null,
        flag_damage: flagDamage,
        flag_wrong_variant: flagWrongVariant,
        flag_km_issue: flagKmIssue,
      },
    });
  };

  const handleMarkSold = () => {
    if (!reviewCar) return;
    updateMutation.mutate({
      id: reviewCar.id,
      updates: { status: "SOLD", flag_sold: true },
    });
  };

  const fmtPrice = (v: number | null) =>
    v ? `$${v.toLocaleString()}` : "—";
  const fmtKm = (v: number | null) =>
    v ? `${(v / 1000).toFixed(0)}k` : "—";
  const fmtDiscount = (v: number | null) =>
    v ? `${v > 0 ? "-" : ""}${Math.abs(v).toFixed(0)}%` : "—";

  const sourceLabel = (s: string | null) => {
    if (!s || s === "system") return null;
    if (s === "manual") return "Manual";
    return null;
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Josh Deal Desk</h1>
          <p className="text-muted-foreground">
            Verify cheap listings before they go to Dave
          </p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-3">
            {([
              { label: "Detected", value: stats.detected, color: "text-foreground", filter: "ALL" as const },
              { label: "Reviewed", value: stats.reviewed, color: "text-blue-500", filter: "ALL" as const },
              { label: "Verified", value: stats.verified, color: "text-emerald-500", filter: "VERIFIED" as const },
              { label: "Rejected", value: stats.rejected, color: "text-destructive", filter: "REJECTED" as const },
            ] as const).map((s) => (
              <Card
                key={s.label}
                className={`cursor-pointer transition-all hover:ring-2 hover:ring-primary/40 ${queueFilter === s.filter && s.filter !== "ALL" ? "ring-2 ring-primary" : ""}`}
                onClick={() => setQueueFilter(s.filter)}
              >
                <CardContent className="p-4 text-center">
                  <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Manual Link Submission */}
        <Card className="border-2 border-dashed border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="mb-2">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" />
                Add a Listing Manually
              </h3>
              <p className="text-xs text-muted-foreground ml-6">
                Paste any listing URL — Carsales, Autotrader, dealer site, Marketplace, auction
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://www.autotrader.com.au/car/..."
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualUrl.trim()) {
                    submitMutation.mutate(manualUrl.trim());
                  }
                }}
              />
              <Button
                disabled={!manualUrl.trim() || submitMutation.isPending}
                onClick={() => submitMutation.mutate(manualUrl.trim())}
                className="gap-1"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {submitMutation.isPending ? "Scraping…" : "Scrape & Add"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Queue Table */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !cars?.length ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <CheckCircle className="h-12 w-12 text-emerald-500 mb-4" />
              <h3 className="text-lg font-medium">Queue Clear</h3>
              <p className="text-muted-foreground">No new cheap listings to review.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Score</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Car</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Market</TableHead>
                  <TableHead>KM</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-[100px]">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cars.map((car) => {
                  const isWellBelow = car.price_badge?.toLowerCase().includes("well below");
                  return (
                  <TableRow
                    key={car.id}
                    className={`cursor-pointer hover:bg-accent/50 ${isWellBelow ? "bg-red-500/5 border-l-2 border-l-red-500" : ""}`}
                    onClick={() => openReview(car)}
                  >
                    <TableCell>
                      {car.deal_score != null ? (
                        <Badge
                          variant={car.deal_score >= 10 ? "default" : "secondary"}
                          className={
                            car.deal_score >= 12
                              ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/30 font-mono"
                              : car.deal_score >= 8
                              ? "bg-blue-500/20 text-blue-600 border-blue-500/30 font-mono"
                              : "font-mono"
                          }
                        >
                          {car.deal_score}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-mono">
                        {fmtDiscount(car.discount_pct)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {car.year} {car.make} {car.model}
                      {car.variant && <span className="text-muted-foreground ml-1 text-xs">{car.variant}</span>}
                      {isWellBelow && (
                        <Badge className="ml-2 bg-destructive/15 text-destructive border-destructive/30 text-[10px] py-0">
                          🔴 Well Below Market
                        </Badge>
                      )}
                      {!isWellBelow && car.price_badge && (
                        <Badge variant="outline" className="ml-2 text-[10px] py-0">
                          {car.price_badge}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono">{fmtPrice(car.price)}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{fmtPrice(car.market_price)}</TableCell>
                    <TableCell>{fmtKm(car.km)}</TableCell>
                    <TableCell className="text-sm">
                      <span className="capitalize">{car.source || "—"}</span>
                      {sourceLabel(car.source_type) && (
                        <Badge variant="outline" className="ml-1 text-[10px] py-0 px-1">
                          {sourceLabel(car.source_type)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{car.location || "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openReview(car); }}>
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Review Modal */}
      <Dialog open={!!reviewCar} onOpenChange={() => closeReview()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Review: {reviewCar?.year} {reviewCar?.make} {reviewCar?.model} {reviewCar?.variant}
            </DialogTitle>
          </DialogHeader>

          {reviewCar && (
            <div className="space-y-5">
              {/* Listing Link — TOP of modal so Josh always sees it */}
              {reviewCar.listing_url ? (
                <Button asChild className="w-full" size="lg">
                  <a
                    href={reviewCar.listing_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open Listing
                  </a>
                </Button>
              ) : (
                <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  No direct listing URL stored for this car.
                </div>
              )}

              {/* Vehicle Summary */}
              <div className="grid grid-cols-2 gap-3 p-4 bg-muted rounded-lg text-sm">
                <div><span className="text-muted-foreground">Price:</span> <span className="font-mono font-semibold">{fmtPrice(reviewCar.price)}</span></div>
                <div><span className="text-muted-foreground">Market:</span> <span className="font-mono">{fmtPrice(reviewCar.market_price)}</span></div>
                <div><span className="text-muted-foreground">Discount:</span> <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">{fmtDiscount(reviewCar.discount_pct)}</Badge></div>
                <div><span className="text-muted-foreground">Deal Score:</span>{" "}
                  <Badge variant={reviewCar.deal_score && reviewCar.deal_score >= 10 ? "default" : "secondary"} className="font-mono">
                    {reviewCar.deal_score ?? "—"}
                  </Badge>
                </div>
                <div><span className="text-muted-foreground">KM:</span> {fmtKm(reviewCar.km)}</div>
                <div><span className="text-muted-foreground">Location:</span> {reviewCar.location || "—"}</div>
                <div><span className="text-muted-foreground">Engine:</span> {reviewCar.engine_type || "—"}</div>
                <div><span className="text-muted-foreground">Source:</span> <span className="capitalize">{reviewCar.source}</span>{sourceLabel(reviewCar.source_type) && ` (${sourceLabel(reviewCar.source_type)})`}</div>
                <div><span className="text-muted-foreground">Badge:</span> {reviewCar.price_badge || "—"}</div>
                <div><span className="text-muted-foreground">Detected:</span> {formatDistanceToNow(new Date(reviewCar.detected_at), { addSuffix: true })}</div>
              </div>

              {/* Checklist */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Verification Checklist</h4>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={variantOk} onCheckedChange={(c) => setVariantOk(!!c)} />
                    Variant looks correct
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={kmOk} onCheckedChange={(c) => setKmOk(!!c)} />
                    KM looks reasonable
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={photosOk} onCheckedChange={(c) => setPhotosOk(!!c)} />
                    Photos look clean
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={stillActive} onCheckedChange={(c) => setStillActive(!!c)} />
                    Listing still active
                  </label>
                </div>
              </div>

              {/* Flags */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Flags
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={flagDamage} onCheckedChange={(c) => setFlagDamage(!!c)} />
                    Possible damage
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={flagWrongVariant} onCheckedChange={(c) => setFlagWrongVariant(!!c)} />
                    Wrong variant
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={flagKmIssue} onCheckedChange={(c) => setFlagKmIssue(!!c)} />
                    KM problem
                  </label>
                </div>
              </div>

              {/* Seller + Score */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-semibold">Seller Type</label>
                  <Select value={sellerType} onValueChange={setSellerType}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Dealer">Dealer</SelectItem>
                      <SelectItem value="Private">Private</SelectItem>
                      <SelectItem value="Unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-semibold">Confidence Score</label>
                  <Select value={String(score)} onValueChange={(v) => setScore(Number(v))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 — Junk</SelectItem>
                      <SelectItem value="2">2 — Weak</SelectItem>
                      <SelectItem value="3">3 — Maybe</SelectItem>
                      <SelectItem value="4">4 — Strong deal</SelectItem>
                      <SelectItem value="5">5 — Call immediately</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-sm font-semibold">Notes</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional observations..."
                  className="mt-1"
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button
              variant="destructive"
              onClick={handleMarkSold}
              disabled={updateMutation.isPending}
              className="gap-1"
            >
              <Ban className="h-4 w-4" />
              Sold
            </Button>
            <Button
              variant="outline"
              onClick={handleReject}
              disabled={updateMutation.isPending}
              className="gap-1"
            >
              <XCircle className="h-4 w-4" />
              Reject
            </Button>
            <Button
              onClick={handleVerify}
              disabled={updateMutation.isPending}
              className="gap-1"
            >
              <CheckCircle className="h-4 w-4" />
              {score >= 4 ? "Verify & Alert Dave" : "Verify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
