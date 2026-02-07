import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle, ArrowRight, XCircle, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface UploadBatch {
  id: string;
  filename: string | null;
  status: string;
  row_count: number;
  error_count: number;
  created_at: string;
  promoted_by: string | null;
}

interface UploadBatchHistoryProps {
  batches: UploadBatch[] | undefined;
  isLoading: boolean;
}

function getStatusBadge(status: string) {
  const styles: Record<string, { icon: React.ReactNode; className: string }> = {
    pending: { icon: null, className: "bg-muted text-muted-foreground" },
    validating: { icon: null, className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
    validated: {
      icon: <CheckCircle className="h-3 w-3 mr-1" />,
      className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    },
    promoted: {
      icon: <ArrowRight className="h-3 w-3 mr-1" />,
      className: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    },
    imported: {
      icon: <CheckCircle className="h-3 w-3 mr-1" />,
      className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    },
    error: {
      icon: <XCircle className="h-3 w-3 mr-1" />,
      className: "bg-red-500/10 text-red-600 border-red-500/20",
    },
  };
  const style = styles[status] || styles.pending;
  return (
    <Badge className={style.className}>
      {style.icon}
      {status}
    </Badge>
  );
}

export function UploadBatchHistory({ batches, isLoading }: UploadBatchHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Uploads</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : !batches?.length ? (
          <p className="text-center text-muted-foreground py-8">
            No uploads yet. Drop a file above to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Errors</TableHead>
                <TableHead>Uploaded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">
                    {batch.filename || "Unknown"}
                  </TableCell>
                  <TableCell>{getStatusBadge(batch.status)}</TableCell>
                  <TableCell>{batch.row_count}</TableCell>
                  <TableCell>
                    {batch.error_count > 0 ? (
                      <span className="text-destructive flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {batch.error_count}
                      </span>
                    ) : (
                      <span className="text-emerald-600">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(batch.created_at), {
                      addSuffix: true,
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
