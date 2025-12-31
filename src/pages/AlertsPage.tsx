import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { dataService } from '@/services/dataService';
import { AlertLog } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { Bell, CheckCircle, Eye, EyeOff, ExternalLink, Filter } from 'lucide-react';
import { toast } from 'sonner';

type StatusFilter = 'all' | 'new' | 'read' | 'acknowledged';

export default function AlertsPage() {
  const { isAdmin, currentUser } = useAuth();
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const alertList = await dataService.getAlerts();
      
      // Filter by dealer if not admin
      const filtered = isAdmin 
        ? alertList 
        : alertList.filter(a => a.dealer_name === currentUser?.dealer_name);
      
      // Sort by created_at descending (newest first)
      filtered.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      
      setAlerts(filtered);
    } catch (error) {
      console.error('Failed to load alerts:', error);
      toast.error('Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [isAdmin, currentUser]);

  const handleMarkRead = async (alertId: string) => {
    try {
      await dataService.markAlertRead(alertId);
      toast.success('Marked as read');
      await loadData();
    } catch (error) {
      console.error('Failed to mark as read:', error);
      toast.error('Failed to update');
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    try {
      await dataService.acknowledgeAlert(alertId);
      toast.success('Acknowledged');
      await loadData();
    } catch (error) {
      console.error('Failed to acknowledge:', error);
      toast.error('Failed to update');
    }
  };

  const getStatusIcon = (status: AlertLog['status']) => {
    switch (status) {
      case 'new':
        return <Bell className="h-4 w-4 text-action-buy" />;
      case 'read':
        return <Eye className="h-4 w-4 text-action-watch" />;
      case 'acknowledged':
        return <CheckCircle className="h-4 w-4 text-primary" />;
    }
  };

  const getStatusBadge = (status: AlertLog['status']) => {
    const variants: Record<string, "default" | "outline" | "secondary"> = {
      new: 'default',
      read: 'outline',
      acknowledged: 'secondary',
    };
    return (
      <Badge variant={variants[status]} className="gap-1.5">
        {getStatusIcon(status)}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  // Apply status filter
  const filteredAlerts = statusFilter === 'all' 
    ? alerts 
    : alerts.filter(a => a.status === statusFilter);

  const newCount = alerts.filter(a => a.status === 'new').length;
  const readCount = alerts.filter(a => a.status === 'read').length;
  const acknowledgedCount = alerts.filter(a => a.status === 'acknowledged').length;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Bell className="h-6 w-6 text-primary" />
            {isAdmin ? 'All Alerts' : 'My Alerts'}
          </h1>
          <p className="text-muted-foreground mt-1">
            In-app notifications for Watch → Buy transitions
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card className={newCount > 0 ? 'border-action-buy/50 bg-action-buy/5' : ''}>
            <CardHeader className="pb-2">
              <CardDescription>New</CardDescription>
              <CardTitle className="text-2xl">{newCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Read</CardDescription>
              <CardTitle className="text-2xl">{readCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Acknowledged</CardDescription>
              <CardTitle className="text-2xl">{acknowledgedCount}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="read">Read</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? 's' : ''}
          </span>
        </div>

        {isLoading ? (
          <div className="bg-card border border-border rounded-lg p-8 animate-pulse">
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded" />
              ))}
            </div>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-12 text-center">
            <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {statusFilter === 'all' 
                ? 'No alerts yet. Alerts are created when lots move from Watch to Buy.'
                : `No ${statusFilter} alerts.`}
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="table-header-cell">Status</TableHead>
                  <TableHead className="table-header-cell">Time</TableHead>
                  {isAdmin && <TableHead className="table-header-cell">Dealer</TableHead>}
                  <TableHead className="table-header-cell">Vehicle</TableHead>
                  <TableHead className="table-header-cell">Auction</TableHead>
                  <TableHead className="table-header-cell">Est. Margin</TableHead>
                  <TableHead className="table-header-cell">Flags</TableHead>
                  <TableHead className="table-header-cell w-48">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAlerts.map((alert) => (
                  <TableRow 
                    key={alert.alert_id} 
                    className={`border-b border-border ${alert.status === 'new' ? 'bg-action-buy/5' : ''}`}
                  >
                    <TableCell>{getStatusBadge(alert.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground mono">
                      {alert.created_at ? format(new Date(alert.created_at), 'dd MMM HH:mm') : '-'}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-sm font-medium">{alert.dealer_name || '-'}</TableCell>
                    )}
                    <TableCell>
                      <div className="text-sm">
                        <span className="font-medium">
                          {alert.lot_year} {alert.lot_make} {alert.lot_model}
                        </span>
                        {alert.lot_variant && (
                          <span className="text-muted-foreground ml-1">{alert.lot_variant}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{alert.auction_house || '-'}</div>
                      {alert.auction_datetime && (
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(alert.auction_datetime), 'dd MMM yyyy')}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {alert.estimated_margin 
                        ? `$${alert.estimated_margin.toLocaleString()}`
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {alert.why_flagged?.slice(0, 3).map((flag, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {alert.link && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => window.open(alert.link, '_blank')}
                          >
                            <ExternalLink className="h-4 w-4 mr-1" />
                            Open
                          </Button>
                        )}
                        {alert.status === 'new' && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleMarkRead(alert.alert_id)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            Read
                          </Button>
                        )}
                        {alert.status !== 'acknowledged' && (
                          <Button 
                            variant="secondary" 
                            size="sm"
                            onClick={() => handleAcknowledge(alert.alert_id)}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Ack
                          </Button>
                        )}
                      </div>
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