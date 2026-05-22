/* XPERT Moto service worker — handles web push notifications. */
// A static service worker can't read getBranding() at runtime. The push
// payload carries its own `title`; the literal below is only the fallback
// for an untitled push, so it's the one place a per-deployment brand string
// is unavoidable.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "XPERT Moto", body: event.data.text() };
  }
  const { title = "XPERT Moto", body = "", url = "/", tag } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/images/icon-192.png",
      badge: "/images/badge-72.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = all.find((c) => c.url.includes(targetUrl));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })(),
  );
});
