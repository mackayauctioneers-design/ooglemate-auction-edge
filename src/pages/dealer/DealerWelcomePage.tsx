import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DealerLayout } from '@/components/layout/DealerLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, BellOff, CheckCircle, Loader2, Crosshair, BarChart3, Bot, Shield } from 'lucide-react';
import { toast } from 'sonner';
import {
  isPushSupported,
  getNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  isSubscribedToPush,
  registerServiceWorker,
} from '@/services/pushNotificationService';

export default function DealerWelcomePage() {
  const { currentUser, dealerProfile } = useAuth();
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');
  const [pushLoading, setPushLoading] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);

  useEffect(() => {
    const check = async () => {
      setPushSupported(isPushSupported());
      setPushPermission(getNotificationPermission());
      const subscribed = await isSubscribedToPush();
      setPushSubscribed(subscribed);
      if (subscribed) setSetupComplete(true);
    };
    check();
    registerServiceWorker();
  }, []);

  const handleEnablePush = async () => {
    const dealerName = currentUser?.dealer_name || dealerProfile?.dealer_name;
    if (!dealerName) {
      toast.error('Dealer profile not found');
      return;
    }

    setPushLoading(true);
    const success = await subscribeToPush(dealerName);
    setPushLoading(false);

    if (success) {
      setPushSubscribed(true);
      setPushPermission('granted');
      setSetupComplete(true);
      toast.success('Push notifications enabled! You\'ll receive alerts for matching vehicles.');
    } else {
      setPushPermission(getNotificationPermission());
      if (getNotificationPermission() === 'denied') {
        toast.error('Notifications blocked. Enable them in your browser settings.');
      } else {
        toast.error('Failed to enable notifications. Try again.');
      }
    }
  };

  const handleDisablePush = async () => {
    const dealerName = currentUser?.dealer_name || dealerProfile?.dealer_name;
    if (!dealerName) return;

    setPushLoading(true);
    await unsubscribeFromPush(dealerName);
    setPushLoading(false);
    setPushSubscribed(false);
    toast.success('Push notifications disabled');
  };

  const dealerName = currentUser?.dealer_name || dealerProfile?.dealer_name || 'Dealer';

  return (
    <DealerLayout>
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Welcome Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-foreground">
            Welcome, {dealerName}
          </h1>
          <p className="text-muted-foreground">
            Let's get you set up to receive real-time vehicle alerts.
          </p>
        </div>

        {/* Push Notification Setup Card */}
        <Card className="border-2 border-primary/20">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Bell className="h-6 w-6 text-foreground" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-foreground">Push Notifications</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Get instant alerts when vehicles matching your buy profile hit auctions or the market.
                  Never miss a deal again.
                </p>
              </div>
              {pushSubscribed && (
                <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                  <CheckCircle className="h-3 w-3 mr-1" /> Active
                </Badge>
              )}
            </div>

            {!pushSupported ? (
              <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                <p>Push notifications aren't supported in this browser. Try Chrome, Edge, or Firefox on desktop/Android for the best experience.</p>
              </div>
            ) : pushPermission === 'denied' ? (
              <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                <p className="font-medium">Notifications are blocked</p>
                <p className="mt-1">Click the lock icon in your browser's address bar → Site settings → Allow notifications, then refresh this page.</p>
              </div>
            ) : pushSubscribed ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-4 text-sm">
                  <p className="text-foreground font-medium">✅ You're all set!</p>
                  <p className="text-muted-foreground mt-1">
                    You'll receive push notifications when vehicles matching your fingerprints are found at auction or below market price.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisablePush}
                  disabled={pushLoading}
                  className="text-muted-foreground"
                >
                  {pushLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BellOff className="h-4 w-4 mr-2" />}
                  Disable notifications
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleEnablePush}
                disabled={pushLoading}
                className="w-full"
                size="lg"
              >
                {pushLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Enabling…</>
                ) : (
                  <><Bell className="h-4 w-4 mr-2" /> Enable Push Notifications</>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* How It Works */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">How It Works</h2>
            <div className="grid gap-4">
              {[
                {
                  icon: Crosshair,
                  title: 'We scan the market',
                  desc: 'Our engine monitors auctions, dealer sites, and classifieds 24/7 for vehicles that match your buying patterns.',
                },
                {
                  icon: BarChart3,
                  title: 'Matched to your DNA',
                  desc: 'Every listing is scored against your historical trades — what you buy, what you sell, and what makes you money.',
                },
                {
                  icon: Bell,
                  title: 'Instant alerts',
                  desc: 'When a high-conviction match is found, you get a push notification with the vehicle, price, and source.',
                },
                {
                  icon: Shield,
                  title: 'Operator verified',
                  desc: 'Our team also manually reviews top opportunities and can push specific deals directly to you.',
                },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-3">
                  <div className="rounded-lg bg-muted p-2 shrink-0">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Links */}
        {setupComplete && (
          <div className="text-center space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">You're ready to go!</p>
            <div className="flex justify-center gap-3">
              <Button variant="default" asChild>
                <a href="/dealer-home">Go to Dashboard</a>
              </Button>
              <Button variant="outline" asChild>
                <a href="/ooglebot">Ask OogleBot</a>
              </Button>
            </div>
          </div>
        )}
      </div>
    </DealerLayout>
  );
}
