// Receives pushes from the server and shows them. Deliberately no fetch handler and no caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = { title: 'Queue update', body: 'Open the app to see your place in line.', url: '/' };
  try {
    if (event.data) msg = { ...msg, ...event.data.json() };
  } catch {
    // unreadable payload: fall back to the generic message (a push must always show something)
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      // Customer updates share one tag (a newer one replaces the old). Barber "New token" alerts
      // send their own tag per token, so several new customers stack instead of hiding each other.
      tag: typeof msg.tag === 'string' && msg.tag ? msg.tag : 'queue-update',
      renotify: true,
      data: { url: msg.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      // Only ever open pages on our own origin.
      let target = new URL('/', self.location.origin);
      try {
        const u = new URL(event.notification.data?.url || '/', self.location.origin);
        if (u.origin === self.location.origin) target = u;
      } catch {
        /* keep default */
      }
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) {
        if (new URL(client.url).pathname === target.pathname) {
          await client.focus(); // that ticket is already open: bring it forward
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
