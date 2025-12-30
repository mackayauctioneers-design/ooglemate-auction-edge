import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { dataService } from '@/services/mockData';
import { AlertLog } from '@/types';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { Bell, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

export default function AlertsPage() {
  const { isAdmin } = useAuth();
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadAlerts = async () => {
      setIsLoading(true);
      try {
        const alertList = await dataService.getAlerts();
        setAlerts(alertList);
      } catch (error) {
        console.error('Failed to load alerts:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadAlerts();
  }, []);

  const getStatusIcon = (status: AlertLog['status']) => {
    switch (status) {
      case 'sent':
        return <CheckCircle className="h-4 w-4 text-primary" />;
      case 'queued':
        return <Clock className="h-4 w-4 text-action-watch" />;
      case 'failed':
        return <AlertTriangle className="h-4 w-4 text-destructive" />;
    }
  };

  const getStatusBadge = (status: AlertLog['status']) => {
    const variants: Record<string, "default" | "outline" | "destructive"> = {
      sent: 'default',
      queued: 'outline',
      failed: 'destructive',
    };
    return (
      <Badge variant={variants[status]} className="gap-1.5">
        {getStatusIcon(status)}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="p-6 flex items-center justify-center min-h-[50vh]">
          <p className="text-muted-foreground">Admin access required</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Bell className="h-6 w-6 text-primary" />
            Alert Log
          </h1>
          <p className="text-muted-foreground mt-1">
            Track WhatsApp notifications sent to dealers
          </p>
        </div>

        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Alerts are sent between 7:00 AM - 7:00 PM AEST. Outside these hours, alerts are queued.
          </p>
        </div>

        {isLoading ? (
          <div className="bg-card border border-border rounded-lg p-8 animate-pulse">
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded" />
              ))}
            </div>
          </div>
        ) : alerts.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-12 text-center">
            <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No alerts have been sent yet.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="table-header-cell">Status</TableHead>
                  <TableHead className="table-header-cell">Sent At</TableHead>
                  <TableHead className="table-header-cell">Recipient</TableHead>
                  <TableHead className="table-header-cell">Lot ID</TableHead>
                  <TableHead className="table-header-cell">Action Change</TableHead>
                  <TableHead className="table-header-cell">Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.alert_id} className="border-b border-border">
                    <TableCell>{getStatusBadge(alert.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground mono">
                      {format(new Date(alert.sent_at), 'dd MMM HH:mm')}
                    </TableCell>
                    <TableCell className="text-sm mono">{alert.recipient_whatsapp}</TableCell>
                    <TableCell className="text-sm mono text-muted-foreground">{alert.lot_id}</TableCell>
                    <TableCell>
                      <Badge variant="buy" className="text-xs">{alert.action_change}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <p className="text-sm text-muted-foreground truncate">{alert.message_text}</p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
