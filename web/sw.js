const PREFIX = `meloa-web-${new URL(self.registration.scope).pathname}-`;
const CACHE = `${PREFIX}v2`;
const ASSETS = ['./', './index.html', './style.css', './app.js', './audio.js', './storage.js', './manifest.webmanifest', './icons/icon-256.png', './icons/icon-192.png', './icons/icon-512.png', './demo/first_mix.meloa.json', './demo/lead.wav', './demo/bass.wav', './demo/pad.wav'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // Only app-owned files are cached; imported audio stays in IndexedDB.
  if (!ASSETS.some(asset => new URL(asset, self.registration.scope).href === url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
