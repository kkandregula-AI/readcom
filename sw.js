/* Local Reading Companion — service worker.
   Designed & Architected by Krishnamurthy Kandregula · Made by Claude

   v2: HTML is now NETWORK-FIRST, so a freshly deployed page is always picked up
   when online (this fixes the "old version keeps showing" problem). The app
   still works offline by falling back to the cached copy. Fonts and libraries
   stay cache-first for speed; model weights are cached by WebLLM itself. */

const CACHE = "reading-companion-v4";     // bump this string on any deploy to force a refresh
const SHELL = ["./", "./index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // The page itself: network-first so new deploys show immediately; cache is the offline fallback.
  const isHTML = req.mode === "navigate" || req.destination === "document"
    || url.pathname.endsWith("/") || url.pathname.endsWith("index.html");
  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // Everything else (fonts, CDN libraries): cache-first, filled in at runtime.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        const cacheable =
          url.origin === location.origin ||
          url.hostname.endsWith("fonts.googleapis.com") ||
          url.hostname.endsWith("fonts.gstatic.com") ||
          url.hostname.endsWith("esm.run") ||
          url.hostname.endsWith("jsdelivr.net");
        if (cacheable && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
    })
  );
});
