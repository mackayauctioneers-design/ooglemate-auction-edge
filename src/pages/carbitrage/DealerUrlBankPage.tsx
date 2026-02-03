import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ExternalLink,
  Globe,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface DealerUrl {
  id: string;
  url_raw: string;
  url_canonical: string | null;
  domain: string | null;
  dealer_slug: string | null;
  intent: string | null;
  method: string | null;
  priority: string | null;
  status: string;
  fail_reason: string | null;
  grok_class: string | null;
  last_run_at: string | null;
  created_at: string;
}

export default function DealerUrlBankPage() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newUrls, setNewUrls] = useState("");
  const [filter, setFilter] = useState<"all" | "grok_safe" | "needs_review" | "blocked">("all");
  const queryClient = useQueryClient();

  const { data: urls, isLoading } = useQuery({
    queryKey: ["dealer-url-bank", filter],
    queryFn: async () => {
      let query = supabase
        .from("dealer_url_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (filter === "grok_safe") {
        query = query.eq("grok_class", "grok_safe");
      } else if (filter === "needs_review") {
        query = query.eq("grok_class", "needs_review");
      } else if (filter === "blocked") {
        query = query.in("grok_class", ["blocked_waf", "invalid"]);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as DealerUrl[];
    },
  });

  const addUrlsMutation = useMutation({
    mutationFn: async (urlsText: string) => {
      const urlList = urlsText
        .split("\n")
        .map((u) => u.trim())
        .filter((u) => u && u.startsWith("http"));

      if (!urlList.length) throw new Error("No valid URLs found");

      const rows = urlList.map((url) => {
        let domain = "";
        try {
          domain = new URL(url).hostname;
        } catch {}
        // Generate a dealer_slug from the domain
        const dealer_slug = domain.replace(/\.(com|com\.au|net|org|au)$/g, "").replace(/\./g, "-");
        return {
          url_raw: url,
          url_canonical: url,
          domain,
          dealer_slug,
          status: "queued",
          intent: "inventory",
        };
      });

      const { error } = await supabase.from("dealer_url_queue").insert(rows);
      if (error) throw error;
      return urlList.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["dealer-url-bank"] });
      toast.success(`Added ${count} URL(s)`);
      setShowAddDialog(false);
      setNewUrls("");
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const preflightMutation = useMutation({
    mutationFn: async (urlId: string) => {
      const { data, error } = await supabase.functions.invoke("dealer-url-preflight", {
        body: { url_id: urlId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dealer-url-bank"] });
      toast.success(`Preflight: ${data?.grok_class || "complete"}`);
    },
    onError: (err: any) => {
      toast.error(`Preflight failed: ${err.message}`);
    },
  });

  const preflightAllMutation = useMutation({
    mutationFn: async () => {
      // Get all queued URLs without grok_class
      const { data: pendingUrls } = await supabase
        .from("dealer_url_queue")
        .select("id")
        .is("grok_class", null)
        .eq("status", "queued")
        .limit(20);

      if (!pendingUrls?.length) {
        throw new Error("No URLs pending preflight");
      }

      // Run preflight for each (sequentially to avoid rate limits)
      let success = 0;
      for (const url of pendingUrls) {
        try {
          await supabase.functions.invoke("dealer-url-preflight", {
            body: { url_id: url.id },
          });
          success++;
        } catch {}
      }
      return success;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["dealer-url-bank"] });
      toast.success(`Preflighted ${count} URLs`);
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const getGrokClassBadge = (grokClass: string | null) => {
    if (!grokClass) return <Badge variant="outline">Pending</Badge>;
    
    const styles: Record<string, { icon: React.ReactNode; className: string }> = {
      grok_safe: {
        icon: <CheckCircle className="h-3 w-3 mr-1" />,
        className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      },
      needs_review: {
        icon: <AlertTriangle className="h-3 w-3 mr-1" />,
        className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      },
      blocked_waf: {
        icon: <XCircle className="h-3 w-3 mr-1" />,
        className: "bg-red-500/10 text-red-600 border-red-500/20",
      },
      invalid: {
        icon: <XCircle className="h-3 w-3 mr-1" />,
        className: "bg-muted text-muted-foreground",
      },
    };

    const style = styles[grokClass] || { icon: null, className: "bg-muted" };
    return (
      <Badge className={style.className}>
        {style.icon}
        {grokClass.replace("_", " ")}
      </Badge>
    );
  };

  const stats = {
    total: urls?.length || 0,
    grok_safe: urls?.filter((u) => u.grok_class === "grok_safe").length || 0,
    needs_review: urls?.filter((u) => u.grok_class === "needs_review").length || 0,
    blocked: urls?.filter((u) => ["blocked_waf", "invalid"].includes(u.grok_class || "")).length || 0,
    pending: urls?.filter((u) => !u.grok_class).length || 0,
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="h-6 w-6" />
              Dealer URL Bank
            </h1>
            <p className="text-muted-foreground">
              Inventory pages preflighted for Grok missions
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => preflightAllMutation.mutate()}
              disabled={preflightAllMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${preflightAllMutation.isPending ? "animate-spin" : ""}`} />
              Preflight Batch
            </Button>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add URLs
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-5 gap-4">
          <Card className="cursor-pointer hover:bg-accent/50" onClick={() => setFilter("all")}>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-accent/50" onClick={() => setFilter("grok_safe")}>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-emerald-600">{stats.grok_safe}</div>
              <div className="text-xs text-muted-foreground">Grok Safe</div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-accent/50" onClick={() => setFilter("needs_review")}>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{stats.needs_review}</div>
              <div className="text-xs text-muted-foreground">Needs Review</div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-accent/50" onClick={() => setFilter("blocked")}>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.blocked}</div>
              <div className="text-xs text-muted-foreground">Blocked</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-muted-foreground">{stats.pending}</div>
              <div className="text-xs text-muted-foreground">Pending</div>
            </CardContent>
          </Card>
        </div>

        {/* URL Table */}
        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Grok Class</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {urls?.map((url) => (
                  <TableRow key={url.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <span className="font-medium">{url.domain || "Unknown"}</span>
                        <a
                          href={url.url_canonical || url.url_raw}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1 max-w-xs truncate"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {url.url_canonical || url.url_raw}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>{getGrokClassBadge(url.grok_class)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{url.status}</Badge>
                      {url.fail_reason && (
                        <p className="text-xs text-destructive mt-1">{url.fail_reason}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {url.last_run_at
                        ? formatDistanceToNow(new Date(url.last_run_at), { addSuffix: true })
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => preflightMutation.mutate(url.id)}
                        disabled={preflightMutation.isPending}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* Add URLs Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Dealer URLs</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Paste inventory page URLs (one per line). Do not add homepage URLs.
            </p>
            <textarea
              value={newUrls}
              onChange={(e) => setNewUrls(e.target.value)}
              placeholder="https://dealer.com.au/used-cars&#10;https://another-dealer.com/inventory"
              className="w-full h-40 p-3 border rounded-md text-sm font-mono"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => addUrlsMutation.mutate(newUrls)}
              disabled={!newUrls.trim() || addUrlsMutation.isPending}
            >
              Add URLs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
