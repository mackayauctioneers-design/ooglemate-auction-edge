import { useState, useEffect } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationDrawer } from './NotificationDrawer';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { toast } from 'sonner';

export function NotificationBell() {
  const { isAdmin, currentUser } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  // Update browser tab title
  useDocumentTitle(unreadCount);

  const loadUnreadCount = async () => {
    try {
      const dealerName = isAdmin ? undefined : currentUser?.dealer_name;
      const count = await dataService.getUnreadAlertCount(dealerName);
      setUnreadCount(count);
    } catch (error) {
      console.error('Failed to load unread count:', error);
    }
  };

  useEffect(() => {
    loadUnreadCount();
    // Refresh count every 30 seconds
    const interval = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [isAdmin, currentUser]);

  const handleDrawerClose = () => {
    setIsDrawerOpen(false);
    loadUnreadCount(); // Refresh count after drawer closes
  };

  const handleMarkAllRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMarkingAll(true);
    try {
      const dealerName = isAdmin ? undefined : currentUser?.dealer_name;
      const count = await dataService.markAllBuyAlertsRead(dealerName);
      setUnreadCount(0);
      toast.success(`Marked ${count} alert${count !== 1 ? 's' : ''} as read`);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
      toast.error('Failed to mark alerts as read');
    } finally {
      setIsMarkingAll(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="iconSm"
          className="relative text-muted-foreground hover:text-foreground"
          onClick={() => setIsDrawerOpen(true)}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-action-buy text-[10px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
        
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="iconSm"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleMarkAllRead}
            disabled={isMarkingAll}
            title="Mark all BUY alerts as read"
          >
            <CheckCheck className="h-4 w-4" />
          </Button>
        )}
      </div>

      <NotificationDrawer 
        open={isDrawerOpen} 
        onOpenChange={handleDrawerClose}
        onRefresh={loadUnreadCount}
      />
    </>
  );
}
