// Service Worker para Task Manager PWA
// Maneja el caché y el funcionamiento offline

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

// Cuando se instala el SW, guardamos todos los archivos esenciales
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Cuando se activa, limpiamos versiones viejas del caché
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

// Interceptamos las peticiones y las respondemos desde caché o red
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Solo manejamos peticiones a nuestro propio servidor
  if (url.origin !== location.origin) return;

  // Para las APIs: intenta internet primero, si falla usa caché
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Si la respuesta es buena, guárdala en caché
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then(cached => {
          // Si no hay internet ni caché, devuelve una respuesta vacía
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

  // Para archivos (HTML, JS, CSS, imágenes): usa caché primero
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;

        return fetch(event.request)
          .then(networkRes => {
            // Guarda la respuesta nueva en caché
            if (networkRes.ok) {
              const clone = networkRes.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return networkRes;
          })
          .catch(() => {
            // Si es una página HTML y no hay conexión, muestra offline.html
            if (event.request.mode === 'navigate') {
              return caches.match('/public/offline.html');
            }
          });
      })
  );
});

// Cuando llega una notificación push del servidor
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

// Cuando el usuario hace clic en una notificación
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/app';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Si ya hay una pestaña abierta con la app, la enfocamos
      for (const client of windowClients) {
        if (client.url.includes('/app') && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no hay ninguna abierta, abrimos una nueva
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
