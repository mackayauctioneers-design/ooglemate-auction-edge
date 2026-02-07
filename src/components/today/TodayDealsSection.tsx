import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Clock } from "lucide-react";
import type { TodayDeal } from "@/hooks/useTodayOpportunities";
import { formatDistanceToNow } from "date-fns";

// ============================================================================
// DEALS SECTIONS: In-progress + recently closed deals
// Reinforces momentum and trust through evidence of outcomes.
// ============================================================================

const STATUS_LABELS: Record<string, string> = {
  identified: "Identified",
  approved: "Approved",
  purchased: "Purchased",
  delivered: "Delivered",
  closed: "Closed",
  aborted: "Aborted",
};

function DealRow({ deal }: { deal: TodayDeal }) {
  const vehicle = [deal.year, deal.make, deal.model].filter(Boolean).join(" ");
  const timeAgo = formatDistanceToNow(new Date(deal.created_at), { addSuffix: true });

  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {vehicle || "Unknown vehicle"}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="text-[10px]">
              {STATUS_LABELS[deal.status] || deal.status}
            </Badge>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {timeAgo}
            </span>
          </div>
        </div>
      </div>
      <Link to={`/deals/${deal.id}`}>
        <Button variant="outline" size="sm" className="text-xs shrink-0">
          Open Deal
        </Button>
      </Link>
    </div>
  );
}

interface DealsInProgressProps {
  deals: TodayDeal[];
}

export function DealsInProgressSection({ deals }: DealsInProgressProps) {
  if (deals.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">No active deals right now.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        {deals.map((deal) => (
          <DealRow key={deal.id} deal={deal} />
        ))}
        <Link to="/deals" className="block mt-3">
          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground">
            View all deals →
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

interface RecentlyClosedProps {
  deals: TodayDeal[];
}

export function RecentlyClosedSection({ deals }: RecentlyClosedProps) {
  if (deals.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Completed deals will appear here once closed.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        {deals.map((deal) => (
          <DealRow key={deal.id} deal={deal} />
        ))}
      </CardContent>
    </Card>
  );
}
