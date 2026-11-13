/* 三つ日記 · Mitsu Nikki — service worker
 * - App disponible sin conexión (stale-while-revalidate para los archivos propios).
 * - data.json siempre desde la red si se puede.
 * - Recordatorio con Periodic Background Sync cuando Chrome lo permite.
 */
const VERSION = 'mn-v1';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.json',
  './icons/logo.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/badge-96.png',
];
const KEEP = [VERSION, 'mn-fonts', 'mn-config'];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  const network = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'api.github.com') return; // nunca cachear la API
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    ev.respondWith(staleWhileRevalidate(req, 'mn-fonts'));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/__mn-config')) return;

  if (url.pathname.endsWith('/data.json')) {
    ev.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || new Response('[]', { headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  ev.respondWith(staleWhileRevalidate(req, VERSION));
});

/* ---------- Notificaciones ---------- */
self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const target = (ev.notification.data && ev.notification.data.url) || self.registration.scope;
  ev.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if (c.url.startsWith(self.registration.scope)) return c.focus();
    return self.clients.openWindow(target);
  })());
});

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function maybeRemind() {
  const cache = await caches.open('mn-config');
  const res = await cache.match('./__mn-config');
  if (!res) return;
  const cfg = await res.json();
  if (!cfg.notif) return;
  const now = new Date();
  const today = keyOf(now);
  const [h, m] = (cfg.hour || '21:00').split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  if (cfg.doneDate === today || cfg.notified === today) return;
  await self.registration.showNotification('三つ日記 · Mitsu Nikki', {
    body: 'Buenas noches. ¿Cuáles han sido tus 3 cosas buenas de hoy?',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: 'mn-recordatorio',
    data: { url: self.registration.scope },
  });
  cfg.notified = today;
  await cache.put('./__mn-config', new Response(JSON.stringify(cfg), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('periodicsync', ev => {
  if (ev.tag === 'mn-recordatorio') ev.waitUntil(maybeRemind());
});
