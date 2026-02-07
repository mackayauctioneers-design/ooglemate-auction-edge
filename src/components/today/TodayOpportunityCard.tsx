import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import type { TodayOpportunity } from "@/hooks/useTodayOpportunities";

// ============================================================================
// OPPORTUNITY CARD: Single matched opportunity for Today's page
// Truth-based language only. No predictions, no "good deal" wording.
// ============================================================================

interface Props {
  opportunity: TodayOpportunity;
  existingDealId?: string;
  onCreateDeal: (opp: TodayOpportunity) => void;
  creating: boolean;
}

export function TodayOpportunityCard({ opportunity: opp, existingDealId, onCreateDeal, creating }: Props) {
  const vehicle = [opp.year, opp.make, opp.model].filter(Boolean).join(" ");
  const km = opp.km != null ? `${Math.round(opp.km / 1000)}k km` : null;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        {/* Vehicle + Score */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm text-foreground">{vehicle || "Unknown vehicle"}</h3>
            {km && <p className="text-xs text-muted-foreground mt-0.5">{km}</p>}
          </div>
          <Badge
            variant="outline"
            className={
              opp.match_score >= 80
                ? "bg-foreground/5 text-foreground border-foreground/20 font-mono"
                : "bg-muted text-muted-foreground border-border font-mono"
            }
          >
            {opp.match_score}/100
          </Badge>
        </div>

        {/* Why it surfaced — truth-based */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          Surfaced because you've sold <span className="font-medium text-foreground">{opp.sales_count}</span> similar vehicles.
        </p>

        {/* Listing link */}
        <a
          href={opp.url_canonical}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          View listing <ExternalLink className="h-3 w-3" />
        </a>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Link to="/matches-inbox" className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs">
              View Match
            </Button>
          </Link>
          {existingDealId ? (
            <Link to={`/deals/${existingDealId}`} className="flex-1">
              <Button variant="secondary" size="sm" className="w-full text-xs gap-1">
                <FileText className="h-3 w-3" />
                Open Deal
              </Button>
            </Link>
          ) : (
            <Button
              size="sm"
              className="flex-1 text-xs gap-1"
              onClick={() => onCreateDeal(opp)}
              disabled={creating}
            >
              {creating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <FileText className="h-3 w-3" />
                  Create Deal
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
