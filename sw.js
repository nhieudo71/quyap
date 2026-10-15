// Service Worker — Quản Lý Tài Chính Khu Phố
// Tách riêng để PWA offline ổn định khi được host qua HTTPS.
const CACHE = 'khu-pho-finance-v6';

// App shell tĩnh được cache sẵn khi cài đặt
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // KHÔNG cache lưu lượng Firebase/Firestore (dữ liệu động, realtime)
  if (/firestore|firebase|googleapis\.com\/.*firebase|identitytoolkit/.test(url.href)) {
    return; // để trình duyệt xử lý mặc định (online)
  }

  // Điều hướng trang (HTML): network-first, fallback cache để mở offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put('./index.html', clone));
        return resp;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Tài nguyên khác (font, thư viện CDN, icon): cache-first, cập nhật nền
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(resp => {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
