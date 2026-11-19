// Adega que vem de casa: custo zero (fora do rateio), sai da lista de compras, foto nunca no sync, agenda pelo prato,
// prioridade sobre o vinho comprado, especiais nas noites de destaque, troca e recusa do adulto. Dados fictícios.
const assert = require('assert');
const L = require('./load-logic')(['matchCellarLabel', 'cellarInfo', 'cellarPlan', 'cellarSlots', 'cellarToday', 'cellarHomeRows', 'adegaText', 'SULFITE_LINE', 'AGE_LINE',
  'bevNeeds', 'portions', 'shoppingList', 'shoppingText', 'computeSplit', 'summaryText', 'settle', 'kitty', 'stateToRows', 'rowsToState', 'safeExportState', 'wineList', 'BEVERAGES']);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const base = () => ({ splitMode: 'porcoes', weights: {}, prices: {}, planQty: {}, recipes: [], expenses: [{ id: 'e1', amount: 300, category: 'food', payerId: 'a1', description: 'Mercado' }], settled: {}, alcoholOk: true,
  trip: { start: '2026-12-20', end: '2026-12-26', meals: { cafe: true, almoco: true, lanche: false, jantar: true } },
  families: [{ id: 'fa', name: 'Família A', members: [{ id: 'a1', name: 'Ana', drinks: true }, { id: 'a2', name: 'Caio', drinks: true }] },
    { id: 'fb', name: 'Família B', members: [{ id: 'b1', name: 'Beto', drinks: true }, { id: 'b2', name: 'Lia', type: 'crianca' }] }],
  plan: { '2026-12-20': { jantar: { mode: 'casa', recipes: ['c_peixe_brasa'] } }, '2026-12-21': { jantar: { mode: 'casa', recipes: ['c_sugo'] } },
    '2026-12-22': { jantar: { mode: 'casa', recipes: ['c_churrasco'] } }, '2026-12-23': { almoco: { mode: 'casa', recipes: ['c_frango_limao'] } },
    '2026-12-24': { jantar: { mode: 'casa', recipes: ['c_bacalhau'] } } } });
const malbec = { id: 'hc_m1', name: 'Malbec da casa', vintage: 2021, style: 'st_malbec', famId: 'fb', bottles: 1, photo: 'data:image/jpeg;base64,AAAA' };
const riscal = { id: 'hc_r1', name: 'Riscal Reserva', vintage: 2019, style: '', famId: 'fa', bottles: 2, note: 'presente de aniversário' };
const velho = { id: 'hc_v1', name: 'Branco antigo da adega', vintage: 2012, style: 'st_chard_madeira', famId: 'fb', bottles: 1 };
const comum = { id: 'hc_c1', name: 'Chardonnay do dia a dia', vintage: 2023, style: 'st_chard_madeira', famId: 'fa', bottles: 1 };

// 1) Reaproveita a ficha do catálogo
assert.equal(L.matchCellarLabel('Riscal Reserva'), 'w_riscal_reserva'); assert.equal(L.matchCellarLabel('Marqués de Riscal Gran Reserva 2019'), 'w_riscal_gran_reserva');
assert.equal(L.matchCellarLabel('marques de riscal baron de chirel'), 'w_baron_chirel'); assert.equal(L.matchCellarLabel('Vinho do tio'), null); assert.equal(L.matchCellarLabel('Re'), null);
{ const st = base(); const x = L.cellarInfo(st, riscal); assert.equal(x.matchId, 'w_riscal_reserva'); assert.equal(x.style, 'st_rioja', 'estilo vem da ficha');
  assert.equal(x.rating.points, 92); assert(/16–18 °C/.test(x.service)); assert.equal(x.famName, 'Família A'); }

// 2) Agenda pelo prato: Malbec no churrasco, Riscal (Rioja) no sugo/frango, branco no peixe; especial (safra 10+ anos) na noite de destaque
{ const st = base(); st.cellar = [malbec, riscal, velho, comum]; const cp = L.cellarPlan(st);
  assert.equal(cp.slots['2026-12-22|jantar'].id, 'hc_m1', 'Malbec vai para o churrasco');
  const rioja = Object.entries(cp.slots).filter(([, a]) => a.id === 'hc_r1').map(([k]) => k); assert(rioja.length >= 1 && rioja.every(k => ['2026-12-21|jantar', '2026-12-23|almoco'].includes(k)), 'Rioja com massa ou ave: ' + rioja);
  assert.equal(cp.slots['2026-12-24|jantar'].id, 'hc_v1', 'safra antiga vai para a ceia de 24/12');
  assert.equal(cp.slots['2026-12-20|jantar'].id, 'hc_c1', 'garrafa comum no peixe de dia comum');
  assert(cp.items.hc_v1.special && !cp.items.hc_c1.special);
  for (const [k, a] of Object.entries(cp.slots)) { const s = L.cellarSlots(st).find(x => x.key === k); assert(s.styles.includes(cp.items[a.id].style), 'estilo combina com o prato: ' + k); } }

// 3) Troca e recusa pelo adulto
{ const st = base(); st.cellar = [velho, comum]; st.cellarNo = ['2026-12-24|jantar|hc_v1']; let cp = L.cellarPlan(st);
  assert.notEqual(cp.slots['2026-12-24|jantar'] && cp.slots['2026-12-24|jantar'].id, 'hc_v1', 'recusada naquela refeição');
  assert(Object.values(cp.slots).some(a => a.id === 'hc_v1'), 'a garrafa recusada vai para outra refeição');
  st.cellarSet = { '2026-12-20|jantar': '' }; cp = L.cellarPlan(st); assert(!cp.slots['2026-12-20|jantar'], 'sem garrafa de casa nesta refeição');
  st.cellarSet = { '2026-12-21|jantar': 'hc_c1' }; cp = L.cellarPlan(st); assert.equal(cp.slots['2026-12-21|jantar'].id, 'hc_c1'); assert(cp.slots['2026-12-21|jantar'].manual, 'troca manual vale'); }

// 4) Custo zero: rateio idêntico, nenhuma linha de compra da garrafa, nada de «trazida por» no resumo do rateio
{ const a = base(), b = base(); b.cellar = [malbec, riscal]; b.cellarSet = {};
  const sa = L.computeSplit(a), sb = L.computeSplit(b);
  for (const f of sa.families) assert(near(f.net, sb.families.find(x => x.id === f.id).net), 'rateio igual com garrafa de casa');
  assert.deepStrictEqual(sa.persons.map(p => p.owed), sb.persons.map(p => p.owed));
  const sum = L.summaryText(b, sb, L.settle(sb.families), L.kitty(b, sb)); assert(!/trazida|adega de|Malbec da casa|Riscal/.test(sum), 'garrafa de casa fora do texto do rateio');
  const shop = L.shoppingList(b); assert(!shop.rows.some(r => /hc_/.test(r.key)), 'garrafa de casa não vira compra'); assert(!/Malbec da casa|Riscal Reserva/.test(L.shoppingText(b, shop))); }

// 5) Prioridade sobre o vinho comprado: a garrafa de casa da refeição desconta o vinho aceito da lista
{ const st = base(); st.plan['2026-12-22'].jantar.bev = [{ id: 'catena_zapata', okBy: 'Ana' }]; const P = L.portions(st);
  const before = L.bevNeeds(st, P).filter(([k]) => k === 'bv_catena_zapata').reduce((s, [, q]) => s + q, 0); assert(before > 0, 'sem garrafa de casa: compra');
  st.cellar = [malbec]; const after = L.bevNeeds(st, L.portions(st)).filter(([k]) => k === 'bv_catena_zapata').reduce((s, [, q]) => s + q, 0);
  assert(near(after, Math.max(0, before - 1)), `compra cai uma garrafa: ${before} → ${after}`);
  st.cellar = [{ ...malbec, bottles: 3 }]; const none = L.bevNeeds(st, L.portions(st)).filter(([k]) => k === 'bv_catena_zapata'); assert.equal(none.length, 0, 'garrafas de casa cobrem a refeição: nada a comprar');
  const plan = { '2026-12-22|jantar': { ids: ['c_churrasco'] } }; st.cellar = []; const wb = L.wineList(st, plan, 'alto').reduce((s, x) => s + x.bottles, 0); st.cellar = [{ ...malbec, bottles: 3 }];
  assert(L.wineList(st, plan, 'alto').reduce((s, x) => s + x.bottles, 0) < wb, 'estimativa da Adega também desconta'); }

// 6) Foto e lista da adega nunca vão ao servidor; sobrevivem ao receber dados do servidor; exportação sem a foto
{ const st = { ...base(), syncMode: true, cellar: [malbec, riscal], cellarSet: { '2026-12-21|jantar': 'hc_r1' }, cellarNo: ['x|y'] };
  const dump = JSON.stringify(L.stateToRows(st, 'ev1')); for (const bad of ['hc_m1', 'hc_r1', 'Malbec da casa', 'data:image', 'cellar', 'presente de aniversário']) assert(!dump.includes(bad), 'vazou para o servidor: ' + bad);
  const back = L.rowsToState(L.stateToRows(st, 'ev1'), st); assert.deepStrictEqual(back.cellar, st.cellar, 'adega local fica'); assert.deepStrictEqual(back.cellarSet, st.cellarSet);
  const ex = JSON.stringify(L.safeExportState(st)); assert(!ex.includes('data:image'), 'exportação sem foto do rótulo'); }

// 7) Hoje à mesa e WhatsApp
{ const st = base(); st.cellar = [riscal, velho]; const cp = L.cellarPlan(st); const k = Object.keys(cp.slots).find(k => cp.slots[k].id === 'hc_r1'), t = L.cellarToday(st, k, cp);
  assert.equal(t.title, 'Família A traz: Riscal Reserva 2019'); assert(/^Abrir para respirar às \d+h\d{0,2} · /.test(t.prep) && / · servir a 16–18 °C/.test(t.prep) && /Reserva, 30 min/.test(t.prep) && !/\n/.test(t.prep), t.prep);
  assert(/taças de 150 ml, ~[\d,]+ por adulto que bebe/.test(t.yield), t.yield);
  const tb = L.cellarToday(st, '2026-12-24|jantar', cp); assert(/^Gelar às 18h · servir a /.test(tb.prep) && !/\n/.test(tb.prep), tb.prep);
  assert.equal(L.cellarToday(st, '2026-12-26|jantar', cp), null);
  const txt = L.adegaText('alto', [], L.cellarHomeRows(st, cp)); assert(/Riscal Reserva 2019 — 2 garrafas · trazida por Família A/.test(txt), txt); assert(/custo zero, fora do rateio/.test(txt));
  assert(txt.includes(L.SULFITE_LINE) && txt.endsWith(L.AGE_LINE), 'sulfito e 18+ no WhatsApp'); }
console.log('CELLAR TESTS PASSED (ficha do catálogo reaproveitada, agenda pelo prato, especiais nas noites de destaque, troca/recusa, custo zero no rateio, fora da lista, prioridade sobre o comprado, foto e lista fora do sync, Hoje à mesa, WhatsApp com trazida por + sulfito + 18+)');
