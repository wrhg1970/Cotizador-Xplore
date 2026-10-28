// Service worker for the installable app: only shows notifications and opens the task on click.
// No fetch handler on purpose: authenticated pages and costs are never cached on the device.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// Web Push from the server: folio, group and a link only (the API never puts prices in a push).
self.addEventListener('push', (e) => {
  const msg = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(msg.title || 'Cotizador EE', {
      body: msg.body || 'Tienes un pendiente nuevo',
      tag: msg.tag,
      icon: '/pwa/icon-192.png',
      data: { url: msg.url || '/inicio' },
    }),
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/inicio', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url === url) || list[0];
      return open ? open.navigate(url).then((c) => (c || open).focus()) : self.clients.openWindow(url);
    }),
  );
});
