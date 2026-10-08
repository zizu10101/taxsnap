importScripts("/sw-routing.js");

// v3: bumped when RSC / page-data requests stopped being cached. Changing
// this string changes sw.js's bytes, which is what makes the browser install
// this worker over the old one; activate then deletes every other cache, so
// the stale page data the v2 worker stored is dropped.
const CACHE_NAME = "taxsnap-shell-v3";
const APP_SHELL = ["/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  // Don't wait for every tab on the old worker to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  // Take over pages that are already open instead of waiting for a reload.
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // The decision lives in sw-routing.js (unit-tested).
  const strategy = self.TaxSnapSwRouting.decideFetchStrategy(
    request,
    self.location.origin,
  );

  // Not intercepted at all: the browser fetches it directly. This is also how
  // "network-only" works - no respondWith, so nothing is read from or written
  // to the cache, and Next's RSC / page-data requests always see the server.
  if (strategy === "bypass" || strategy === "network-only") return;

  // Full page loads: always prefer a fresh response; the cache is only an
  // offline fallback.
  if (strategy === "network-first") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Static, content-hashed assets (JS/CSS/fonts/icons) never change under
  // the same URL, so cache-first is safe and fast here.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});
