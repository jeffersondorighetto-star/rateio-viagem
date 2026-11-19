// Catálogo de bebidas: IDs fixos (nunca apagados), nota só com fonte independente + link + data, álcool sempre com ABV, preço em faixa com mês.
const assert = require('assert'), frozen = require('./catalog-ids.json');
const L = require('./load-logic')(['BEVERAGES', 'DRINKS', 'BEV_STYLES', 'CATALOG_VERSION', 'validRating', 'bestRating', 'bevAlcoholic', 'styleLabels', 'PAIRINGS', 'WINES', 'CHEF', 'pairStyles', 'bevVerdict', 'priceTxt']);
// 1) IDs congelados: nenhum some (aposentar = retired, nunca apagar)
for (const id of frozen.beverages) assert(L.BEVERAGES[id], 'ID de bebida apagado: ' + id + ' (use retired)');
for (const id of frozen.drinks) assert(L.DRINKS[id], 'ID de drink apagado: ' + id);
for (const id of frozen.styles) assert(L.BEV_STYLES[id], 'ID de estilo apagado: ' + id);
for (const id of frozen.wines_v1) assert(L.BEVERAGES[id] && L.WINES[id], 'vinho do catálogo 1 sumiu: ' + id);
assert(/^\d{4}-\d{2}-\d{2}\.\d+$/.test(L.CATALOG_VERSION));
// 2) Regras de nota
const bad = [{ points: 95, critic: 'Decanter', url: 'https://x', checkedOn: '2026-11-19' }, // sem independent
  { points: 95, critic: 'Decanter', independent: true, checkedOn: '2026-11-19' }, // sem link
  { points: 95, critic: 'Decanter', independent: true, url: 'https://x' }, // sem data
  { points: 95, critic: 'Ficha do produtor', independent: true, url: 'https://x', checkedOn: '2026-11-19' }, { points: 93, critic: 'Loja X', independent: true, url: 'https://x', checkedOn: '2026-11-19' }];
for (const r of bad) assert(!L.validRating(r), 'nota inválida aceita: ' + JSON.stringify(r));
const FORBIDDEN_TEXT = ['text', 'review', 'notes', 'tasting', 'quote'];
for (const [id, b] of Object.entries(L.BEVERAGES)) {
  for (const r of b.ratings || []) { assert(L.validRating(r), 'nota sem fonte independente/link/data: ' + id); for (const k of FORBIDDEN_TEXT) assert(!(k in r), 'texto de resenha não pode: ' + id); }
  assert(b.style && L.BEV_STYLES[b.style], 'estilo: ' + id); assert(['entrada', 'medio', 'alto', 'icone'].includes(b.tier), 'faixa: ' + id);
  assert(Array.isArray(b.price) && b.price.length === 2 && b.price[0] > 0 && b.price[1] >= b.price[0], 'preço em faixa: ' + id);
  assert(b.abv && typeof b.abv.value === 'number' && b.abv.basis, 'ABV obrigatório: ' + id);
  if (L.bevAlcoholic(b)) assert(b.abv.value > 0.5, 'alcoólico com ABV: ' + id);
  assert(!/https?:\/\/[^ ]*(utm_|aff|ref=|tag=)/i.test(JSON.stringify(b)), 'sem link com rastreio: ' + id);
  assert(!('buyUrl' in b) && !('sponsor' in b), 'sem compra/patrocínio: ' + id);
}
for (const [id, d] of Object.entries(L.DRINKS)) { assert(d.abv && typeof d.abv.value === 'number', 'ABV do drink: ' + id); if (!d.zero) assert(d.abv.value > 0, 'drink alcoólico com ABV: ' + id); assert(d.jar > 0 && d.ing.length, 'receita por jarra: ' + id); }
for (const m of ['beira', 'aperitivo', 'pos']) { const ds = Object.values(L.DRINKS).filter(d => d.moment === m); assert.equal(ds.length, 3, 'três drinks em ' + m); assert(ds.some(d => d.zero), 'um sem álcool em ' + m); }
assert(/faixa aproximada, nov\/2026/.test(L.priceTxt(L.BEVERAGES.catena_app)));
// 3) Pedido do Jefferson: churrasco com sobremesa gelada = Malbec, Tannat e Chablis; 3 rótulos por estilo
assert.deepStrictEqual(L.pairStyles(['c_churrasco', 'c_abacaxi_grelhado'], 'wine'), ['st_malbec', 'st_tannat', 'st_chablis']);
for (const st of ['st_malbec', 'st_tannat', 'st_chablis', 'st_dark_lager', 'st_ipa', 'st_weiss', 'st_stout']) assert.equal(L.styleLabels(st).length, 3, '3 rótulos: ' + st);
assert.equal(L.bevVerdict('catena_app', ['c_churrasco']), 'Combina'); assert.equal(L.bevVerdict('ponto_nero', ['c_churrasco', 'c_mousse_maracuja']), 'Melhor com a sobremesa');
assert.equal(L.bevVerdict('whispering', ['c_churrasco']), 'Não combina'); assert.equal(L.bevVerdict('z_suco_uva', ['c_churrasco']), 'Combina');
// 4) Notas conferidas que o Jefferson perguntou
assert.equal(L.bestRating(L.BEVERAGES.w_adrianna_river).points, 97); assert.equal(L.bestRating(L.BEVERAGES.w_bouza_tannat).points, 92);
assert.equal(L.bestRating(L.BEVERAGES.ruffino), null, 'Ruffino sem fonte independente aberta = Sem nota');
console.log(`CATALOG TESTS PASSED (${Object.keys(L.BEVERAGES).length} rótulos, ${Object.keys(L.DRINKS).length} drinks, versão ${L.CATALOG_VERSION}: IDs fixos, notas com fonte/link/data, ABV, faixas, pareamentos)`);
