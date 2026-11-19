// Service worker (Hefesto): rede primeiro, mas com prazo de ~3 s; depois disso abre a cópia do aparelho (ficha de alergia com sinal fraco).
const assert = require('assert'), fs = require('fs'), path = require('path');
const { netOrCache, NET_TIMEOUT_MS } = require('../sw.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
assert(NET_TIMEOUT_MS >= 2000 && NET_TIMEOUT_MS <= 3500, 'prazo da rede em torno de 3 s');
assert(/respondWith\(netOrCache\(/.test(src), 'fetch usa a corrida rede × prazo');
assert(/supabase\.co'\)\) return/.test(src), 'API do servidor nunca vem do cache');
const later = (ms, v, fail) => new Promise((ok, ko) => setTimeout(() => fail ? ko(new Error(v)) : ok(v), ms));
const hit = v => () => Promise.resolve(v);
(async () => {
  assert.equal(await netOrCache(later(20, 'rede'), hit('cópia'), 200), 'rede', 'rede rápida vence');
  let t0 = Date.now(); assert.equal(await netOrCache(later(2000, 'rede'), hit('cópia'), 100), 'cópia', 'rede lenta: abre a cópia no prazo');
  assert(Date.now() - t0 < 1000, 'não espera a rede lenta');
  assert.equal(await netOrCache(later(10, 'off', true), hit('cópia'), 200), 'cópia', 'sem rede: cópia');
  assert.equal(await netOrCache(later(300, 'rede'), hit(undefined), 50), 'rede', 'sem cópia: espera a rede');
  await assert.rejects(netOrCache(later(10, 'off', true), hit(undefined), 200), /off/, 'sem rede e sem cópia: erro');
  console.log(`SW TESTS PASSED (prazo ${NET_TIMEOUT_MS} ms, rede rápida, rede lenta → cópia, offline → cópia, sem cópia → rede)`);
})().catch(e => { console.error(e); process.exit(1); });
