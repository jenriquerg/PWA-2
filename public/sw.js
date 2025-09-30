/* Service Worker simple:
 - cache core assets on install
 - serve from cache when offline
 - cache API responses for /api/items
 - listen push event to show notification (if push is used)
*/

const CACHE_NAME = 'pwa-case-study-v1';
const CORE_ASSETS = [
  '/',
  '/app',
  '/public/app.html',
  '/public/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Fetch strategy: try network, fallback to cache. For API /api/items prefer network but cache response.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Cache API responses for /api/items with network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // For navigation and other assets: cache-first fallback to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(networkRes => {
        // Optionally cache new assets
        return networkRes;
      }).catch(() => {
        // optionally return offline page
        return caches.match('/app') || caches.match('/');
      });
    })
  );
});

self.addEventListener('push', event => {
  let data = { title: 'Notificación', body: 'Tienes una notificación.' };
  try {
    data = event.data.json();
  } catch (e) {}
  const options = {
    body: data.body,
    tag: 'pwa-push',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});
