self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const rawTitle = String(payload.title || "").trim();
  const title = rawTitle.replace(/^from\s+ag[oô]n\s*:?\s*/i, "").trim() || "L'arène des idées";
  const options = {
    body: payload.body || "Nouvelle activité sur agôn.",
    icon: payload.icon || "/icon-192-optimized.png",
    badge: payload.badge || "/icon-192-optimized.png",
    data: {
      url: payload.url || "/"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/";

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of windowClients) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
