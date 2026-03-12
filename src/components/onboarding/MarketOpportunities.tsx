import { Target, Search } from "lucide-react";

export interface MarketOpportunity {
  title: string;
  km: number;
  market_price: number;
  potential_margin: number;
  source: string;
  listing_url?: string;
}

export interface MarketOpportunitiesData {
  opportunities: MarketOpportunity[];
  status: "pending" | "searching" | "done" | "unavailable";
}

interface MarketOpportunitiesProps {
  data: MarketOpportunitiesData;
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(val);
}

function formatKm(val: number) {
  return `${Math.round(val / 1000)}k`;
}

export function MarketOpportunities({ data }: MarketOpportunitiesProps) {
  if (data.status === "pending" || data.status === "searching") {
    return (
      <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-8 text-center animate-pulse">
        <Search className="h-8 w-8 text-primary/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Scanning markets for opportunities…</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Matching your fingerprint against live listings</p>
      </div>
    );
  }

  if (data.status === "unavailable" || data.opportunities.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
        <Target className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Market scan will be available once your fingerprints are generated</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Check back on your dashboard shortly</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Target className="h-4 w-4 text-primary" />
        <h4 className="font-semibold text-sm text-foreground">Vehicles You Should Be Buying</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2 text-muted-foreground font-medium">Vehicle</th>
              <th className="text-right px-4 py-2 text-muted-foreground font-medium">KM</th>
              <th className="text-right px-4 py-2 text-muted-foreground font-medium">Market Price</th>
              <th className="text-right px-4 py-2 text-muted-foreground font-medium">Potential Margin</th>
              <th className="text-right px-4 py-2 text-muted-foreground font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {data.opportunities.slice(0, 8).map((opp, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2.5 font-medium text-foreground">
                  {opp.listing_url ? (
                    <a href={opp.listing_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                      {opp.title}
                    </a>
                  ) : opp.title}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{formatKm(opp.km)}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{formatCurrency(opp.market_price)}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-primary">{formatCurrency(opp.potential_margin)}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">{opp.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
