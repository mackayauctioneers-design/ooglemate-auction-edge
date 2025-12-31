import { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationDrawer } from './NotificationDrawer';

export function NotificationBell() {
  const { isAdmin, currentUser } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

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

  return (
    <>
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

      <NotificationDrawer 
        open={isDrawerOpen} 
        onOpenChange={handleDrawerClose}
        onRefresh={loadUnreadCount}
      />
    </>
  );
}