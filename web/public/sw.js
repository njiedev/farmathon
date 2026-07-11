const CACHE = "fieldhand-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/assets/corn-field-hero.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    const clone = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, clone)); return response;
  }).catch(() => caches.match(event.request).then((response) => response || caches.match("/"))));
});
