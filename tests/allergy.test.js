// Alergia e intolerância: bloqueio duro em todo lugar (inclusive Natal e réveillon), adaptação na lista, nada vaza em texto compartilhado.
const assert = require('assert');
const L = require('./load-logic')(['ALLERGENS', 'ITEM_ALLERGENS', 'CHEF', 'SPECIAL', 'chefPlan', 'chefRecipe', 'recipeAllergens', 'allergyHits', 'enforceAllergies', 'shoppingList', 'shoppingText',
  'summaryText', 'computeSplit', 'settle', 'kitty', 'healthOf', 'cellBlocked', 'getRecipe', 'mesaTalk', 'BEVERAGES', 'isDrinker', 'portions', 'bevNeeds', 'tripDays', 'presentMembers']);
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

// 1) Lista fechada = Anexo III da RDC 727/2022 (+ moluscos marcados como extra)
const ANVISA = ['crustaceos', 'peixes', 'leite', 'ovo', 'amendoim', 'castanhas', 'soja', 'trigo'];
for (const a of ANVISA) assert(L.ALLERGENS[a] && !L.ALLERGENS[a].extra, 'falta alergênico Anvisa ' + a);
assert(L.ALLERGENS.moluscos && L.ALLERGENS.moluscos.extra, 'moluscos como extra');
// 2) Toda receita do Chef tem alergênicos por ingrediente; camarão marcado como crustáceo
for (const id of Object.keys(L.CHEF)) { const ra = L.recipeAllergens({}, L.chefRecipe(id)); assert(Array.isArray(ra.by) && ra.by.length === L.CHEF[id].ing.length, 'alergênicos por ingrediente: ' + id); }
assert(L.recipeAllergens({}, L.chefRecipe('c_camarao_alho')).ids.includes('crustaceos'));
assert(L.recipeAllergens({}, L.chefRecipe('c_moqueca')).ids.includes('crustaceos') && !L.recipeAllergens({}, L.chefRecipe('c_moqueca')).ids.includes('leite'), 'leite de coco não é leite');
assert(L.recipeAllergens({}, L.chefRecipe('c_salada_tropical')).ids.includes('castanhas'));
assert(L.recipeAllergens({}, L.chefRecipe('c_lula')).ids.includes('ovo') && L.recipeAllergens({}, L.chefRecipe('c_lula')).ids.includes('moluscos'));

// 3) Cenário da Astreia: criança alérgica a camarão + família que vetou frutos do mar => nenhum prato com camarão, nem no Natal/réveillon
const base = () => ({ splitMode: 'porcoes', weights: {}, prices: {}, planQty: {}, recipes: [], plan: {}, expenses: [], settled: {},
  trip: { start: '2026-12-15', end: '2026-12-31', meals: { cafe: true, almoco: true, lanche: true, jantar: true } },
  families: [
    { id: 'fa', name: 'Família A', members: [{ id: 'a1', name: 'Ana', drinks: true }, { id: 'a2', name: 'Lia', type: 'crianca', diet: { allergens: ['crustaceos'], consent: { by: 'Ana', at: '2026-11-19' } } }] },
    { id: 'fb', name: 'Família B', members: [{ id: 'b1', name: 'Beto', drinks: true }, { id: 'b2', name: 'Bia' }] },
    { id: 'fc', name: 'Família C', members: [{ id: 'c1', name: 'Caio', drinks: false }, { id: 'c2', name: 'Duda', type: 'adolescente', drinks: true }] }] });
const brief = { fb: { done: true, nivel: 3, entradas: 'questao', prot: ['camarao', 'boi'], mar: 'adoram', estilos: ['mar'], fav: 'camarão, risoto de camarão', tipos: [], vinho: 'ambos', criancas: 'tudo', nao: [], naoTxt: '' },
  fc: { done: true, nivel: 2, entradas: 'gostam', prot: ['boi'], mar: 'evitar', estilos: ['churrasco'], fav: '', tipos: [], vinho: 'medio', criancas: 'tudo', nao: ['mar'], naoTxt: '' } };
const hasCrust = id => L.recipeAllergens({}, L.chefRecipe(id)).ids.includes('crustaceos');
for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
  const st = base(), r = L.chefPlan(st, brief, seed);
  for (const [k, s] of Object.entries(r.sugg)) for (const id of s.ids) {
    assert(!hasCrust(id), `seed ${seed} ${k}: ${id} tem camarão`);
    assert(!['camarao', 'frutos_mar'].some(p => L.CHEF[id].prot.includes(p)), `seed ${seed} ${k}: ${id} é fruto do mar vetado`);
  }
  assert(r.sugg['2026-12-31|jantar'] && /Réveillon/.test(r.sugg['2026-12-31|jantar'].label) && r.sugg['2026-12-31|jantar'].swapped, 'réveillon trocado');
  assert(r.sugg['2026-12-31|jantar'].ids.length >= 2, 'réveillon continua com etapas');
}
// 3b) Mesmo sem veto: só a alergia já bloqueia camarão em todo lugar
{ const st = base(), r = L.chefPlan(st, { fb: brief.fb }, 0); for (const s of Object.values(r.sugg)) for (const id of s.ids) assert(!hasCrust(id), 'sem veto: ' + id); }
// 3c) Quem chega depois: a alergia só bloqueia nas refeições em que a pessoa está presente
{ const st = base(); st.families[0].arrive = '2026-12-30'; st.families[0].arriveMeal = 'cafe'; const r = L.chefPlan(st, { fb: brief.fb }, 0);
  for (const [k, s] of Object.entries(r.sugg)) if (k >= '2026-12-30') for (const id of s.ids) assert(!hasCrust(id), 'presente: ' + k + ' ' + id); }

// 4) Plano aceito antes da alergia: enforceAllergies troca (inclusive réveillon), e a lista de compras não compra camarão
{ const st = base(); st.families[0].members[1].diet = {}; const r = L.chefPlan(st, { fb: brief.fb }, 0);
  for (const [k, s] of Object.entries(r.sugg)) { const [d, m] = k.split('|'); (st.plan[d] = st.plan[d] || {})[m] = { mode: 'casa', recipes: s.ids.slice() }; }
  assert(Object.values(st.plan).some(d => Object.values(d).some(c => c.recipes.some(hasCrust))), 'cenário precisa ter camarão antes');
  st.families[0].members[1].diet = { allergens: ['crustaceos'] };
  const blockedBefore = L.shoppingList(st); assert(!blockedBefore.rows.some(x => x.key === 'camarao'), 'lista não compra o que está bloqueado'); assert(blockedBefore.blocked.length > 0);
  const ch = L.enforceAllergies(st, { fb: brief.fb }); assert(ch.length > 0);
  for (const d of Object.values(st.plan)) for (const c of Object.values(d)) assert(!c.recipes.some(hasCrust), 'aceito ainda com camarão');
  const days = L.tripDays(st.trip); for (const d of days) for (const m of ['almoco', 'jantar']) assert.equal(L.cellBlocked(st, d, m).length, 0, 'nada bloqueado sobra, nem modelo padrão');
}

// 4b) R1 (Arquitas): modelo padrão ("Massa", "Café") com alergênico de quem está presente é trocado ou bloqueado, não só some o item da lista
{ const st = base(); st.families[0].members[1].diet = { allergens: ['trigo', 'leite'] };
  st.plan['2026-12-20'] = { cafe: { mode: 'casa', recipes: ['cafe'] }, jantar: { mode: 'casa', recipes: ['massa'] } };
  const hits = id => L.allergyHits(st, L.getRecipe(st, id), L.presentMembers ? L.presentMembers(st, '2026-12-20', 'jantar') : null);
  const pre = L.shoppingList(st); assert(pre.blocked.some(b => b.recipe === 'massa'), 'lista bloqueia o modelo Massa inteiro');
  assert(!pre.rows.some(r => ['macarrao', 'queijo', 'leite', 'pao', 'manteiga'].includes(r.key) && r.toBuy > 0), 'nada do modelo bloqueado entra na lista');
  const ch = L.enforceAllergies(st, {}); assert(ch.some(c => c.builtin && c.from), 'troca registrada para modelo padrão');
  const j = st.plan['2026-12-20'].jantar.recipes, c = st.plan['2026-12-20'].cafe.recipes;
  assert(!j.includes('massa'), 'Massa saiu do jantar'); for (const id of j.concat(c)) assert.equal(hits(id).length, 0, 'modelo seguro: ' + id);
  assert.equal(L.cellBlocked(st, '2026-12-20', 'jantar').length + L.cellBlocked(st, '2026-12-20', 'cafe').length, 0); }
// 4c) Sem alergia de ninguém, o modelo padrão fica como está
{ const st = base(); st.families[0].members[1].diet = {}; st.plan['2026-12-20'] = { jantar: { mode: 'casa', recipes: ['massa'] } };
  L.enforceAllergies(st, {}); assert.deepStrictEqual(st.plan['2026-12-20'].jantar.recipes, ['massa']); }
// 5) Intolerância não bloqueia: adapta, na proporção de quem precisa
{ const st = base(); st.families = [{ id: 'fa', name: 'A', members: [{ id: 'a1', name: 'Ad' }, { id: 'a2', name: 'Ad2', diet: { intol: ['lactose'] } }] }];
  st.trip = { start: '2026-12-20', end: '2026-12-20', meals: { jantar: true } }; st.plan = { '2026-12-20': { jantar: { mode: 'casa', recipes: ['c_panna_cotta'] } } };
  const S = L.shoppingList(st), row = k => S.rows.find(x => x.key === k);
  assert(row('creme_leite_sl') && row('creme_leite'), 'versão adaptada e normal'); assert(near(row('creme_leite_sl').need, row('creme_leite').need), 'metade/metade');
  assert(near(row('creme_leite_sl').need + row('creme_leite').need, 100 * 2));
  assert(!/lactose|glúten|gluten|alerg/i.test(L.shoppingText(st, S)), 'WhatsApp sem a restrição');
  assert(L.cellBlocked(st, '2026-12-20', 'jantar').length === 0, 'intolerância não bloqueia'); }
// 6) Álcool: menor de 18 nunca bebe nem conta garrafa
{ const st = base(); assert(!L.isDrinker(st.families[2].members[1]), 'adolescente não bebe mesmo com drinks=true');
  const P = L.portions(st); assert.equal(P.per.c2.drinkerDays, 0); assert(!L.shoppingText(st, L.shoppingList(st)).includes('18 anos'));
  const sp = L.computeSplit({ ...st, expenses: [{ id: 'x', amount: 100, category: 'alcohol', payerId: 'a1' }] }); assert(near(sp.persons.find(p => p.id === 'c2').owed, 0), 'adolescente não paga álcool');
  st.plan = { '2026-12-15': { jantar: { mode: 'casa', recipes: ['c_churrasco'], bev: [{ id: 'catena_app' }, { id: 'z_suco_uva' }] } } };
  let need = L.bevNeeds(st, P); assert(!need.some(([k]) => k === 'bv_catena_app'), 'álcool sem aceite de adulto organizador não entra');
  assert(need.some(([k]) => k === 'bv_z_suco_uva'), 'sem álcool entra sem aceite');
  st.plan['2026-12-15'].jantar.bev[0].okBy = 'Ana'; need = L.bevNeeds(st, L.portions(st));
  const w = need.find(([k]) => k === 'bv_catena_app'); assert(w && near(w[1], 2 * 2 / 5), 'garrafas só dos adultos que bebem (Ana e Beto)');
  assert(L.shoppingText(st, L.shoppingList(st)).includes('Bebida alcoólica só para maiores de 18 anos.'), 'lista com álcool leva a frase dos 18 anos');
  st.plan['2026-12-15'].jantar.bev = [{ id: 'z_suco_uva' }]; assert(!L.shoppingText(st, L.shoppingList(st)).includes('18 anos'), 'sem álcool, sem a frase'); }
// 7) Texto compartilhado nunca leva dado de saúde
{ const st = base(); const sp = L.computeSplit(st), tr = L.settle(sp.families); const out = L.summaryText(st, sp, tr, L.kitty(st, sp)) + L.shoppingText(st, L.shoppingList(st));
  for (const bad of ['crustaceos', 'Crustáceos', 'alergia', 'Alergia', 'Lia:']) assert(!out.includes(bad), 'vazou ' + bad); }
// 8) Conversa da mesa: sem criança, saúde, gestação, nem quem bebe
{ const bad = /crian|gestant|grávid|gravidez|saúde|saude|não bebe|nao bebe|quem bebe|menor|alerg|remédio|dieta/i;
  for (const id of Object.keys(L.CHEF)) for (const meal of ['almoco', 'jantar']) for (const ln of L.mesaTalk({}, '2026-12-20|' + meal, [id], null)) assert(!bad.test(ln.text), id + ': ' + ln.text); }
console.log('ALLERGY TESTS PASSED (modelos padrão Massa/Café trocados ou bloqueados, lista Anvisa, por ingrediente, cenário Astreia em 8 seeds + Natal/réveillon, presença, plano aceito, lista, intolerância, 18+, textos, mesa)');
