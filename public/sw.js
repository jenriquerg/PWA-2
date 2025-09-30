/* sw.js — Service Worker completo PWA Task Manager */

const CACHE_NAME = 'pwa-task-manager-v1';
const CORE_ASSETS = [
  '/',
  '/app',
  '/public/app.html',
  '/spp.js', // tu script principal
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html'
];

// --- Install: cache core assets ---
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// --- Activate: limpiar caches viejos ---
self.addEventListener('activate', event => {
  const currentCaches = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (!currentCaches.includes(key)) return caches.delete(key);
      }))
    ).then(() => self.clients.claim())
  );
});

// --- Fetch: network-first para API, cache-first para otros assets ---
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-first para API /api/tasks
  if (url.pathname.startsWith('/api/tasks')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first para navegación y otros assets
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request)
        .then(networkRes => networkRes)
        .catch(() => caches.match('/offline.html'))
      )
  );
});

// --- Push notifications ---
self.addEventListener('push', event => {
  let data = { title: 'Notificación', body: 'Tienes una notificación.', url: '/' };
  try { data = event.data.json(); } catch(e) {}
  const options = {
    body: data.body,
    tag: 'pwa-push',
    renotify: true,
    icon: '/icons/icon-192.png',
    data: { url: data.url }
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

// --- Click en notificación ---
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
