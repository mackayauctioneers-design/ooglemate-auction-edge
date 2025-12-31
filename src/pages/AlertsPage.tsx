import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { dataService } from '@/services/dataService';
import { AlertLog } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Bell, CheckCircle, Clock, AlertTriangle, Settings, Send, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function AlertsPage() {
  const { isAdmin } = useAuth();
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [whatsAppEnabled, setWhatsAppEnabled] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [alertList, enabled] = await Promise.all([
        dataService.getAlerts(),
        dataService.isWhatsAppAlertsEnabled(),
      ]);
      setAlerts(alertList);
      setWhatsAppEnabled(enabled);
    } catch (error) {
      console.error('Failed to load alerts:', error);
      toast.error('Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleWhatsApp = async () => {
    setIsToggling(true);
    try {
      const newValue = !whatsAppEnabled;
      await dataService.setWhatsAppAlertsEnabled(newValue);
      setWhatsAppEnabled(newValue);
      toast.success(`WhatsApp alerts ${newValue ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Failed to toggle WhatsApp alerts:', error);
      toast.error('Failed to update setting');
    } finally {
      setIsToggling(false);
    }
  };

  const handleProcessQueue = async () => {
    setIsProcessing(true);
    try {
      const result = await dataService.processQueuedAlerts();
      toast.success(`Processed ${result.processed} alerts. Sent: ${result.sent}, Errors: ${result.errors}`);
      await loadData(); // Refresh the list
    } catch (error) {
      console.error('Failed to process queue:', error);
      toast.error('Failed to process queued alerts');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendAlert = async (alertId: string) => {
    try {
      const result = await dataService.sendAlert(alertId);
      if (result.success) {
        toast.success('Alert sent successfully');
        await loadData();
      } else {
        toast.error(result.error || 'Failed to send alert');
      }
    } catch (error) {
      console.error('Failed to send alert:', error);
      toast.error('Failed to send alert');
    }
  };

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

  const queuedCount = alerts.filter(a => a.status === 'queued').length;

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

        {/* Admin Controls Card */}
        <Card className="border-primary/20">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Settings className="h-5 w-5" />
              WhatsApp Alert Settings
            </CardTitle>
            <CardDescription>
              Control WhatsApp notifications for Watch → Buy transitions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="whatsapp-toggle" className="text-base font-medium">
                  WhatsApp Alerts Enabled
                </Label>
                <p className="text-sm text-muted-foreground">
                  {whatsAppEnabled 
                    ? 'Alerts will be sent to dealers when lots move to Buy status' 
                    : 'Alerts are logged but not sent to dealers'}
                </p>
              </div>
              <Switch
                id="whatsapp-toggle"
                checked={whatsAppEnabled}
                onCheckedChange={handleToggleWhatsApp}
                disabled={isToggling || isLoading}
              />
            </div>

            {whatsAppEnabled && queuedCount > 0 && (
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {queuedCount} alert{queuedCount !== 1 ? 's' : ''} queued
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Processing will send alerts within the 07:00-19:00 AEST window
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleProcessQueue}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Process Queue
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

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
            <p className="text-muted-foreground">No alerts have been logged yet.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="table-header-cell">Status</TableHead>
                  <TableHead className="table-header-cell">Time</TableHead>
                  <TableHead className="table-header-cell">Dealer</TableHead>
                  <TableHead className="table-header-cell">Recipient</TableHead>
                  <TableHead className="table-header-cell">Lot ID</TableHead>
                  <TableHead className="table-header-cell">Action</TableHead>
                  <TableHead className="table-header-cell">Message</TableHead>
                  {whatsAppEnabled && <TableHead className="table-header-cell w-24"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.alert_id} className="border-b border-border">
                    <TableCell>{getStatusBadge(alert.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground mono">
                      {format(new Date(alert.sent_at), 'dd MMM HH:mm')}
                    </TableCell>
                    <TableCell className="text-sm">{alert.dealer_name || '-'}</TableCell>
                    <TableCell className="text-sm mono">{alert.recipient_whatsapp || '-'}</TableCell>
                    <TableCell className="text-sm mono text-muted-foreground">{alert.lot_id}</TableCell>
                    <TableCell>
                      <Badge variant="buy" className="text-xs">{alert.action_change}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <p className="text-sm text-muted-foreground truncate">{alert.message_text}</p>
                      {alert.error_message && (
                        <p className="text-xs text-destructive mt-1">{alert.error_message}</p>
                      )}
                    </TableCell>
                    {whatsAppEnabled && (
                      <TableCell>
                        {(alert.status === 'queued' || alert.status === 'failed') && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleSendAlert(alert.alert_id)}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
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