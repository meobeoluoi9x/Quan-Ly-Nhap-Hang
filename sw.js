const CACHE_NAME = 'qlnh-cache-v5.5.3';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
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
];

// 1. Cài đặt Service Worker và lưu cache các file tĩnh
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// 2. Kích hoạt và dọn sạch triệt để các phiên bản cache cũ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Xóa cache cũ:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// 3. Xử lý yêu cầu mạng (Fetch Strategy)
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Bỏ qua không cache các request API hoặc đồng bộ dữ liệu (Supabase, CDN ngoài, POST/PUT)
  if (
    event.request.method !== 'GET' ||
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname.includes('/rest/v1/') ||
    requestUrl.pathname.includes('/auth/v1/')
  ) {
    return;
  }

  // Chiến lược: Network-First cho dữ liệu/HTML, Cache-First cho tài nguyên tĩnh
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Trả về file từ cache trước, đồng thời cập nhật ngầm nếu có mạng
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {/* Offline mode */});

        return cachedResponse;
      }

      // Nếu chưa có trong cache thì tải từ mạng
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});