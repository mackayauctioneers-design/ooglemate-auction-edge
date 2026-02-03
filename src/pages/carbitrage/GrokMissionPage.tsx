import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Play,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useAccounts } from "@/hooks/useAccounts";

interface Mission {
  id: string;
  account_id: string;
  name: string;
  created_by: string;
  status: string;
  criteria: {
    make?: string;
    model?: string;
    variant?: string;
    year_min?: number;
    year_max?: number;
    km_max?: number;
  };
  target_urls: string[];
  results_count: number;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

interface GrokSafeUrl {
  id: string;
  domain: string;
  url_canonical: string;
}

export default function GrokMissionPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const queryClient = useQueryClient();

  // Create form state
  const [missionName, setMissionName] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [variant, setVariant] = useState("");
  const [yearMin, setYearMin] = useState("");
  const [yearMax, setYearMax] = useState("");
  const [kmMax, setKmMax] = useState("");
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);

  // Set default account when loaded
  if (!selectedAccountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    if (mackay) setSelectedAccountId(mackay.id);
    else setSelectedAccountId(accounts[0].id);
  }

  const { data: missions, isLoading } = useQuery({
    queryKey: ["grok-missions", selectedAccountId],
    queryFn: async () => {
      if (!selectedAccountId) return [];
      const { data, error } = await supabase
        .from("grok_missions")
        .select("*")
        .eq("account_id", selectedAccountId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Mission[];
    },
    enabled: !!selectedAccountId,
  });

  const { data: grokSafeUrls } = useQuery({
    queryKey: ["grok-safe-urls"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dealer_url_queue")
        .select("id, domain, url_canonical")
        .eq("grok_class", "grok_safe")
        .order("domain");
      if (error) throw error;
      return data as GrokSafeUrl[];
    },
  });

  const createMissionMutation = useMutation({
    mutationFn: async () => {
      if (!missionName.trim() || !make.trim()) {
        throw new Error("Mission name and make are required");
      }
      if (!selectedUrls.length) {
        throw new Error("Select at least one target URL");
      }

      const criteria: Mission["criteria"] = {
        make: make.trim(),
      };
      if (model.trim()) criteria.model = model.trim();
      if (variant.trim()) criteria.variant = variant.trim();
      if (yearMin) criteria.year_min = parseInt(yearMin);
      if (yearMax) criteria.year_max = parseInt(yearMax);
      if (kmMax) criteria.km_max = parseInt(kmMax);

      const { data, error } = await supabase
        .from("grok_missions")
        .insert({
          account_id: selectedAccountId,
          name: missionName.trim(),
          criteria,
          target_urls: selectedUrls,
          created_by: "josh",
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grok-missions"] });
      toast.success("Mission created");
      closeCreateDialog();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const runMissionMutation = useMutation({
    mutationFn: async (missionId: string) => {
      const { data, error } = await supabase.functions.invoke("run-grok-mission", {
        body: { mission_id: missionId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["grok-missions"] });
      toast.success(`Mission complete: ${data?.results_count || 0} results`);
    },
    onError: (err: any) => {
      toast.error(`Mission failed: ${err.message}`);
    },
  });

  const closeCreateDialog = () => {
    setShowCreateDialog(false);
    setMissionName("");
    setMake("");
    setModel("");
    setVariant("");
    setYearMin("");
    setYearMax("");
    setKmMax("");
    setSelectedUrls([]);
  };

  const toggleUrl = (urlId: string) => {
    setSelectedUrls((prev) =>
      prev.includes(urlId) ? prev.filter((id) => id !== urlId) : [...prev, urlId]
    );
  };

  const selectAllUrls = () => {
    if (grokSafeUrls) {
      setSelectedUrls(grokSafeUrls.map((u) => u.id));
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { icon: React.ReactNode; className: string }> = {
      pending: {
        icon: <Clock className="h-3 w-3 mr-1" />,
        className: "bg-muted text-muted-foreground",
      },
      running: {
        icon: <Loader2 className="h-3 w-3 mr-1 animate-spin" />,
        className: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      },
      completed: {
        icon: <CheckCircle className="h-3 w-3 mr-1" />,
        className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      },
      failed: {
        icon: <XCircle className="h-3 w-3 mr-1" />,
        className: "bg-red-500/10 text-red-600 border-red-500/20",
      },
    };
    const style = styles[status] || styles.pending;
    return (
      <Badge className={style.className}>
        {style.icon}
        {status}
      </Badge>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="h-6 w-6" />
              Grok Mission Runner
            </h1>
            <p className="text-muted-foreground">
              AI-powered inventory scans on preflighted dealer URLs
            </p>
          </div>
          <div className="flex gap-2">
            <AccountSelector
              value={selectedAccountId}
              onChange={setSelectedAccountId}
            />
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New Mission
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : !missions?.length ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <Zap className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No missions yet</h3>
              <p className="text-muted-foreground max-w-md mt-1">
                Create a Grok mission to scan dealer inventory pages for specific vehicles.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {missions.map((mission) => (
              <Card key={mission.id} className="hover:bg-accent/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getStatusBadge(mission.status)}
                        <h3 className="font-semibold">{mission.name}</h3>
                      </div>

                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {mission.criteria.make} {mission.criteria.model || ""}{" "}
                          {mission.criteria.variant || ""}
                        </span>
                        {mission.criteria.year_min && (
                          <span>
                            {mission.criteria.year_min}
                            {mission.criteria.year_max ? `-${mission.criteria.year_max}` : "+"}
                          </span>
                        )}
                        {mission.criteria.km_max && (
                          <span>{"<"}{(mission.criteria.km_max / 1000).toFixed(0)}k km</span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{mission.target_urls.length} target URLs</span>
                        <span>{mission.results_count} results</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true })}
                        </span>
                      </div>

                      {mission.error && (
                        <p className="text-xs text-destructive">{mission.error}</p>
                      )}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      {mission.status === "pending" && (
                        <Button
                          size="sm"
                          onClick={() => runMissionMutation.mutate(mission.id)}
                          disabled={runMissionMutation.isPending}
                        >
                          <Play className="h-4 w-4 mr-1" />
                          Run
                        </Button>
                      )}
                      {mission.status === "completed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => runMissionMutation.mutate(mission.id)}
                          disabled={runMissionMutation.isPending}
                        >
                          <Play className="h-4 w-4 mr-1" />
                          Re-run
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

      {/* Create Mission Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Grok Mission</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Mission Name</label>
              <Input
                value={missionName}
                onChange={(e) => setMissionName(e.target.value)}
                placeholder="e.g. Hilux SR5 Search"
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">Make *</label>
                <Input
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  placeholder="Toyota"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Model</label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Hilux"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Variant</label>
                <Input
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                  placeholder="SR5"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">Year Min</label>
                <Input
                  value={yearMin}
                  onChange={(e) => setYearMin(e.target.value)}
                  placeholder="2020"
                  className="mt-1"
                  type="number"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Year Max</label>
                <Input
                  value={yearMax}
                  onChange={(e) => setYearMax(e.target.value)}
                  placeholder="2024"
                  className="mt-1"
                  type="number"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Max KM</label>
                <Input
                  value={kmMax}
                  onChange={(e) => setKmMax(e.target.value)}
                  placeholder="100000"
                  className="mt-1"
                  type="number"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">
                  Target URLs ({selectedUrls.length} selected)
                </label>
                <Button variant="ghost" size="sm" onClick={selectAllUrls}>
                  Select All
                </Button>
              </div>
              <div className="border rounded-lg max-h-48 overflow-y-auto">
                {!grokSafeUrls?.length ? (
                  <p className="p-4 text-sm text-muted-foreground text-center">
                    No grok_safe URLs available. Add and preflight dealer URLs first.
                  </p>
                ) : (
                  grokSafeUrls.map((url) => (
                    <div
                      key={url.id}
                      className="flex items-center gap-3 p-2 hover:bg-accent/50 cursor-pointer"
                      onClick={() => toggleUrl(url.id)}
                    >
                      <Checkbox checked={selectedUrls.includes(url.id)} />
                      <span className="text-sm">{url.domain}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeCreateDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => createMissionMutation.mutate()}
              disabled={createMissionMutation.isPending}
            >
              Create Mission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
