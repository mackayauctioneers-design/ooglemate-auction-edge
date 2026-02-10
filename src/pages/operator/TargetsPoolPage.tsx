import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useAccounts } from "@/hooks/useAccounts";
import { toast } from "sonner";
import {
  Target,
  RefreshCw,
  Loader2,
  Info,
  Play,
  Pause,
  XCircle,
  Eye,
} from "lucide-react";

type CandidateStatus = "candidate" | "active" | "paused" | "retired";

const statusColors: Record<CandidateStatus, string> = {
  candidate: "bg-blue-500/10 text-blue-700 border-blue-300",
  active: "bg-green-500/10 text-green-700 border-green-300",
  paused: "bg-yellow-500/10 text-yellow-700 border-yellow-300",
  retired: "bg-muted text-muted-foreground border-muted",
};

export default function TargetsPoolPage() {
  const { data: accounts } = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [makeFilter, setMakeFilter] = useState("");
  const queryClient = useQueryClient();

  if (!accountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    setAccountId(mackay?.id || accounts[0].id);
  }

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["target-candidates", accountId, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("sales_target_candidates")
        .select("*")
        .eq("account_id", accountId)
        .order("target_score", { ascending: false })
        .limit(200);

      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!accountId,
  });

  const buildMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "build-sales-targets",
        { body: { account_id: accountId } }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["target-candidates"] });
      toast.success(
        `Built ${data.candidates_built} candidates from ${data.total_sales_analysed} sales records`
      );
    },
    onError: (err: any) => toast.error(err.message),
  });

  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: CandidateStatus;
    }) => {
      const { error } = await supabase
        .from("sales_target_candidates")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["target-candidates"] });
    },
  });

  const filtered = (candidates || []).filter((c: any) => {
    const matchesMake = makeFilter
      ? c.make?.toLowerCase().includes(makeFilter.toLowerCase()) ||
        c.model?.toLowerCase().includes(makeFilter.toLowerCase())
      : true;
    const matchesType = typeFilter === "all" || c.fingerprint_type === typeFilter;
    return matchesMake && matchesType;
  });

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Target className="h-6 w-6" />
              Targets Pool
            </h1>
            <p className="text-sm text-muted-foreground">
              These targets are derived from proven sales outcomes.
            </p>
          </div>
          <div className="flex gap-2">
            <AccountSelector value={accountId} onChange={setAccountId} />
            <Button
              onClick={() => buildMutation.mutate()}
              disabled={buildMutation.isPending || !accountId}
            >
              {buildMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Rebuild Candidates
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center">
          <Input
            placeholder="Filter by make/model…"
            value={makeFilter}
            onChange={(e) => setMakeFilter(e.target.value)}
            className="w-64"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="candidate">Candidate</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="core">Core (Repeatable)</SelectItem>
              <SelectItem value="outcome">Outcome (Watch)</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {filtered.length} candidates
          </span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !filtered.length ? (
          <div className="text-center py-12 text-muted-foreground">
            <Target className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No candidates yet</p>
            <p className="text-sm">
              Upload sales data and click "Rebuild Candidates" to generate
              targets from your sales truth.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Score</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Make / Model</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Median Clear</TableHead>
                  <TableHead className="text-right">Median Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scoring</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div
                        className={`inline-flex items-center justify-center w-10 h-10 rounded-lg font-bold text-lg ${
                          c.target_score >= 70
                            ? "bg-green-500/10 text-green-700"
                            : c.target_score >= 40
                            ? "bg-yellow-500/10 text-yellow-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {c.target_score}
                      </div>
                    </TableCell>
                    <TableCell>
                      {c.fingerprint_type === "outcome" ? (
                        <Badge variant="outline" className="bg-purple-500/10 text-purple-700 border-purple-300 text-xs">
                          <Eye className="h-3 w-3 mr-1" />
                          Outcome
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-300 text-xs">
                          Core
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {c.make} {c.model}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {c.variant || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {c.sales_count}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {c.median_days_to_clear != null
                        ? `${c.median_days_to_clear}d`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {c.median_sale_price != null
                        ? `$${c.median_sale_price.toLocaleString()}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          statusColors[c.status as CandidateStatus] || ""
                        }
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="iconSm">
                            <Info className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          className="max-w-xs text-xs"
                        >
                          <pre className="whitespace-pre-wrap">
                            {JSON.stringify(c.score_reasons, null, 2)}
                          </pre>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {c.status !== "active" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="iconSm"
                                onClick={() =>
                                  statusMutation.mutate({
                                    id: c.id,
                                    status: "active",
                                  })
                                }
                              >
                                <Play className="h-4 w-4 text-green-600" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Activate</TooltipContent>
                          </Tooltip>
                        )}
                        {c.status !== "paused" && c.status !== "retired" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="iconSm"
                                onClick={() =>
                                  statusMutation.mutate({
                                    id: c.id,
                                    status: "paused",
                                  })
                                }
                              >
                                <Pause className="h-4 w-4 text-yellow-600" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Pause</TooltipContent>
                          </Tooltip>
                        )}
                        {c.status !== "retired" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="iconSm"
                                onClick={() =>
                                  statusMutation.mutate({
                                    id: c.id,
                                    status: "retired",
                                  })
                                }
                              >
                                <XCircle className="h-4 w-4 text-destructive" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Retire</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </OperatorLayout>
  );
}
