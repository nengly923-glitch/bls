// I&hmong-mobile Service Worker
const CACHE_NAME = 'ihmong-cache-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Always fetch fresh from network for real-time SQLite sync
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
