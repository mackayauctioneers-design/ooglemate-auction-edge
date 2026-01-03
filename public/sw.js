/// <reference lib="webworker" />

// OogleMate Service Worker for push notifications and app badge

const SW_VERSION = '1.0.0';

// Cache name for offline support
const CACHE_NAME = `oglemate-cache-v${SW_VERSION}`;

// Install event - cache basic assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker v' + SW_VERSION);
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('oglemate-cache-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Push notification event
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');
  
  if (!event.data) {
    console.log('[SW] Push event has no data');
    return;
  }

  try {
    const data = event.data.json();
    console.log('[SW] Push data:', data);

    const title = data.title || 'OogleMate Alert';
    const options = {
      body: data.body || 'New BUY opportunity available',
      icon: '/pwa-192x192.png',
      badge: '/pwa-badge-72x72.png',
      tag: data.tag || 'buy-alert',
      renotify: true,
      requireInteraction: true,
      data: {
        url: data.url || '/',
        alertId: data.alertId,
        // Bob-specific context for voice playback on tap
        bobContext: data.data || null,
      },
      actions: [
        { action: 'open', title: 'View' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };

    // Update app badge count
    if (data.badgeCount !== undefined && 'setAppBadge' in navigator) {
      if (data.badgeCount > 0) {
        navigator.setAppBadge(data.badgeCount);
      } else {
        navigator.clearAppBadge();
      }
    }

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (err) {
    console.error('[SW] Error processing push:', err);
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const urlToOpen = event.notification.data?.url || '/';
  const bobContext = event.notification.data?.bobContext || null;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url: urlToOpen,
            alertId: event.notification.data?.alertId,
            // Include Bob context for voice playback
            bobContext: bobContext,
          });
          return;
        }
      }
      // Open new window if none exists - URL already has bob_context param
      return self.clients.openWindow(urlToOpen);
    })
  );
});

// Message handler for badge updates from the main thread
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data?.type === 'UPDATE_BADGE') {
    const count = event.data.count || 0;
    if ('setAppBadge' in navigator) {
      if (count > 0) {
        navigator.setAppBadge(count);
      } else {
        navigator.clearAppBadge();
      }
    }
  }
});
