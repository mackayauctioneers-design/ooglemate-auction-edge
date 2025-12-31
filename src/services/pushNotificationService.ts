import { supabase } from '@/integrations/supabase/client';

const VAPID_PUBLIC_KEY = 'BLBSNvdFIW9P9y3dg4Br4k8gxlPNZGZOSwFfVfvZXxNlzJJwN0xN1rXuJCVT3C4wjqvK5c5TgFCYKqWfJqLXnw8';

// Check if push notifications are supported
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 
         'PushManager' in window && 
         'Notification' in window;
}

// Check current notification permission
export function getNotificationPermission(): NotificationPermission {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}

// Request notification permission and subscribe to push
export async function subscribeToPush(dealerName: string): Promise<boolean> {
  if (!isPushSupported()) {
    console.log('Push notifications not supported');
    return false;
  }

  try {
    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('Notification permission denied');
      return false;
    }

    // Get service worker registration
    const registration = await navigator.serviceWorker.ready;
    
    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      // Create new subscription
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    // Send subscription to backend
    const subscriptionJson = subscription.toJSON();
    
    const { error } = await supabase.functions.invoke('push-subscribe', {
      body: {
        dealer_name: dealerName,
        endpoint: subscriptionJson.endpoint,
        keys_p256dh: subscriptionJson.keys?.p256dh,
        keys_auth: subscriptionJson.keys?.auth,
      },
    });

    if (error) {
      console.error('Failed to save subscription:', error);
      return false;
    }

    console.log('Push subscription saved successfully');
    return true;
  } catch (err) {
    console.error('Failed to subscribe to push:', err);
    return false;
  }
}

// Unsubscribe from push notifications
export async function unsubscribeFromPush(dealerName: string): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      await subscription.unsubscribe();
      
      // Disable on backend
      await supabase.functions.invoke('push-subscribe', {
        body: {
          dealer_name: dealerName,
          enabled: false,
        },
      });
    }
    
    return true;
  } catch (err) {
    console.error('Failed to unsubscribe:', err);
    return false;
  }
}

// Check if user is subscribed
export async function isSubscribedToPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

// Update app badge via service worker
export async function updateAppBadge(count: number): Promise<void> {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'UPDATE_BADGE',
      count,
    });
  }
  
  // Also try direct badge API
  if ('setAppBadge' in navigator) {
    try {
      if (count > 0) {
        await (navigator as any).setAppBadge(count);
      } else {
        await (navigator as any).clearAppBadge();
      }
    } catch (err) {
      console.log('Badge API not available:', err);
    }
  }
}

// Convert VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

// Register service worker
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.log('Service workers not supported');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    
    console.log('Service worker registered:', registration.scope);
    
    // Listen for messages from service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'NOTIFICATION_CLICK') {
        // Navigate to the URL if different from current
        if (event.data.url && window.location.pathname !== event.data.url) {
          window.location.href = event.data.url;
        }
      }
    });
    
    return registration;
  } catch (err) {
    console.error('Service worker registration failed:', err);
    return null;
  }
}
