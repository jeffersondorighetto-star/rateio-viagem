// Rateatouille: abre sem internet. Guarda o app (index.html) e a biblioteca do Supabase no cache do aparelho.
// Os dados (cardápio, alergias, gastos) já ficam no localStorage; aqui só o "casco" do app.
const PREFIX = 'rateatouille-pb-preview-'; // cada cópia do app (principal, prévias) usa o próprio prefixo: o cache é do domínio inteiro
const CACHE = PREFIX + '2026-11-19';
const SHELL = ['./', './index.html'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname.endsWith('supabase.co')) return; // API do servidor: nunca do cache
  const isApp = u.origin === location.origin, isLib = u.hostname === 'cdn.jsdelivr.net';
  if (!isApp && !isLib) return;
  // rede primeiro (pega a versão nova), cache se estiver sem internet
  e.respondWith(fetch(e.request).then(r => { if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
