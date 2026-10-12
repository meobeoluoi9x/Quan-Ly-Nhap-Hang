// Đổi ASSET_VERSION cùng lúc với "?v=" trong index.html mỗi lần phát hành.
const ASSET_VERSION = '5.5.2';
const CACHE_NAME = `qlnh-cache-v${ASSET_VERSION}`;

const VERSIONED_ASSETS = [
  './styles.css',
  './data.js',
  './app.js',
  './manifest.json',
  './modules/bootstrap.js',
  './modules/dashboard.js',
  './modules/fill.js',
  './modules/history.js',
  './modules/ncc.js',
  './modules/order.js',
  './modules/runtime-core.js',
  './modules/stocktake.js',
  './modules/transfer.js',
  './modules/ui.js',
  './modules/xlsx.js'
].map(path => `${path}?v=${ASSET_VERSION}`);

// Cache đúng URL mà index.html yêu cầu (có ?v=) để app mở được offline ngay sau lần cài đầu tiên.
const ASSETS_TO_CACHE = ['./', './index.html', './icon-192.png', './icon-512.png', ...VERSIONED_ASSETS];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function putInCache(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
  return response;
}

// Trang HTML: lấy từ mạng trước để luôn nhận bản mới sau khi deploy; mất mạng thì dùng bản đã cache.
function networkFirst(request) {
  return fetch(request)
    .then(response => putInCache(request, response))
    .catch(() => caches.match(request, { ignoreSearch: true })
      .then(cached => cached || caches.match('./index.html')));
}

// JS/CSS/ảnh: dùng cache trước. File có ?v= không đổi nội dung trong cùng một phiên bản,
// và cache cũ bị xóa toàn bộ khi CACHE_NAME đổi.
function cacheFirst(request) {
  return caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request)
      .then(response => putInCache(request, response))
      .catch(() => caches.match(request, { ignoreSearch: true }));
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Không đụng tới request ghi dữ liệu hoặc gọi ra ngoài (Supabase, CDN).
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isPage = request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  event.respondWith(isPage ? networkFirst(request) : cacheFirst(request));
});