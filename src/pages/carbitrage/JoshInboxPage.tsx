import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  CheckCircle,
  Eye,
  XCircle,
  ExternalLink,
  Clock,
  MapPin,
  Send,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useAccounts } from "@/hooks/useAccounts";

interface Candidate {
  id: string;
  account_id: string;
  url_canonical: string;
  domain: string;
  dealer_slug: string;
  intent: string;
  priority: string;
  status: string;
  grok_class: string | null;
  result_summary: Record<string, unknown> | null;
  fail_reason: string | null;
  created_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
}

type DealerQueueUpdate = {
  status?: string;
  result_summary?: { notes: string } | null;
  fail_reason?: string | null;
};

export default function JoshInboxPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const queryClient = useQueryClient();

  // Action dialogs
  const [actionCandidate, setActionCandidate] = useState<Candidate | null>(null);
  const [actionType, setActionType] = useState<"watch" | "reject" | "alert" | null>(null);
  const [notes, setNotes] = useState("");
  const [alertReason, setAlertReason] = useState("");

  // Set default account when loaded (in useEffect to avoid render-loop)
  useEffect(() => {
    if (selectedAccountId) return;
    if (!accounts?.length) return;
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    setSelectedAccountId(mackay?.id ?? accounts[0].id);
  }, [accounts, selectedAccountId]);

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["josh-inbox", selectedAccountId],
    queryFn: async () => {
      if (!selectedAccountId) return [];
      const { data, error } = await supabase
        .from("dealer_url_queue")
        .select("*")
        .eq("account_id", selectedAccountId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as Candidate[];
    },
    enabled: !!selectedAccountId,
  });

  const updateCandidateMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      notes,
      rejectReason,
    }: {
      id: string;
      status: string;
      notes?: string;
      rejectReason?: string;
    }) => {
      const update: DealerQueueUpdate = { status };
      if (notes) update.result_summary = { notes };
      if (rejectReason) update.fail_reason = rejectReason;

      const { error } = await supabase
        .from("dealer_url_queue")
        .update(update as Record<string, unknown>)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["josh-inbox", selectedAccountId] });
      toast.success("Candidate updated");
      closeDialog();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const sendAlertMutation = useMutation({
    mutationFn: async ({
      candidate,
      reason,
    }: {
      candidate: Candidate;
      reason: string;
    }) => {
      const { error } = await supabase.from("josh_alerts").insert({
        account_id: selectedAccountId,
        created_by: "josh",
        candidate_queue_id: candidate.id,
        url: candidate.url_canonical,
        title: `${candidate.dealer_slug} - ${candidate.domain}`,
        reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alert sent to Dave");
      closeDialog();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const closeDialog = () => {
    setActionCandidate(null);
    setActionType(null);
    setNotes("");
    setAlertReason("");
  };

  const handleAction = (candidate: Candidate, type: "validate" | "watch" | "reject" | "alert") => {
    if (type === "validate") {
      updateCandidateMutation.mutate({ id: candidate.id, status: "validated" });
    } else {
      setActionCandidate(candidate);
      setActionType(type);
    }
  };

  const submitAction = () => {
    if (!actionCandidate) return;

    if (actionType === "watch") {
      if (!notes.trim()) {
        toast.error("Notes are required for Watch");
        return;
      }
      updateCandidateMutation.mutate({
        id: actionCandidate.id,
        status: "watch",
        notes: notes.trim(),
      });
    } else if (actionType === "reject") {
      if (!notes.trim()) {
        toast.error("Reject reason is required");
        return;
      }
      updateCandidateMutation.mutate({
        id: actionCandidate.id,
        status: "rejected",
        rejectReason: notes.trim(),
      });
    } else if (actionType === "alert") {
      if (!alertReason.trim()) {
        toast.error("Reason is required");
        return;
      }
      sendAlertMutation.mutate({
        candidate: actionCandidate,
        reason: alertReason.trim(),
      });
    }
  };

  const getSourceBadge = (intent: string) => {
    const colors: Record<string, string> = {
      discover: "bg-purple-500/10 text-purple-600 border-purple-500/20",
      watch: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      manual: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    };
    return colors[intent] || "bg-muted";
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Josh Inbox</h1>
            <p className="text-muted-foreground">
              Review candidates from Grok and watchlist scans
            </p>
          </div>
          <AccountSelector
            value={selectedAccountId}
            onChange={setSelectedAccountId}
          />
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : !candidates?.length ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <CheckCircle className="h-12 w-12 text-emerald-500 mb-4" />
              <h3 className="text-lg font-medium">Inbox Clear</h3>
              <p className="text-muted-foreground max-w-md mt-1">
                No pending candidates. Run a Grok mission or add watchlist URLs to get started.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {candidates.map((candidate) => (
              <Card key={candidate.id} className="hover:bg-accent/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={getSourceBadge(candidate.intent)}>
                          {candidate.intent.replace("_", " ")}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {candidate.priority}
                        </Badge>
                        <h3 className="font-semibold">
                          {candidate.dealer_slug}
                        </h3>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {candidate.domain}
                        </span>
                        {candidate.grok_class && (
                          <Badge variant={candidate.grok_class === "grok_safe" ? "default" : "secondary"} className="text-xs">
                            {candidate.grok_class}
                          </Badge>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(candidate.created_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>

                      <a
                        href={candidate.url_canonical || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {candidate.url_canonical
                          ? candidate.url_canonical.length > 60
                            ? candidate.url_canonical.slice(0, 60) + "..."
                            : candidate.url_canonical
                          : "—"}
                      </a>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleAction(candidate, "validate")}
                        disabled={updateCandidateMutation.isPending}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Validate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(candidate, "watch")}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Watch
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(candidate, "reject")}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleAction(candidate, "alert")}
                      >
                        <Send className="h-4 w-4 mr-1" />
                        Dave
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Action Dialog */}
      <Dialog open={!!actionType} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "watch" && "Add to Watch"}
              {actionType === "reject" && "Reject Candidate"}
              {actionType === "alert" && "Send to Dave"}
            </DialogTitle>
          </DialogHeader>

          {actionCandidate && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg text-sm">
                <span className="font-medium">
                  {actionCandidate.dealer_slug}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {actionCandidate.domain}
                </span>
              </div>

              {actionType === "alert" ? (
                <div>
                  <label className="text-sm font-medium">Reason for Dave</label>
                  <Textarea
                    value={alertReason}
                    onChange={(e) => setAlertReason(e.target.value)}
                    placeholder="Why is this a good opportunity?"
                    className="mt-1"
                    rows={3}
                  />
                </div>
              ) : (
                <div>
                  <label className="text-sm font-medium">
                    {actionType === "watch" ? "Notes" : "Reject Reason"}
                  </label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={
                      actionType === "watch"
                        ? "Why are you watching this?"
                        : "Why are you rejecting this?"
                    }
                    className="mt-1"
                    rows={3}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={submitAction}
              disabled={
                updateCandidateMutation.isPending || sendAlertMutation.isPending
              }
            >
              {actionType === "alert" ? "Send Alert" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
