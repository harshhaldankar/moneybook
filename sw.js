/* Offline support: cache the app shell, serve it when there's no network. */
const CACHE = 'moneybook-v2';
const SHELL = [
    './', './index.html', './css/style.css', './js/data.js', './js/app.js', './manifest.json', './icons/icon.svg',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
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
