// Service worker for the installable app: only shows notifications and opens the task on click.
// No fetch handler on purpose: authenticated pages and costs are never cached on the device.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
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
