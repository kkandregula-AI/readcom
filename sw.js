/* Local Reading Companion — minimal offline service worker.
   Deploy next to index.html. Caches the app shell so it opens offline.
   The on-device model is separate: once Gemini Nano is downloaded by
   Chrome, inference itself already works with no network. */

const CACHE = "reading-companion-v1";
const SHELL = [
  "./",
  "./index.html",
  // Fonts are same-origin? No — they're on Google's CDN. Cache them at runtime
  // (see fetch handler) so first online visit primes them for offline use.
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first for the shell + fonts; network-first would also be fine.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // Runtime-cache successful same-origin + font responses.
        const url = new URL(req.url);
        const cacheable =
          url.origin === location.origin ||
          url.hostname.endsWith("fonts.googleapis.com") ||
          url.hostname.endsWith("fonts.gstatic.com") ||
          url.hostname.endsWith("esm.run") ||
          url.hostname.endsWith("jsdelivr.net"); // WebLLM library (weights are cached by WebLLM itself)
        if (cacheable && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit); // offline + uncached → whatever we have
    })
  );
});
