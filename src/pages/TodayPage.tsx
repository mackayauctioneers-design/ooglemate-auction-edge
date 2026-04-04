import { useState, useEffect, useCallback } from "react";
import { DealerLayout } from "@/components/layout/DealerLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAccounts } from "@/hooks/useAccounts";
import { useAuth } from "@/contexts/AuthContext";
import { useTodayOpportunities, TodayOpportunity } from "@/hooks/useTodayOpportunities";
import { createDealFromOpportunity } from "@/hooks/useDeals";
import { supabase } from "@/integrations/supabase/client";
import { TodayOpportunityCard } from "@/components/today/TodayOpportunityCard";
import { DealsInProgressSection, RecentlyClosedSection } from "@/components/today/TodayDealsSection";
import { CreateDealConfirmDialog } from "@/components/today/CreateDealConfirmDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Target, FileText, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { EnrichmentData } from "@/components/today/OpportunityEnrichmentPanel";

// ============================================================================
// TODAY'S OPPORTUNITIES — Dealer Default Landing Page
// ============================================================================
// "What should I look at or act on right now — and why?"
//
// Sales truth drives visibility. No raw browsing. Evidence over opinion.
// ============================================================================

export default function TodayPage() {
  useDocumentTitle(0);
  const { data: accounts } = useAccounts();
  const { currentUser } = useAuth();

  // Auto-select first account
  const accountId = accounts?.[0]?.id || "";

  const { opportunities, dealsInProgress, recentlyClosed, loading, refetch } =
    useTodayOpportunities(accountId);

  // Track which opportunities already have deals
  const [existingDealMap, setExistingDealMap] = useState<Record<string, string>>({});
  const [creatingDealFor, setCreatingDealFor] = useState<string | null>(null);
  const [confirmOpp, setConfirmOpp] = useState<TodayOpportunity | null>(null);

  // Fetch existing deal mappings
  const fetchDealMap = useCallback(async () => {
    if (!accountId) return;
    const { data } = await supabase
      .from("deal_truth_ledger")
      .select("id, matched_opportunity_id")
      .eq("account_id", accountId)
      .not("matched_opportunity_id", "is", null);

    const map: Record<string, string> = {};
    (data || []).forEach((d: any) => {
      if (d.matched_opportunity_id) map[d.matched_opportunity_id] = d.id;
    });
    setExistingDealMap(map);
  }, [accountId]);

  useEffect(() => {
    fetchDealMap();
  }, [fetchDealMap]);

  const handleCreateDeal = async (opp: TodayOpportunity) => {
    setConfirmOpp(opp);
  };

  const [actionLoading, setActionLoading] = useState(false);
  const [enrichments, setEnrichments] = useState<Record<string, EnrichmentData>>({});
  const [enrichingFor, setEnrichingFor] = useState<string | null>(null);

  // Fetch existing enrichments for loaded opportunities
  useEffect(() => {
    if (opportunities.length === 0) return;
    const ids = opportunities.map(o => o.id);
    supabase
      .from("opportunity_enrichments")
      .select("*")
      .in("matched_opportunity_id", ids)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, EnrichmentData> = {};
          data.forEach((e: any) => { map[e.matched_opportunity_id] = e; });
          setEnrichments(prev => ({ ...prev, ...map }));
        }
      });
  }, [opportunities]);

  const triggerEnrichment = async (oppId: string) => {
    setEnrichingFor(oppId);
    try {
      const { data, error } = await supabase.functions.invoke("enrich-opportunity", {
        body: { matched_opportunity_id: oppId },
      });
      if (error) throw error;
      if (data?.enrichment) {
        setEnrichments(prev => ({ ...prev, [oppId]: data.enrichment }));
      }
    } catch (err) {
      console.error("Enrichment failed:", err);
    } finally {
      setEnrichingFor(null);
    }
  };

  const handleDealerAction = async (opp: TodayOpportunity, action: string) => {
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('matched_opportunities_v1')
        .update({
          dealer_action: action,
          dealer_action_at: new Date().toISOString(),
          status: action === 'pass' ? 'passed' : action === 'bidding' ? 'bidding' : 'interested',
        })
        .eq('id', opp.id);
      if (error) throw error;
      toast.success(action === 'pass' ? 'Marked as pass' : action === 'bidding' ? 'Marked as already bidding' : 'Marked as interested');
      
      // Trigger enrichment when dealer clicks Interested
      if (action === 'interested') {
        triggerEnrichment(opp.id);
      }
      
      refetch();
    } catch (err) {
      toast.error('Failed to record action');
    } finally {
      setActionLoading(false);
    }
  };

  const confirmCreateDeal = async () => {
    if (!confirmOpp) return;
    const opp = confirmOpp;
    setConfirmOpp(null);
    setCreatingDealFor(opp.id);
    try {
      const deal = await createDealFromOpportunity(
        {
          ...opp,
          reasons: opp.reasons,
        },
        currentUser?.email || currentUser?.dealer_name || "unknown"
      );
      setExistingDealMap((prev) => ({ ...prev, [opp.id]: deal.id }));
      toast.success("Deal record created");
      refetch();
      fetchDealMap();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("duplicate")) {
        toast.error("A deal already exists for this opportunity");
      } else {
        toast.error("Failed to create deal: " + msg);
      }
    } finally {
      setCreatingDealFor(null);
    }
  };

  const openCount = opportunities.length;
  const activeDealsCount = dealsInProgress.length;

  return (
    <DealerLayout>
      <div className="p-4 sm:p-6 space-y-8 max-w-5xl">
        {/* Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            Today's Opportunities
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            What should you look at or act on right now — and why.
          </p>
        </div>

        {/* Light metrics */}
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{openCount}</span> open opportunities
            </span>
          </div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{activeDealsCount}</span> deals in progress
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* ============================================================ */}
            {/* SECTION A — New Opportunities */}
            {/* ============================================================ */}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Target className="h-5 w-5" />
                New Opportunities
              </h2>

              {opportunities.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Target className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <h3 className="font-medium text-foreground mb-2">No new opportunities today</h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      We only surface listings when they match what you've already proven you can sell.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {opportunities.map((opp) => (
                    <TodayOpportunityCard
                      key={opp.id}
                      opportunity={opp}
                      existingDealId={existingDealMap[opp.id]}
                      onCreateDeal={handleCreateDeal}
                      creating={creatingDealFor === opp.id}
                      onDealerAction={handleDealerAction}
                      actionLoading={actionLoading}
                      enrichment={enrichments[opp.id] || null}
                      enrichmentLoading={enrichingFor === opp.id}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ============================================================ */}
            {/* SECTION B — Deals In Progress */}
            {/* ============================================================ */}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Deals In Progress
              </h2>
              <DealsInProgressSection deals={dealsInProgress} />
            </section>

            {/* ============================================================ */}
            {/* SECTION C — Recently Closed Deals */}
            {/* ============================================================ */}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                Recently Closed Deals
              </h2>
              <RecentlyClosedSection deals={recentlyClosed} />
            </section>

            {/* Guiding footer */}
            <p className="text-xs text-muted-foreground text-center pt-4 pb-2">
              Cars do not have universal value. These opportunities are surfaced solely from what you've proven you can sell.
            </p>
          </>
        )}
      </div>

      {/* Create Deal confirmation dialog */}
      <CreateDealConfirmDialog
        open={!!confirmOpp}
        onOpenChange={(open) => !open && setConfirmOpp(null)}
        vehicleName={
          confirmOpp
            ? [confirmOpp.year, confirmOpp.make, confirmOpp.model].filter(Boolean).join(" ") || "this vehicle"
            : ""
        }
        onConfirm={confirmCreateDeal}
      />
    </DealerLayout>
  );
}
