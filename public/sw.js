/* sw.js — Service Worker completo PWA Task Manager */

const CACHE_NAME = 'pwa-task-manager-v2';
const CORE_ASSETS = [
  '/app',
  '/public/app.html',
  '/public/app.js',
  '/public/manifest.json',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
  '/public/offline.html'
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

// --- Fetch: estrategia híbrida para mejor offline ---
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Solo interceptar peticiones al mismo origen
  if (url.origin !== location.origin) return;

  // Network-first para APIs (con fallback a cache)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Cachear solo respuestas exitosas
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then(cached => {
          // Si no hay cache, devolver respuesta offline
          if (!cached) {
            return new Response(JSON.stringify({ ok: false, offline: true, tasks: [] }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return cached;
        }))
    );
    return;
  }

  // Cache-first para assets estáticos (HTML, CSS, JS, imágenes)
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;

        return fetch(event.request)
          .then(networkRes => {
            // Cachear la respuesta para futuras peticiones
            if (networkRes.ok) {
              const clone = networkRes.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return networkRes;
          })
          .catch(() => {
            // Fallback a offline.html solo para navegación HTML
            if (event.request.mode === 'navigate') {
              return caches.match('/public/offline.html');
            }
          });
      })
  );
});

// --- Push notifications ---
self.addEventListener('push', event => {
  let data = { title: 'Notificación', body: 'Tienes una notificación.', url: '/app' };
  try { data = event.data.json(); } catch(e) {}
  const options = {
    body: data.body,
    tag: 'pwa-push',
    renotify: true,
    icon: '/public/icons/icon-192.png',
    badge: '/public/icons/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url }
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

// --- Click en notificación ---
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/app';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Si ya hay una ventana abierta, enfocarla
      for (const client of windowClients) {
        if (client.url.includes('/app') && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no, abrir nueva ventana
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
