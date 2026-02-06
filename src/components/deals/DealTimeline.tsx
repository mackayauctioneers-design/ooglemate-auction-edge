import { DealEvent } from "@/hooks/useDeals";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import {
  CheckCircle2,
  FileText,
  Camera,
  Truck,
  XCircle,
  Eye,
  MessageSquare,
  ShieldCheck,
  Package,
} from "lucide-react";

const EVENT_ICONS: Record<string, React.ReactNode> = {
  identified: <Eye className="h-4 w-4 text-primary" />,
  approved: <ShieldCheck className="h-4 w-4 text-emerald-500" />,
  purchased: <Package className="h-4 w-4 text-blue-500" />,
  delivered: <Truck className="h-4 w-4 text-violet-500" />,
  closed: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  aborted: <XCircle className="h-4 w-4 text-destructive" />,
  note_added: <MessageSquare className="h-4 w-4 text-muted-foreground" />,
};

function getEventIcon(type: string) {
  if (type.endsWith("_uploaded")) {
    if (type.includes("photo") || type.includes("snapshot")) {
      return <Camera className="h-4 w-4 text-amber-500" />;
    }
    return <FileText className="h-4 w-4 text-blue-500" />;
  }
  return EVENT_ICONS[type] || <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
}

function formatEventType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

export function DealTimeline({ events }: { events: DealEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No events recorded yet.
      </p>
    );
  }

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-[17px] top-2 bottom-2 w-px bg-border" />

      {events.map((event, idx) => {
        const payload = event.event_payload as Record<string, unknown>;
        return (
          <div key={event.id} className="relative flex gap-3 py-3">
            <div className="relative z-10 flex items-center justify-center w-9 h-9 rounded-full bg-card border border-border shadow-sm">
              {getEventIcon(event.event_type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground">
                  {formatEventType(event.event_type)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(event.created_at), "dd MMM yyyy HH:mm")}
                </span>
              </div>
              {event.created_by && (
                <p className="text-[10px] text-muted-foreground">
                  by {event.created_by}
                </p>
              )}
              {/* Show relevant payload details */}
              {payload.match_score && (
                <Badge variant="secondary" className="text-[10px] mt-1">
                  Score: {String(payload.match_score)}
                </Badge>
              )}
              {payload.file_name && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  📎 {String(payload.file_name)}
                </p>
              )}
              {payload.file_hash && (
                <p className="text-[10px] text-muted-foreground font-mono truncate max-w-xs">
                  SHA-256: {String(payload.file_hash).slice(0, 16)}…
                </p>
              )}
              {payload.note && (
                <p className="text-xs text-foreground mt-1 bg-muted/50 rounded p-2">
                  {String(payload.note)}
                </p>
              )}
              {/* Show match reasons if present */}
              {payload.reasons && typeof payload.reasons === "object" && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(payload.reasons as Record<string, string>)
                    .filter(([, v]) => v.includes("(+") && !v.includes("(+0)"))
                    .slice(0, 4)
                    .map(([k, v]) => (
                      <Badge key={k} variant="outline" className="text-[10px]">
                        {v}
                      </Badge>
                    ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
