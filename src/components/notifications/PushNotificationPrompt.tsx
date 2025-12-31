import { useState, useEffect } from 'react';
import { Bell, BellRing, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  isPushSupported, 
  getNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  isSubscribedToPush
} from '@/services/pushNotificationService';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface PushNotificationPromptProps {
  showOnMount?: boolean;
}

export function PushNotificationPrompt({ showOnMount = false }: PushNotificationPromptProps) {
  const { currentUser } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    checkSubscription();
  }, []);

  useEffect(() => {
    // Show prompt after login if not subscribed
    if (showOnMount && hasChecked && !isSubscribed && isPushSupported()) {
      const hasSeenPrompt = localStorage.getItem('push-prompt-shown');
      if (!hasSeenPrompt) {
        // Delay to not overwhelm user right after login
        const timer = setTimeout(() => {
          setIsOpen(true);
          localStorage.setItem('push-prompt-shown', 'true');
        }, 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [showOnMount, hasChecked, isSubscribed]);

  const checkSubscription = async () => {
    const subscribed = await isSubscribedToPush();
    setIsSubscribed(subscribed);
    setHasChecked(true);
  };

  const handleEnable = async () => {
    if (!currentUser?.dealer_name) {
      toast.error('Please log in first');
      return;
    }

    setIsLoading(true);
    try {
      const success = await subscribeToPush(currentUser.dealer_name);
      if (success) {
        setIsSubscribed(true);
        toast.success('Push notifications enabled!');
        setIsOpen(false);
      } else {
        toast.error('Could not enable notifications. Please check your browser settings.');
      }
    } catch (error) {
      console.error('Failed to enable push:', error);
      toast.error('Failed to enable notifications');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!currentUser?.dealer_name) return;

    setIsLoading(true);
    try {
      await unsubscribeFromPush(currentUser.dealer_name);
      setIsSubscribed(false);
      toast.success('Push notifications disabled');
    } catch (error) {
      console.error('Failed to disable push:', error);
      toast.error('Failed to disable notifications');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isPushSupported()) {
    return null;
  }

  const permission = getNotificationPermission();

  return (
    <>
      {/* Toggle button for settings */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => isSubscribed ? handleDisable() : setIsOpen(true)}
        disabled={isLoading}
        className="gap-2"
      >
        {isSubscribed ? (
          <>
            <BellRing className="h-4 w-4 text-primary" />
            <span className="text-xs">Push On</span>
          </>
        ) : (
          <>
            <BellOff className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs">Push Off</span>
          </>
        )}
      </Button>

      {/* Enable prompt dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              Enable BUY Alerts
            </DialogTitle>
            <DialogDescription>
              Get instant notifications on your phone when vehicles flip from Watch to Buy.
              Never miss a profitable opportunity!
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-start gap-3">
                <span className="text-primary font-bold">📱</span>
                <span>Real-time alerts even when the app is closed</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary font-bold">🔔</span>
                <span>App badge shows unread count on home screen</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary font-bold">🌙</span>
                <span>Quiet hours: 7PM-7AM AEST (no overnight pings)</span>
              </div>
            </div>

            {permission === 'denied' && (
              <p className="mt-4 text-sm text-destructive">
                Notifications are blocked. Please enable them in your browser settings.
              </p>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Not now
            </Button>
            <Button 
              onClick={handleEnable} 
              disabled={isLoading || permission === 'denied'}
            >
              {isLoading ? 'Enabling...' : 'Enable Notifications'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
