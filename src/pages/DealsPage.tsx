import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { DealerLayout } from "@/components/layout/DealerLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAccounts } from "@/hooks/useAccounts";
import { useDeals } from "@/hooks/useDeals";
import { DealStatusBadge } from "@/components/deals/DealStatusActions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  FileText,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import type { DealStatus } from "@/hooks/useDeals";

export default function DealsPage() {
  useDocumentTitle(0);
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const { deals, loading, refetch } = useDeals(selectedAccountId, statusFilter);

  const statusCounts = deals.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <DealerLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              Closed Deals
            </h1>
            <p className="text-sm text-muted-foreground">
              Deal records from identification through delivery
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          {(["identified", "approved", "purchased", "delivered", "closed", "aborted"] as const).map((s) => (
            <Card key={s}>
              <CardContent className="pt-3 pb-2 px-3">
                <div className="text-xl font-bold">{statusCounts[s] || 0}</div>
                <div className="text-[10px] text-muted-foreground capitalize">{s}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {["all", "identified", "approved", "purchased", "delivered", "closed", "aborted"].map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : deals.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-medium text-foreground mb-1">No deals found</h3>
              <p className="text-sm text-muted-foreground">
                Create deals from the Matches Inbox to start tracking.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead className="hidden sm:table-cell">Source</TableHead>
                  <TableHead className="hidden sm:table-cell">Price</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deals.map((deal) => (
                  <TableRow key={deal.id}>
                    <TableCell>
                      <DealStatusBadge status={deal.status as DealStatus} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">
                        {deal.year} {deal.make} {deal.model}
                      </div>
                      {deal.vehicle_identifier && (
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {deal.vehicle_identifier}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {deal.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {deal.asking_price ? `$${deal.asking_price.toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {format(new Date(deal.created_at), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link to={`/deals/${deal.id}`}>
                          <Button variant="outline" size="sm">
                            Open
                          </Button>
                        </Link>
                        <a
                          href={deal.url_canonical}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center py-2">
          This deal record is an audit trail. Events and documents are append-only and timestamped.
        </p>
      </div>
    </DealerLayout>
  );
}
