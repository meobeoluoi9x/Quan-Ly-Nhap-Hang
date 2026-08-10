const CACHE = "quan-ly-nhap-hang-v5-4-13";
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "::1"];
const IS_LOCAL_PREVIEW = LOCAL_HOSTS.includes(self.location.hostname);
const ASSETS = [
  "./", "./index.html", "./styles.css", "./data.js", "./app.js", "./manifest.json",
  "./modules/order.js", "./modules/dashboard.js", "./modules/runtime-core.js", "./modules/xlsx.js", "./modules/fill.js", "./modules/ncc.js", "./modules/stocktake.js",
  "./modules/transfer.js", "./modules/history.js", "./modules/ui.js", "./modules/bootstrap.js",
  "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  if (IS_LOCAL_PREVIEW) return;
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => IS_LOCAL_PREVIEW || key !== CACHE).map(key => caches.delete(key)));
    if (IS_LOCAL_PREVIEW) {
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      await Promise.all(clients.map(client => client.navigate(client.url)));
      return;
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (IS_LOCAL_PREVIEW) return;
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(async response => {
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put("./index.html", response.clone());
          }
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});







