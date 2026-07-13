// service-worker.js
// QUAN TRỌNG: CACHE_VERSION phải khớp với window.APP_VERSION trong version.js.
// Khi bạn bump APP_VERSION → service worker cũ bị xoá cache, client tải toàn bộ file mới.
// Các request ?v=... (versioned URLs) được cache theo URL đầy đủ nên không bao giờ trả
// bản cũ sai version — URL cũ và URL mới là 2 entry cache khác nhau.
const CACHE_VERSION = 'mh64-2026.07.13-03'; // đồng bộ với APP_VERSION trong version.js

// version.js + index.html là 2 file không có query-string version → phải luôn fetch mới
const ALWAYS_NETWORK = ['/version.js', './version.js', 'version.js'];

// Các domain gọi Google Apps Script → network-first
const NETWORK_FIRST_HOSTS = ['script.google.com', 'appsscript.google.com'];

self.addEventListener('install', (event) => {
  // Chỉ pre-cache index.html và version.js; các file JS/CSS có ?v= sẽ tự cache khi được fetch
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(['./index.html', './version.js', './manifest.json'])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // version.js: luôn network-first để client luôn biết version mới nhất
  const isVersionFile = ALWAYS_NETWORK.some((p) => url.pathname.endsWith('version.js'));
  if (isVersionFile) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Google Apps Script API: network-first
  const isApiCall = NETWORK_FIRST_HOSTS.some((host) => url.hostname.includes(host));
  if (isApiCall) {
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

  // Các asset có ?v= (style.css?v=..., app.js?v=...): cache-first vì URL đã unique theo version
  // Các file khác: cache-first với background update
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
