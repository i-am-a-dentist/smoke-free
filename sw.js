// Offline: serve cached files first, refresh the cache in the background
const CACHE = "smokefree-v1";
const FILES = ["./", "index.html", "manifest.json", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok && (r.type === "basic" || r.type === "cors")) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
