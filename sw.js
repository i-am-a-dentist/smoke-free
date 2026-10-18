// Offline: serve cached files first, refresh the cache in the background
const CACHE = "smokefree-v2";
const FILES = ["./", "index.html", "manifest.json", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Shortcut links like ./?sos open the same cached page
  const opts = e.request.mode === "navigate" ? { ignoreSearch: true } : undefined;
  const font = FONT_HOSTS.includes(new URL(e.request.url).hostname);
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, opts);
    const net = fetch(e.request).then(r => {
      // The font stylesheet comes back opaque (no-cors), keep it anyway so fonts work offline
      if ((r.ok && (r.type === "basic" || r.type === "cors")) || (font && r.type === "opaque")) c.put(e.request, r.clone());
      return r;
    }).catch(() => hit || Response.error());
    return hit || net;
  }));
});
