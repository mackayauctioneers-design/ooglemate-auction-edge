import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Eye,
  Plus,
  RefreshCw,
  Pause,
  Play,
  XCircle,
  ExternalLink,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useAccounts } from "@/hooks/useAccounts";

interface WatchItem {
  id: string;
  account_id: string;
  created_by: string;
  assigned_to: string;
  watch_type: string;
  source: string;
  url: string;
  domain: string | null;
  status: string;
  reason_close: string | null;
  trigger_type: string;
  trigger_value: string;
  last_scan_at: string | null;
  last_snapshot: Record<string, any> | null;
  notes: string | null;
  created_at: string;
}

const SOURCES = [
  "autograb",
  "carsales",
  "gumtree",
  "carsguide",
  "dealer_site",
  "pickles",
  "manheim",
  "grays",
  "other",
];

const TRIGGER_TYPES = [
  { value: "price_under", label: "Price drops under $X" },
  { value: "price_drop_amount", label: "Price drops by $X" },
  { value: "price_drop_percent", label: "Price drops by X%" },
  { value: "days_listed_over", label: "Listed over X days" },
  { value: "status_change", label: "Status changes" },
];

export default function WatchlistPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [filter, setFilter] = useState<"active" | "paused" | "closed" | "all">("active");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const queryClient = useQueryClient();

  // Add form state
  const [newUrl, setNewUrl] = useState("");
  const [newWatchType, setNewWatchType] = useState<"single_listing" | "inventory_list">("single_listing");
  const [newSource, setNewSource] = useState("other");
  const [newTriggerType, setNewTriggerType] = useState("price_drop_percent");
  const [newTriggerValue, setNewTriggerValue] = useState("10");
  const [newNotes, setNewNotes] = useState("");

  // Set default account when loaded
  if (!selectedAccountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    if (mackay) setSelectedAccountId(mackay.id);
    else setSelectedAccountId(accounts[0].id);
  }

  const { data: watchItems, isLoading } = useQuery({
    queryKey: ["watchlist", selectedAccountId, filter],
    queryFn: async () => {
      if (!selectedAccountId) return [];
      let query = supabase
        .from("url_watchlist")
        .select("*")
        .eq("account_id", selectedAccountId)
        .order("created_at", { ascending: false });

      if (filter !== "all") {
        query = query.eq("status", filter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as WatchItem[];
    },
    enabled: !!selectedAccountId,
  });

  const addWatchMutation = useMutation({
    mutationFn: async () => {
      // Extract domain from URL
      let domain = "";
      try {
        domain = new URL(newUrl).hostname;
      } catch {}

      const { error } = await supabase.from("url_watchlist").insert({
        account_id: selectedAccountId,
        watch_type: newWatchType,
        source: newSource,
        url: newUrl.trim(),
        domain,
        trigger_type: newTriggerType,
        trigger_value: newTriggerValue,
        notes: newNotes.trim() || null,
        created_by: "josh",
        assigned_to: "josh",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      toast.success("Watch added");
      closeAddDialog();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      reasonClose,
    }: {
      id: string;
      status: string;
      reasonClose?: string;
    }) => {
      const update: Record<string, any> = { status };
      if (reasonClose) update.reason_close = reasonClose;

      const { error } = await supabase
        .from("url_watchlist")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      toast.success("Status updated");
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (watchId: string) => {
      const { data, error } = await supabase.functions.invoke("watch-scan", {
        body: { watch_id: watchId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      if (data?.event_type) {
        toast.success(`Scan complete: ${data.event_type}`);
      } else {
        toast.success("Scan complete - no changes detected");
      }
    },
    onError: (err: any) => {
      toast.error(`Scan failed: ${err.message}`);
    },
  });

  const closeAddDialog = () => {
    setShowAddDialog(false);
    setNewUrl("");
    setNewWatchType("single_listing");
    setNewSource("other");
    setNewTriggerType("price_drop_percent");
    setNewTriggerValue("10");
    setNewNotes("");
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      paused: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      closed: "bg-muted text-muted-foreground",
    };
    return colors[status] || "bg-muted";
  };

  const getTriggerLabel = (type: string, value: string) => {
    switch (type) {
      case "price_under":
        return `< $${parseInt(value).toLocaleString()}`;
      case "price_drop_amount":
        return `↓ $${parseInt(value).toLocaleString()}`;
      case "price_drop_percent":
        return `↓ ${value}%`;
      case "days_listed_over":
        return `> ${value} days`;
      case "status_change":
        return "Status change";
      default:
        return value;
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Eye className="h-6 w-6" />
              Watchlist
            </h1>
            <p className="text-muted-foreground">
              Near-miss URLs with price/status triggers
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AccountSelector
              value={selectedAccountId}
              onChange={setSelectedAccountId}
            />
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Watch
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          {(["active", "paused", "closed", "all"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : !watchItems?.length ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <Eye className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No watch items</h3>
              <p className="text-muted-foreground max-w-md mt-1">
                Add a near-miss URL to start monitoring for price drops or status changes.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {watchItems.map((item) => (
              <Card key={item.id} className="hover:bg-accent/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={getStatusBadge(item.status)}>
                          {item.status}
                        </Badge>
                        <Badge variant="outline">
                          {item.watch_type === "single_listing" ? "Listing" : "Inventory"}
                        </Badge>
                        <Badge variant="secondary">
                          {getTriggerLabel(item.trigger_type, item.trigger_value)}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {item.source}
                        </span>
                      </div>

                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline inline-flex items-center gap-1 truncate max-w-xl"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        {item.domain || item.url}
                      </a>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Added {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                        </span>
                        {item.last_scan_at && (
                          <span>
                            Last scan: {formatDistanceToNow(new Date(item.last_scan_at), { addSuffix: true })}
                          </span>
                        )}
                        {item.last_snapshot?.price && (
                          <span className="font-medium text-foreground">
                            Current: ${item.last_snapshot.price.toLocaleString()}
                          </span>
                        )}
                      </div>

                      {item.notes && (
                        <p className="text-xs text-muted-foreground italic">
                          {item.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      {item.status === "active" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => scanMutation.mutate(item.id)}
                            disabled={scanMutation.isPending}
                          >
                            <RefreshCw className={`h-4 w-4 mr-1 ${scanMutation.isPending ? "animate-spin" : ""}`} />
                            Scan
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              updateStatusMutation.mutate({ id: item.id, status: "paused" })
                            }
                          >
                            <Pause className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {item.status === "paused" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateStatusMutation.mutate({ id: item.id, status: "active" })
                          }
                        >
                          <Play className="h-4 w-4 mr-1" />
                          Resume
                        </Button>
                      )}
                      {item.status !== "closed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            updateStatusMutation.mutate({
                              id: item.id,
                              status: "closed",
                              reasonClose: "Manually closed",
                            })
                          }
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add Watch Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add to Watchlist</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">URL</label>
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://..."
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Type</label>
                <Select
                  value={newWatchType}
                  onValueChange={(v: "single_listing" | "inventory_list") => setNewWatchType(v)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single_listing">Single Listing</SelectItem>
                    <SelectItem value="inventory_list">Inventory Page</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Source</label>
                <Select value={newSource} onValueChange={setNewSource}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Trigger</label>
                <Select value={newTriggerType} onValueChange={setNewTriggerType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Value</label>
                <Input
                  value={newTriggerValue}
                  onChange={(e) => setNewTriggerValue(e.target.value)}
                  placeholder="e.g. 10 or 5000"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Why are you watching this?"
                className="mt-1"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeAddDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => addWatchMutation.mutate()}
              disabled={!newUrl.trim() || addWatchMutation.isPending}
            >
              Add Watch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
