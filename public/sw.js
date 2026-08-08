/* Dina service worker — offline shell + web push */
const CACHE = "dina-shell-v1";
const SHELL = ["/", "/offline", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const offline = await caches.match("/offline");
          if (offline) return offline;
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Dina",
    body: "You have a new update.",
    url: "/",
    target: null,
  };

  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    // keep generic defaults
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Dina", {
      body: payload.body || "You have a new update.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: {
        url: payload.url || "/",
        target: payload.target || null,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let path = data.url || "/";

  // Structured deep-link extension point for future message/approval targeting
  if (data.target?.type === "attention" && data.target?.id) {
    path = `/?attention=${encodeURIComponent(data.target.id)}`;
  } else if (data.target?.type === "message" && data.target?.id) {
    path = `/?messageId=${encodeURIComponent(data.target.id)}`;
  } else if (data.target?.type === "approval" && data.target?.id) {
    path = `/?approvalId=${encodeURIComponent(data.target.id)}`;
  } else if (data.target?.type === "conversation" && data.target?.id) {
    path = `/?conversationId=${encodeURIComponent(data.target.id)}`;
  }

  const absolute = new URL(path, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(absolute);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(absolute);
      }
      return undefined;
    }),
  );
});
