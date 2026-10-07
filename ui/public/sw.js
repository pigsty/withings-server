const CACHE_NAME = "withings-trends-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png"];

function assetsReferencedBy(html) {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
}

// Precache the hashed build assets referenced by the shell and drop any that are no longer used.
async function syncShellAssets(cache, html) {
  const assets = assetsReferencedBy(html);
  await Promise.allSettled(assets.map((asset) => cache.add(asset)));

  const keep = new Set(assets);
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((key) => {
        const { pathname } = new URL(key.url);
        return pathname.startsWith("/assets/") && !keep.has(pathname);
      })
      .map((key) => cache.delete(key))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      const shell = await cache.match("/");
      if (shell) {
        await syncShellAssets(cache, await shell.text());
      }
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
  if (url.origin !== self.location.origin) {
    return;
  }

  const isNavigation = request.mode === "navigate";
  const isCacheable =
    isNavigation || url.pathname.startsWith("/assets/") || APP_SHELL.includes(url.pathname);
  if (
    !isCacheable ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/cgi-bin/") ||
    url.pathname === "/healthz"
  ) {
    return;
  }

  // Network first so the dashboard always shows fresh code; fall back to cache when offline.
  // All UI routes serve the same index.html, so navigations are stored under "/".
  const cacheKey = isNavigation ? "/" : request;
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            (async () => {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(cacheKey, copy.clone());
              if (isNavigation) {
                await syncShellAssets(cache, await copy.text());
              }
            })()
          );
        }
        return response;
      } catch {
        return (await caches.match(cacheKey)) ?? Response.error();
      }
    })()
  );
});
