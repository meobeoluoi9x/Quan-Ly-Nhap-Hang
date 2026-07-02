const CACHE = "quan-ly-nhap-hang-v4-4-2";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./data.js", "./app.js", "./manifest.json",
  "./modules/runtime-core.js", "./modules/fill.js", "./modules/ncc.js", "./modules/stocktake.js",
  "./modules/transfer.js", "./modules/history.js", "./modules/ui.js", "./modules/bootstrap.js",
  "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
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
