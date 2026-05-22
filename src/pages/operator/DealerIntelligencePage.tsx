import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";

type Intel = {
  sold_yesterday: any[];
  sold_this_week: any[];
  fast_movers: any[];
  aged_stock_cleared: any[];
  current_opportunities: any[];
  fingerprints: any[];
  recent_snapshot: any | null;
};

function VehicleList({ items, kind }: { items: any[]; kind: "sale" | "opp" }) {
  if (!items?.length) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <div className="space-y-2">
      {items.map((v) => (
        <Card key={v.id} className="p-3 flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              {v.year ?? ""} {v.make ?? ""} {v.model ?? ""} {v.variant ?? ""}
            </div>
            <div className="text-xs text-muted-foreground">
              {kind === "sale"
                ? `${v.listed_price ? "$" + v.listed_price.toLocaleString() : "—"} · ${v.km ?? "?"} km · sold ${v.sold_date ?? "—"} · ${v.days_online ?? "?"}d online · ${v.source ?? ""}`
                : `${v.price ? "$" + v.price.toLocaleString() : "—"} · margin ${v.estimated_margin ? "$" + v.estimated_margin.toLocaleString() : "—"} · score ${v.fingerprint_match_score ?? "—"} · ${v.source}`}
            </div>
          </div>
          {kind === "opp" && v.listing_url && (
            <a href={v.listing_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
              View
            </a>
          )}
        </Card>
      ))}
    </div>
  );
}

export default function DealerIntelligencePage() {
  const { dealerId } = useParams<{ dealerId: string }>();
  const [intel, setIntel] = useState<Intel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Dealer Intelligence | Operator";
    if (!dealerId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any).rpc("get_dealer_intelligence", { p_dealer_id: dealerId });
      if (!error) setIntel(data as Intel);
      setLoading(false);
    })();
  }, [dealerId]);

  return (
    <OperatorLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Dealer Intelligence</h1>
        <p className="text-sm text-muted-foreground">Powered by OpenClaw → Carbitrage memory layer.</p>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && intel && (
          <Tabs defaultValue="sold_yesterday">
            <TabsList className="flex-wrap">
              <TabsTrigger value="sold_yesterday">Sold Yesterday ({intel.sold_yesterday.length})</TabsTrigger>
              <TabsTrigger value="sold_this_week">Sold This Week ({intel.sold_this_week.length})</TabsTrigger>
              <TabsTrigger value="fast_movers">Fast Movers ({intel.fast_movers.length})</TabsTrigger>
              <TabsTrigger value="aged">Aged Cleared ({intel.aged_stock_cleared.length})</TabsTrigger>
              <TabsTrigger value="opps">Opportunities ({intel.current_opportunities.length})</TabsTrigger>
              <TabsTrigger value="fingerprints">Fingerprints ({intel.fingerprints.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="sold_yesterday"><VehicleList items={intel.sold_yesterday} kind="sale" /></TabsContent>
            <TabsContent value="sold_this_week"><VehicleList items={intel.sold_this_week} kind="sale" /></TabsContent>
            <TabsContent value="fast_movers"><VehicleList items={intel.fast_movers} kind="sale" /></TabsContent>
            <TabsContent value="aged"><VehicleList items={intel.aged_stock_cleared} kind="sale" /></TabsContent>
            <TabsContent value="opps"><VehicleList items={intel.current_opportunities} kind="opp" /></TabsContent>
            <TabsContent value="fingerprints">
              {intel.fingerprints.length === 0 ? (
                <p className="text-sm text-muted-foreground">No fingerprints yet.</p>
              ) : (
                <div className="space-y-2">
                  {intel.fingerprints.map((f: any) => (
                    <Card key={f.id} className="p-3">
                      <div className="font-medium">{f.make} {f.model} {f.variant ?? ""}</div>
                      <div className="text-xs text-muted-foreground">
                        Years {f.year_min}-{f.year_max} · avg ${f.avg_sell_price?.toLocaleString() ?? "—"} · {f.sales_count ?? 0} sales · velocity {f.sales_velocity?.toFixed?.(2) ?? "—"}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </OperatorLayout>
  );
}
