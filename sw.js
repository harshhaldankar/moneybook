/* Offline support: cache the app shell, serve it when there's no network. */
const CACHE = 'moneybook-v7';
const SHELL = [
    './', './index.html', './css/icons.css', './css/style.css', './fonts/lucide.woff2', './js/config.js', './js/parser.js', './js/data.js', './js/statement.js', './js/native.js', './js/app.js', './manifest.json', './icons/icon.svg',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

// Network first (so updates show up), fall back to cache when offline
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        fetch(event.request)
            .then(res => {
                const copy = res.clone();
                caches.open(CACHE).then(cache => cache.put(event.request, copy));
                return res;
            })
            .catch(() => caches.match(event.request))
    );
});
