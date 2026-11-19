// Rateatouille: abre sem internet. Guarda o app (index.html) e a biblioteca do Supabase no cache do aparelho.
// Os dados (cardápio, alergias, gastos) já ficam no localStorage; aqui só o "casco" do app.
// Estratégia: rede primeiro, com prazo. Se a rede não responder em NET_TIMEOUT_MS (sinal fraco na praia) e houver cópia, abre a cópia
// e a rede continua em segundo plano atualizando o cache. Sem cópia, espera a rede. O nome do cache só muda para forçar limpeza.
const PREFIX = 'rateatouille-app-'; // cada cópia do app (principal, prévias) usa o próprio prefixo: o cache é do domínio inteiro
const CACHE = PREFIX + '2026-11-19';
const SHELL = ['./', './index.html'];
const NET_TIMEOUT_MS = 3000;
// Corrida rede × prazo. net: Promise<Response>; cached: () => Promise<Response|undefined>. Devolve a resposta da rede se chegar
// a tempo; senão a cópia (se houver); se a rede falhar, a cópia; se não houver cópia, a rede (ou o erro dela).
function netOrCache(net, cached, ms) {
  return new Promise((resolve, reject) => {
    let done = false; const finish = r => { if (!done && r) { done = true; resolve(r); return true; } return false; };
    const timer = setTimeout(() => { cached().then(m => { finish(m); }); }, ms);
    net.then(r => { clearTimeout(timer); finish(r); },
      err => { clearTimeout(timer); cached().then(m => { if (!finish(m) && !done) { done = true; reject(err); } }); });
  });
}
if (typeof self !== 'undefined' && self.addEventListener) {
  self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
  self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
  self.addEventListener('fetch', e => {
    const u = new URL(e.request.url);
    if (e.request.method !== 'GET') return;
    if (u.hostname.endsWith('supabase.co')) return; // API do servidor: nunca do cache
    const isApp = u.origin === location.origin, isLib = u.hostname === 'cdn.jsdelivr.net';
    if (!isApp && !isLib) return;
    const net = fetch(e.request).then(r => { if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; });
    const cached = () => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined));
    e.waitUntil(net.catch(() => {})); // atualização em segundo plano continua mesmo se a cópia já foi servida
    e.respondWith(netOrCache(net, cached, NET_TIMEOUT_MS));
  });
}
if (typeof module !== 'undefined') module.exports = { netOrCache, NET_TIMEOUT_MS };
