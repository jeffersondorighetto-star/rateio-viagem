// Catálogo de bebidas: IDs fixos (nunca apagados), nota só com fonte independente + link + data, álcool sempre com ABV, preço em faixa com mês.
const assert = require('assert'), frozen = require('./catalog-ids.json');
const L = require('./load-logic')(['BEVERAGES', 'DRINKS', 'BEV_STYLES', 'ITEMS', 'CATALOG_VERSION', 'validRating', 'bestRating', 'bevAlcoholic', 'styleLabels', 'PAIRINGS', 'WINES', 'CHEF', 'pairStyles', 'bevVerdict', 'priceTxt', 'WINE_TIER_LABEL', 'WINE_SERVICE', 'windowTxt', 'serviceTxt', 'adegaText', 'AGE_LINE', 'jeffersonWineErrors', 'addJeffersonWines', 'JEFFERSON_WINES', 'shoppingText', 'mesaTalk', 'styleWhy', 'dishesShort', 'pairKey']);
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
assert(/faixa aproximada, nov\/2026/.test(L.priceTxt(L.BEVERAGES.catena_app)), 'aposentado continua legível');
// 3) Pedido do Jefferson: churrasco com sobremesa gelada = Malbec, Tannat e Chablis; 3 rótulos por estilo
assert.deepStrictEqual(L.pairStyles(['c_churrasco', 'c_abacaxi_grelhado'], 'wine'), ['st_malbec', 'st_tannat', 'st_chablis']);
for (const st of ['st_malbec', 'st_tannat', 'st_chablis', 'st_dark_lager', 'st_ipa', 'st_weiss', 'st_stout']) assert.equal(L.styleLabels(st).length, 3, '3 rótulos: ' + st);
assert.equal(L.bevVerdict('catena_app', ['c_churrasco']), 'Combina'); assert.equal(L.bevVerdict('ponto_nero', ['c_churrasco', 'c_mousse_maracuja']), 'Melhor com a sobremesa');
assert.equal(L.bevVerdict('whispering', ['c_churrasco']), 'Não combina'); assert.equal(L.bevVerdict('z_suco_uva', ['c_churrasco']), 'Combina');
// 4) Notas conferidas que o Jefferson perguntou
assert.equal(L.bestRating(L.BEVERAGES.w_adrianna_river).points, 97); assert.equal(L.bestRating(L.BEVERAGES.w_bouza_tannat).points, 92);
assert.equal(L.bestRating(L.BEVERAGES.ruffino), null, 'Ruffino sem fonte independente aberta = Sem nota');
// 5) Adega premium (pedido do Jefferson, 19/11): rótulo de entrada aposentado (não apagado), 3 rótulos complexos por estilo de vinho
const RETIRED = ['miolo_cuvee', 'geisse_brut', 'leopoldina', 'mcc_chard', 'mcc_cab', 'catena_app', 'ruffino', 'ponto_nero', 'cloudy', 'whispering', 'w_alamos_malbec', 'w_donpascual_tannat', 'w_garzon_tannat',
  'w_aurora_chard', 'w_fevre_chablis', 'w_casillero_sb', 'w_casillero_rose', 'w_miolo_rose', 'w_ruffino_chianti', 'w_aurora_merlot', 'w_sc_chard', 'w_salton_moscatel', 'w_nivole'];
for (const id of RETIRED) assert(L.BEVERAGES[id] && L.BEVERAGES[id].retired && L.BEVERAGES[id].premium === false, 'aposentado sem apagar: ' + id);
const wineStyles = Object.entries(L.BEV_STYLES).filter(([, v]) => v.kind === 'wine' && !v.zero).map(([k]) => k);
assert(wineStyles.includes('st_rioja'));
for (const st of wineStyles) { const labs = L.styleLabels(st); assert.equal(labs.length, 3, '3 rótulos premium em ' + st);
  assert.deepStrictEqual(labs.map(x => x.b.tier), ['medio', 'alto', 'icone'], 'faixas médio-alto/alto/ícone em ' + st);
  for (const { id, b } of labs) { assert(b.premium && !b.retired, 'só premium ativo: ' + id); assert(!RETIRED.includes(id)); assert(b.price[0] >= 200, 'sem vinho de entrada: ' + id); } }
for (const [id, b] of Object.entries(L.BEVERAGES)) if (b.kind === 'wine' && !b.retired) { assert(b.premium, 'vinho ativo é premium: ' + id); assert.notEqual(b.tier, 'entrada', 'faixa de entrada na adega: ' + id); }
assert.deepStrictEqual(Object.keys(L.WINE_TIER_LABEL), ['medio', 'alto', 'icone'], 'adega sem faixa baixa');
for (const st of wineStyles) assert(L.WINE_SERVICE[st] && /°C/.test(L.WINE_SERVICE[st].temp) && L.WINE_SERVICE[st].decant, 'serviço do Enólogo: ' + st);
// Marqués de Riscal (pedido nominal do Jefferson)
const rr = L.BEVERAGES.w_riscal_reserva, rg = L.BEVERAGES.w_riscal_gran_reserva;
assert(rr && rg && rr.style === 'st_rioja' && rg.style === 'st_rioja'); assert.equal(L.bestRating(rr).points, 92); assert.equal(L.bestRating(rg).points, 94);
assert(/^https:\/\/www\.decanter\.com\/wine-reviews\//.test(L.bestRating(rr).url) && /^https:\/\/www\.decanter\.com\/wine-reviews\//.test(L.bestRating(rg).url));
assert(/beber de 2023 a 2030/.test(L.windowTxt(rr)), 'janela de consumo do crítico');
// Sem nota quando não há fonte independente aberta
for (const id of ['w_ott_selle', 'w_lote43']) assert.equal(L.bestRating(L.BEVERAGES[id]), null, id + ' = Sem nota');
// 6) Preço com moeda e mês da consulta por rótulo
for (const [id, b] of Object.entries(L.BEVERAGES)) { assert.equal(b.currency, 'BRL', 'moeda: ' + id); assert(/^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{4}$/.test(b.priceMonth), 'mês da consulta: ' + id); }
assert(/^R\$ 270–380 · faixa vista em lojas, nov\/2026$/.test(L.priceTxt(rr)), L.priceTxt(rr));
// 7) IDs únicos entre objetos e sem chave repetida no código-fonte (chave repetida num objeto JS some em silêncio)
{ const all = [...Object.keys(L.BEVERAGES), ...Object.keys(L.DRINKS), ...Object.keys(L.BEV_STYLES)]; const dup = all.filter((x, i) => all.indexOf(x) !== i); assert.deepStrictEqual(dup, [], 'ID repetido entre bebidas/drinks/estilos: ' + dup);
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  for (const name of ['BEVERAGES', 'DRINKS', 'BEV_STYLES', 'WINES']) { const i = html.indexOf(`\nconst ${name} = {`), body = html.slice(i, html.indexOf('\n};', i)); const keys = [...body.matchAll(/\n  ([a-z][a-z0-9_]*): \{/g)].map(m => m[1]);
    const d = keys.filter((x, j) => keys.indexOf(x) !== j); assert(keys.length > 5, 'leu ' + name); assert.deepStrictEqual(d, [], `chave repetida em ${name}: ${d}`); } }
// 8) Mudou o catálogo? Suba CATALOG_VERSION e congele de novo
{ const { fingerprint } = require('./catalog-freeze.js')();
  assert.equal(frozen.catalogVersion, L.CATALOG_VERSION, 'CATALOG_VERSION diferente do congelado: rode node tests/catalog-freeze.js');
  assert.equal(frozen.fingerprint, fingerprint, 'catálogo mudou: suba CATALOG_VERSION e rode node tests/catalog-freeze.js'); }
// 9) 18+ na Adega do WhatsApp e na lista de compras com álcool
assert(L.adegaText('alto', [{ id: 'w_riscal_gran_reserva', bottles: 2 }]).endsWith(L.AGE_LINE)); assert(/18 anos/.test(L.AGE_LINE));
// (lista de compras com álcool: coberta em allergy.test.js, seção 6)
// 10) Caminho para os rótulos do Jefferson: prefixo wj_, origem "jefferson", Sem nota por padrão
assert.deepStrictEqual(Object.keys(L.JEFFERSON_WINES), [], 'lista do Jefferson começa vazia');
{ const ok = { wj_teste: { name: 'Rótulo de teste', country: 'Espanha', style: 'st_rioja', tier: 'alto', price: [500, 700], priceMonth: 'dez/2026', abv: { value: 14 } } };
  assert.deepStrictEqual(L.jeffersonWineErrors(ok), []);
  assert(L.jeffersonWineErrors({ teste: ok.wj_teste }).length, 'sem prefixo wj_ recusa');
  assert(L.jeffersonWineErrors({ wj_x: { ...ok.wj_teste, style: 'st_nada' } }).length, 'estilo inexistente recusa');
  assert(L.jeffersonWineErrors({ wj_x: { ...ok.wj_teste, tier: 'entrada' } }).length, 'faixa de entrada recusa');
  assert(L.jeffersonWineErrors({ wj_x: { ...ok.wj_teste, abv: undefined } }).length, 'sem ABV recusa');
  assert(L.jeffersonWineErrors({ wj_x: { ...ok.wj_teste, ratings: [{ points: 99, critic: 'Loja X', url: 'https://x' }] } }).length, 'nota sem fonte recusa');
  const L2 = require('./load-logic')(['BEVERAGES', 'addJeffersonWines', 'bestRating', 'styleLabels']); L2.addJeffersonWines(ok); const b = L2.BEVERAGES.wj_teste;
  assert(b && b.origin === 'jefferson' && b.premium && !b.retired && b.currency === 'BRL'); assert.equal(L2.bestRating(b), null, 'Sem nota por padrão'); }
// 11) Enólogo fala de serviço (temperatura, decantação) no churrasco
assert(L.mesaTalk({}, '2026-12-20|jantar', ['c_churrasco'], null).some(l => l.who === 'enologo' && /°C/.test(l.text)), 'Enólogo com temperatura de serviço');
// 12) Linha de serviço nunca cita outro rótulo do catálogo (ex.: a do Soalheiro citava «Silex e Te Koko»)
{ const GENERIC = new Set(('reserva gran grand cru premier vieilles vignes brut nature vintage cuvée special blanc rouge rosé rose sauvignon chardonnay malbec tannat cabernet merlot syrah alvarinho moscatel moscato '
    + 'sangiovese chianti classico brunello montalcino rioja chablis sauternes tokaji champagne espumante château chateau domaine domaines bodega casa vineyard vinhas vinho selezione riserva parcela única unica '
    + 'historic rows argentino mendoza blue label aszú aszu puttonyos tradition seleção selecao reservado reserve appellation corte terroir').split(' '));
  const words = t => (t.toLowerCase().normalize('NFC').match(/[\p{L}]{4,}/gu) || []);
  const all = Object.entries(L.BEVERAGES).filter(([, b]) => b.kind === 'wine');
  const offenders = (text, ownId, style) => { const tw = new Set(words(text)), own = new Set([...(ownId ? words(L.BEVERAGES[ownId].name) : []), ...words((L.BEV_STYLES[style] || {}).name || '')]);
    const out = []; for (const [oid, o] of all) { if (oid === ownId) continue; for (const w of words(o.name)) if (!GENERIC.has(w) && !own.has(w) && tw.has(w)) out.push(`${w} (${o.name})`); } return [...new Set(out)]; };
  for (const [st, sv] of Object.entries(L.WINE_SERVICE)) assert.deepStrictEqual(offenders(`${sv.temp} ${sv.decant} ${sv.guard || ''}`, null, st), [], 'serviço do estilo cita rótulo: ' + st);
  for (const [id, b] of all) assert.deepStrictEqual(offenders(L.serviceTxt(b), id, b.style), [], 'serviço de ' + id + ' cita outro rótulo');
  // o próprio teste pega o erro antigo
  assert(offenders('10–12 °C · Silex e Te Koko ganham com 20 min de decanter', 'soalheiro', 'st_branco_fresco').length >= 2, 'detector pega Silex/Te Koko');
  assert(offenders('Garrus pode ir ao decanter por 20 min', null, 'st_rose').length && offenders('Brunello e Tignanello jovens', null, 'st_sangiovese').length);
  const so = L.serviceTxt(L.BEVERAGES.soalheiro); assert(/10–12 °C/.test(so) && /Monção e Melgaço/.test(so) && !/Silex|Koko/.test(so), 'serviço próprio do Soalheiro'); }
// 13) Textos da mesa: sem parênteses dentro de parênteses; as falas do Enólogo e do Drinks seguem o prato
{ const nested = t => { let d = 0; for (const ch of t) { if (ch === '(') { d++; if (d > 1) return true; } else if (ch === ')') d = Math.max(0, d - 1); } return false; };
  for (const id of Object.keys(L.CHEF)) for (const meal of ['almoco', 'jantar']) for (const ln of L.mesaTalk({}, '2026-12-20|' + meal, [id], null)) { assert(!nested(ln.text), `parêntese aninhado (${id}): ${ln.text}`); assert(!/\)\s*\(/.test(ln.text), `parênteses colados (${id}): ${ln.text}`); }
  // Vocabulário de prato/ingrediente: a fala do Enólogo e a do Drinks só podem citar o que está na refeição (título + ingredientes).
  const ITEMS = L.ITEMS || {}, dishText = id => { const c = L.CHEF[id]; return [c.title, ...(c.ing || []).map(i => { const k = Array.isArray(i) ? i[0] : i; return k + ' ' + ((ITEMS[k] && ITEMS[k].name) || ''); })].join(' ').toLowerCase(); };
  const VOCAB = [ // [termo na fala, o que precisa existir na refeição]
    [/peix/i, /peixe|salm|bacalhau|ceviche/], [/frutos do mar|camar|lula|polvo|mexilh/i, /camar|lula|polvo|mexilh|frutos do mar/], [/cozinha do mar/i, /peixe|salm|bacalhau|ceviche|camar|lula|polvo|mexilh/],
    [/churrasco|brasa|picanha/i, /churrasco|brasa|picanha/], [/\bcarnes?\b|\bum corte e outro\b/i, /picanha|carne|bolonhesa|lombo|presunto|parma|frango|churrasco/], [/carnes brancas/i, /frango|lombo|porco|presunto|parma/],
    [/frango|\bave\b/i, /frango/], [/porco|lombo/i, /lombo|porco/], [/cordeiro/i, /cordeiro/], [/fritura|frit/i, /dorê|frit|empanad/], [/risoto/i, /risoto|arborio/],
    [/manteiga/i, /manteiga/], [/tomate/i, /tomate|molho|sugo|bolonhesa/], [/molho/i, /molho|sugo|bolonhesa|moqueca|calda/], [/queijo|gratinad/i, /queijo|coalho|búfala|mussarela|parmes/],
    [/lim[aã]o/i, /lim[aã]o/], [/\bervas\b/i, /ervas|manjeric|cheiro|salsa|coentro|or[eé]gano/], [/salada/i, /salada|rúcula|folhas/], [/entrada/i, null], [/massa\b|macarr/i, /macarr|massa|espaguete|lasanha/],
    [/sobremesa|doçura|\bo doce\b/i, 'des'], [/fruta(s)? (vermelha|tropical)|sobremesas? de fruta/i, /maracuj|abacaxi|frutas|manga|mel[aã]o/]];
  const offTerms = (text, ids) => { const all = ids.map(dishText).join(' '), hasDes = ids.some(i => L.CHEF[i].course === 'sobremesa');
    return VOCAB.filter(([term, need]) => term.test(text) && !(need === 'des' ? hasDes : need && need.test(all))).map(([t]) => String(t)); };
  const desserts = Object.keys(L.CHEF).filter(i => L.CHEF[i].course === 'sobremesa'), mains = Object.keys(L.CHEF).filter(i => L.CHEF[i].course !== 'sobremesa');
  const meals = [...Object.keys(L.CHEF).map(i => [i]), ...mains.flatMap(m => desserts.map(d => [m, d]))];
  let checked = 0;
  for (const ids of meals) for (const ln of L.mesaTalk({}, '2026-12-20|jantar', ids, null)) { if (!['enologo', 'bar'].includes(ln.who)) continue;
    const off = offTerms(ln.text, ids); assert(!off.length, `fala do ${ln.who} cita ${off.join(', ')} fora da refeição ${ids.join('+')}: ${ln.text}`); checked++; }
  assert(checked > 100, 'varreu as falas: ' + checked);
  // camada 1 da mesa (cartões de estilo): o motivo de cada estilo segue o prato principal
  for (const id of mains) { const pk = L.pairKey(L.CHEF[id]); for (const st of [...L.PAIRINGS.wine[pk], ...L.PAIRINGS.beer[pk]]) { const w = L.styleWhy(st, pk, id), off = offTerms(w, [id]);
    assert(!off.length, `${st} em ${id}: ${w} (${off})`); } }
  for (const d of desserts) for (const st of [...L.PAIRINGS.wine.doce, ...L.PAIRINGS.beer.doce]) { const w = L.styleWhy(st, 'doce', d); assert(!offTerms(w, [d]).length, `${st} em ${d}: ${w}`); }
  // casos pedidos: com frango/porco o Chardonnay não fala de peixe e o rosé não fala de peixe; na sobremesa o espumante não fala de fritura e sal
  const eno = ids => L.mesaTalk({}, '2026-12-20|jantar', ids, null).find(l => l.who === 'enologo').text;
  for (const id of ['c_frango_limao', 'c_parma_melao']) { for (const st of ['st_chard_madeira', 'st_rose']) assert(!/peix/i.test(L.styleWhy(st, 'ave_porco', id)), st + ' com ' + id); assert(!/peix/i.test(eno([id])), eno([id])); }
  assert(/carnes brancas/.test(L.styleWhy('st_chard_madeira', 'ave_porco', 'c_frango_limao')));
  for (const d of desserts) { const w = L.styleWhy('st_espumante', 'doce', d); assert(!/fritura|sal\b/.test(w) && /sobremesa/.test(w), w); }
  const sugo = L.mesaTalk({}, '2026-12-20|jantar', ['c_sugo'], null).find(l => l.who === 'bar').text;
  assert(sugo.startsWith('Na cerveja, lager escura (schwarzbier, dunkel): malte tostado acompanha o tomate e a massa.'), sugo);
  assert.equal(L.styleWhy('st_dark_lager', 'churrasco', 'c_churrasco'), 'malte tostado combina com a crosta da picanha na brasa');
  assert(!/picanha|brasa|churrasco/.test(L.styleWhy('st_dark_lager', 'churrasco', 'c_lasanha')), 'lasanha não é churrasco'); }
// 14) Folha do vinho: «Com:» mostra até 3 pratos e «+N»
{ const six = ['A', 'B', 'C', 'D', 'E', 'F']; assert.deepStrictEqual(L.dishesShort(six), { text: 'A, B, C', rest: 3, all: 'A, B, C, D, E e F.' });
  assert.deepStrictEqual(L.dishesShort(['A', 'B', 'C']), { text: 'A, B e C.', rest: 0, all: 'A, B e C.' }); assert.equal(L.dishesShort(['A']).text, 'A.'); }
console.log(`CATALOG TESTS PASSED (${Object.keys(L.BEVERAGES).length} rótulos, ${Object.keys(L.DRINKS).length} drinks, versão ${L.CATALOG_VERSION}: adega premium 12 estilos × 3, serviço sem nome de outro rótulo, falas do Enólogo e do Drinks seguem o prato, sem parêntese aninhado, «Com:» até 3, 23 aposentados, Riscal, BRL + mês, IDs únicos, versão travada, caminho wj_, IDs fixos, notas com fonte/link/data, ABV, faixas, pareamentos)`);
