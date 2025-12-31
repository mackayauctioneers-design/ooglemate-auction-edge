import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { dataService } from '@/services/dataService';
import { AlertLog } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { 
  Bell, 
  CheckCircle, 
  ExternalLink, 
  Eye,
  ChevronRight,
  Loader2,
  CheckCheck
} from 'lucide-react';
import { toast } from 'sonner';

interface NotificationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}

export function NotificationDrawer({ open, onOpenChange, onRefresh }: NotificationDrawerProps) {
  const navigate = useNavigate();
  const { isAdmin, currentUser } = useAuth();
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const loadAlerts = async () => {
    setIsLoading(true);
    try {
      const allAlerts = await dataService.getAlerts();
      
      // Filter to BUY alerts only (Watch→Buy)
      let filtered = allAlerts.filter(a => a.action_change === 'Watch→Buy');
      
      // Filter by dealer if not admin
      if (!isAdmin) {
        filtered = filtered.filter(a => a.dealer_name === currentUser?.dealer_name);
      }
      
      // Sort by created_at descending, new first
      filtered.sort((a, b) => {
        // New alerts first
        if (a.status === 'new' && b.status !== 'new') return -1;
        if (a.status !== 'new' && b.status === 'new') return 1;
        // Then by date
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      
      // Only show the 20 most recent
      setAlerts(filtered.slice(0, 20));
    } catch (error) {
      console.error('Failed to load alerts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadAlerts();
    }
  }, [open, isAdmin, currentUser]);

  const handleMarkRead = async (alertId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await dataService.markAlertRead(alertId);
      await loadAlerts();
      onRefresh();
    } catch (error) {
      console.error('Failed to mark as read:', error);
      toast.error('Failed to update');
    }
  };

  const handleAcknowledge = async (alertId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await dataService.acknowledgeAlert(alertId);
      await loadAlerts();
      onRefresh();
    } catch (error) {
      console.error('Failed to acknowledge:', error);
      toast.error('Failed to update');
    }
  };

  const handleMarkAllRead = async () => {
    setIsMarkingAll(true);
    try {
      const dealerName = isAdmin ? undefined : currentUser?.dealer_name;
      const count = await dataService.markAllBuyAlertsRead(dealerName);
      await loadAlerts();
      onRefresh();
      toast.success(`Marked ${count} alert${count !== 1 ? 's' : ''} as read`);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
      toast.error('Failed to update');
    } finally {
      setIsMarkingAll(false);
    }
  };

  const handleOpenListing = (link: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    if (link) {
      window.open(link, '_blank');
    }
  };

  const handleViewAll = () => {
    onOpenChange(false);
    navigate('/alerts');
  };

  const newCount = alerts.filter(a => a.status === 'new').length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            BUY Alerts
            {newCount > 0 && (
              <Badge variant="default" className="ml-2">
                {newCount} new
              </Badge>
            )}
          </SheetTitle>
          {newCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={handleMarkAllRead}
              disabled={isMarkingAll}
            >
              <CheckCheck className="h-4 w-4 mr-1" />
              Mark all BUY alerts read
            </Button>
          )}
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-10rem)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <Bell className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No BUY alerts yet
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Alerts appear when lots move from Watch to Buy
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {alerts.map((alert) => (
                <div 
                  key={alert.alert_id}
                  className={`p-4 hover:bg-muted/50 transition-colors ${
                    alert.status === 'new' ? 'bg-action-buy/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 ${
                      alert.status === 'new' ? 'text-action-buy' : 'text-muted-foreground'
                    }`}>
                      {alert.status === 'acknowledged' ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <Bell className="h-4 w-4" />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="buy" className="text-xs">
                          BUY NOW
                        </Badge>
                        {alert.status === 'new' && (
                          <span className="text-xs text-action-buy font-medium">New</span>
                        )}
                      </div>
                      
                      <p className="font-medium text-sm mt-1 truncate">
                        {alert.lot_year} {alert.lot_make} {alert.lot_model} {alert.lot_variant}
                      </p>
                      
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <span>{alert.auction_house}</span>
                        {alert.auction_datetime && (
                          <>
                            <span>•</span>
                            <span>{format(new Date(alert.auction_datetime), 'dd MMM')}</span>
                          </>
                        )}
                        {alert.estimated_margin && (
                          <>
                            <span>•</span>
                            <span className="text-primary font-medium">
                              ${alert.estimated_margin.toLocaleString()}
                            </span>
                          </>
                        )}
                      </div>

                      {alert.why_flagged && alert.why_flagged.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {alert.why_flagged.slice(0, 3).map((flag, i) => (
                            <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0">
                              {flag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-3">
                        {alert.link && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="h-7 text-xs"
                            onClick={(e) => handleOpenListing(alert.link, e)}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Open
                          </Button>
                        )}
                        {alert.status === 'new' && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="h-7 text-xs"
                            onClick={(e) => handleMarkRead(alert.alert_id, e)}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            Read
                          </Button>
                        )}
                        {alert.status !== 'acknowledged' && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="h-7 text-xs"
                            onClick={(e) => handleAcknowledge(alert.alert_id, e)}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Ack
                          </Button>
                        )}
                      </div>

                      <p className="text-[10px] text-muted-foreground mt-2">
                        {alert.created_at && format(new Date(alert.created_at), 'dd MMM yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-border bg-background">
          <Button 
            variant="outline" 
            className="w-full" 
            onClick={handleViewAll}
          >
            View All Alerts
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
