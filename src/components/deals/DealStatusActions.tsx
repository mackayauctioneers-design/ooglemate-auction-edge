import { useState } from "react";
import { DealStatus, getNextStatus, transitionDealStatus } from "@/hooks/useDeals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  Package,
  Truck,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_CONFIG: Record<DealStatus, { label: string; color: string; icon: React.ReactNode }> = {
  identified: { label: "Identified", color: "bg-blue-500/15 text-blue-600 border-blue-500/30", icon: null },
  approved: { label: "Approved", color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: <ShieldCheck className="h-3 w-3" /> },
  purchased: { label: "Purchased", color: "bg-violet-500/15 text-violet-600 border-violet-500/30", icon: <Package className="h-3 w-3" /> },
  delivered: { label: "Delivered", color: "bg-amber-500/15 text-amber-600 border-amber-500/30", icon: <Truck className="h-3 w-3" /> },
  closed: { label: "Closed", color: "bg-emerald-600/15 text-emerald-700 border-emerald-600/30", icon: <CheckCircle2 className="h-3 w-3" /> },
  aborted: { label: "Aborted", color: "bg-destructive/15 text-destructive border-destructive/30", icon: <XCircle className="h-3 w-3" /> },
};

const NEXT_ACTION_LABEL: Record<DealStatus, string> = {
  identified: "Approve Deal",
  approved: "Mark Purchased",
  purchased: "Mark Delivered",
  delivered: "Close Deal",
  closed: "",
  aborted: "",
};

interface Props {
  dealId: string;
  status: DealStatus;
  createdBy: string;
  onStatusChange: () => void;
  hasInvoice?: boolean;
}

export function DealStatusActions({ dealId, status, createdBy, onStatusChange, hasInvoice }: Props) {
  const [transitioning, setTransitioning] = useState(false);
  const config = STATUS_CONFIG[status];
  const nextStatus = getNextStatus(status);

  const handleTransition = async (target: DealStatus) => {
    // Gate: purchased requires at least one invoice
    if (target === "purchased" && !hasInvoice) {
      toast.error("Upload at least one invoice before marking as purchased");
      return;
    }

    setTransitioning(true);
    try {
      await transitionDealStatus(dealId, target, createdBy);
      toast.success(`Deal moved to ${STATUS_CONFIG[target].label}`);
      onStatusChange();
    } catch (err) {
      toast.error("Failed to update deal status");
    } finally {
      setTransitioning(false);
    }
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Current status badge */}
      <Badge variant="outline" className={`${config.color} gap-1`}>
        {config.icon}
        {config.label}
      </Badge>

      {/* Next action button */}
      {nextStatus && NEXT_ACTION_LABEL[status] && (
        <Button
          size="sm"
          onClick={() => handleTransition(nextStatus)}
          disabled={transitioning}
        >
          {transitioning ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <ArrowRight className="h-4 w-4 mr-1" />
          )}
          {NEXT_ACTION_LABEL[status]}
        </Button>
      )}

      {/* Abort button (available until closed) */}
      {status !== "closed" && status !== "aborted" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleTransition("aborted")}
          disabled={transitioning}
          className="text-destructive hover:text-destructive"
        >
          <XCircle className="h-4 w-4 mr-1" />
          Abort
        </Button>
      )}
    </div>
  );
}

export function DealStatusBadge({ status }: { status: DealStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.identified;
  return (
    <Badge variant="outline" className={`${config.color} gap-1`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}
