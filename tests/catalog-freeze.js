// Congela o catálogo: grava a versão, a impressão digital (sha256) e as listas de IDs (só cresce) em tests/catalog-ids.json.
// Uso: depois de mexer no catálogo, suba CATALOG_VERSION no index.html e rode `node tests/catalog-freeze.js`.
// Recusa gravar se o catálogo mudou e a versão não subiu, ou se algum ID congelado sumiu.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const file = path.join(__dirname, 'catalog-ids.json');
function snapshot() {
  const L = require('./load-logic')(['BEVERAGES', 'DRINKS', 'BEV_STYLES', 'PAIRINGS', 'WINE_SERVICE', 'CATALOG_VERSION', 'WINES']);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ b: L.BEVERAGES, d: L.DRINKS, s: L.BEV_STYLES, p: L.PAIRINGS, w: L.WINE_SERVICE })).digest('hex');
  return { L, fingerprint };
}
module.exports = snapshot;
if (require.main === module) {
  const { L, fingerprint } = snapshot(), old = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (old.fingerprint && old.fingerprint !== fingerprint && old.catalogVersion === L.CATALOG_VERSION) { console.error(`Catálogo mudou e CATALOG_VERSION (${L.CATALOG_VERSION}) não subiu. Suba a versão e rode de novo.`); process.exit(1); }
  const keep = (k, now) => { const gone = (old[k] || []).filter(id => !now.includes(id)); if (gone.length) { console.error(`IDs apagados em ${k}: ${gone.join(', ')} (use retired)`); process.exit(1); } return [...new Set([...(old[k] || []), ...now])].sort(); };
  const out = { catalogVersion: L.CATALOG_VERSION, fingerprint, beverages: keep('beverages', Object.keys(L.BEVERAGES)), drinks: keep('drinks', Object.keys(L.DRINKS)), styles: keep('styles', Object.keys(L.BEV_STYLES)), wines_v1: old.wines_v1 };
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n'); console.log(`catalog-ids.json: versão ${out.catalogVersion}, ${out.beverages.length} bebidas, impressão ${fingerprint.slice(0, 12)}…`);
}
