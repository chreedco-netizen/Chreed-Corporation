// Servicio de la app "Mi cuenta Chreed": aviso sin conexión y notificaciones al celular.
// No guarda copias de los datos: todo se consulta en línea, para que la información
// de facturas nunca quede almacenada en el dispositivo.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!DOCTYPE html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Mi cuenta Chreed</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'background:#4A033D;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:16px">' +
      '<div><h1 style="font-size:20px">Sin conexión a internet</h1><p>Mi cuenta Chreed necesita internet. Revisa tu conexión y vuelve a intentarlo.</p>' +
      '<button onclick="location.reload()" style="background:#E8B04B;border:0;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer">Reintentar</button></div></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    ))
  );
});

// Notificaciones
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Chreed Corporation', {
    body: d.body || '',
    icon: '/img/icon-192.png',
    badge: '/img/favicon-32.png',
    data: { url: d.url || '/cuenta/' },
    lang: 'es'
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/cuenta/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.includes('/cuenta/') && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
