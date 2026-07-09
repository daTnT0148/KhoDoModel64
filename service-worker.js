// service-worker.js
// PWA offline cache cho Mô Hình 64 - Quản Lý Kho.
// Bump CACHE_VERSION mỗi khi danh sách STATIC_ASSETS hoặc nội dung cache cần đổi,
// để buộc client tải lại bản mới (activate sẽ tự xoá cache cũ).
const CACHE_VERSION = 'mh64-cache-v1';

// Các file tĩnh của app — cache ngay khi service worker cài đặt
const STATIC_ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './mock_db.js',
  './manifest.json'
];

// Các domain gọi Google Apps Script (dữ liệu sống, không phải asset tĩnh) → network-first
const NETWORK_FIRST_HOSTS = ['script.google.com', 'appsscript.google.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Kích hoạt service worker mới ngay, không đợi tab cũ đóng hết
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION) // xoá mọi cache version cũ
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Không can thiệp các request không phải GET (VD: POST lên Apps Script để lưu dữ liệu)
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isApiCall = NETWORK_FIRST_HOSTS.some((host) => url.hostname.includes(host));

  if (isApiCall) {
    // Network-first: luôn ưu tiên dữ liệu mới nhất, chỉ dùng cache khi mất mạng
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first cho asset tĩnh của app — mở nhanh, tự cập nhật cache ngầm nếu có bản mới
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        return response;
      });
    })
  );
});
