'use strict';

const APP_VERSION = '4.4.1';
const CACHE_BUILD = 'evidence-correctness-1';
const SHELL_CACHE = `lifeos-shell-${APP_VERSION}-${CACHE_BUILD}`;
const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './planning-worker.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(error => {
        console.error('[LifeOS PWA] Application-shell installation failed. Verify every APP_SHELL resource.', error);
        throw error;
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('lifeos-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.put('./index.html', response.clone())));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  const shellUrls = new Set(APP_SHELL.map(item => new URL(item, self.registration.scope).href));
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && shellUrls.has(url.href)) event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone())));
      return response;
    }))
  );
});

// IndexedDB user records are intentionally never copied into Cache Storage.
