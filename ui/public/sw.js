const CACHE_NAME = "withings-trends-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      // Precache the hashed build assets referenced by the app shell so the first offline launch works.
      const html = await (await cache.match("/"))?.text();
      const assets = [...(html ?? "").matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
      await cache.addAll(assets);
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/cgi-bin/") ||
    url.pathname === "/healthz"
  ) {
    return;
  }

  // Network first so the dashboard always shows fresh code; fall back to cache when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(
        async () =>
          (await caches.match(request)) ??
          (request.mode === "navigate" ? await caches.match("/") : undefined) ??
          Response.error()
      )
  );
});
