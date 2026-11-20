const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const src = html.split('// ===== LOGIC-START')[1].split('// ===== LOGIC-END')[0];
const L = new Function(src.replace(/^[^\n]*\n/, '') + '\nreturn {CATEGORIES,computeSplit,settle,kitty,surpriseWeights,weightedPick,summaryText,brl};')();
const st = { kittyPerFamily: 900, families: [
  { id:'A', name:'Família A', members:[{id:'a1',name:'Carlos',drinks:true},{id:'a2',name:'Ana',drinks:true},{id:'a3',name:'Pedro',drinks:false},{id:'a4',name:'Lia',drinks:false}]},
  { id:'B', name:'Família B', members:[{id:'b1',name:'Marcos',drinks:true},{id:'b2',name:'Júlia',drinks:false},{id:'b3',name:'Rafa',drinks:true}]},
  { id:'C', name:'Família C', members:[{id:'c1',name:'Beto',drinks:true},{id:'c2',name:'Clara',drinks:true},{id:'c3',name:'Davi',drinks:false},{id:'c4',name:'Nina',drinks:false}]},
  { id:'D', name:'Família D', members:[{id:'d1',name:'Tiago',drinks:true},{id:'d2',name:'Bia',drinks:false},{id:'d3',name:'Leo',drinks:false}]}],
  expenses: [[680,'groceries','a1'],[420,'gas','b1'],[540,'food','c1'],[360,'alcohol','d1'],[610,'food','b2'],[390,'gas','c2'],[180,'alcohol','a2']]
    .map(([amount,category,payerId],i)=>({id:'e'+i,amount,category,payerId})) };
const s = L.computeSplit(st);
const near = (a,b)=>Math.abs(a-b)<1e-6;
assert(near(s.total, 3180));
assert(near(s.persons.reduce((x,p)=>x+p.net,0), 0), 'person nets sum to 0');
assert(near(s.families.reduce((x,f)=>x+f.net,0), 0), 'family nets sum to 0');
const common = 2640/14, alc = 540/7;
for (const p of s.persons) assert(near(p.owed, common + (p.drinks ? alc : 0)), 'share ' + p.name);
// alcohol-only: non-drinkers owe 0
const st2 = { ...st, expenses: [{id:'x',amount:700,category:'alcohol',payerId:'a3'}] };
const s2 = L.computeSplit(st2);
s2.persons.forEach(p => assert(near(p.owed, p.drinks ? 100 : 0)));
assert(near(s2.persons.reduce((x,p)=>x+p.net,0), 0));
// no drinkers -> warning + still balances
const st3 = JSON.parse(JSON.stringify(st2)); st3.families.forEach(f=>f.members.forEach(m=>m.drinks=false));
const s3 = L.computeSplit(st3); assert(s3.warnings.includes('noDrinkers')); assert(near(s3.persons.reduce((x,p)=>x+p.net,0),0));
// settlement clears all balances with <= n-1 transfers
const x = L.settle(s.families); assert(x.length <= 3);
const bal = Object.fromEntries(s.families.map(f=>[f.id,f.net]));
x.forEach(t=>{bal[t.from]+=t.amount; bal[t.to]-=t.amount;});
Object.values(bal).forEach(v=>assert(Math.abs(v)<0.02));
const k = L.kitty(st, s); assert(near(k.left, 420)); assert(near(k.families.reduce((a,f)=>a+f.back,0), 420));
console.log('Families:'); s.families.forEach(f=>console.log(` ${f.name}: paid ${f.paid.toFixed(2)} owed ${f.owed.toFixed(2)} net ${f.net.toFixed(2)}`));
console.log('Transfers:'); x.forEach(t=>console.log(` ${t.fromName} -> ${t.toName}: ${t.amount}`));
console.log('\n' + L.summaryText(st, s, x, k));
console.log('\nALL TESTS PASSED');

// ---- parser / proof tests
const L2 = new Function(src.replace(/^[^\n]*\n/, '') + '\nreturn {parseQuick,pendingInfo,fuelCost,computeSplit};')();
const fams = st.families;
const P = t => L2.parseQuick(t, fams);
const cases = [
  ['80 gasolina família B', { amount: 80, category: 'gas', payerId: 'b1', payerVia: 'family' }],
  ['churrasco 350 pago pela família D', { amount: 350, category: 'food', payerId: 'd1' }],
  ['cerveja 120 Família C', { amount: 120, category: 'alcohol', payerId: 'c1' }],
  ['pedágio 12,50 Tiago sem nota', { amount: 12.5, category: 'gas', payerId: 'd1', payerVia: 'person', proof: 'none' }],
  ['feira 85 júlia pix', { amount: 85, category: 'groceries', payerId: 'b2', proof: 'comp' }],
  ['~300 gasolina volta Clara', { amount: 300, category: 'gas', payerId: 'c2', estimated: true }],
  ['R$ 1.250,90 mercado Carlos nota', { amount: 1250.9, category: 'groceries', payerId: 'a1', proof: 'nf' }],
  ['gorjeta garçom 20 Marcos', { amount: 20, category: 'food', payerId: 'b1' }],
  ['2 caipirinhas 36 reais Ana', { amount: 36, category: 'alcohol', payerId: 'a2' }],
  ['álcool no posto 150 Beto', { amount: 150, category: 'gas', payerId: 'c1' }],
  ['uns 60 de sorvete ambulante Bia', { amount: 60, category: 'food', payerId: 'd2', estimated: true }],
  ['vinho 90 Rafa fam B', { amount: 90, category: 'alcohol', payerId: 'b3', payerVia: 'person' }],
  ['gasolina 200 Marcso', { payerId: 'b1' }], // typo tolerance
];
for (const [t, exp] of cases) { const r = P(t); for (const k in exp) assert.deepStrictEqual(r[k], exp[k], `${t} -> ${k}: got ${r[k]}`); }
assert.equal(P('churrasco 350 pago pela família D').description, 'Churrasco');
assert.equal(P('pedágio 12,50 Tiago sem nota').description, 'Pedágio');
assert.equal(P('~300 gasolina volta Clara').description, 'Gasolina volta');
assert.equal(P('hello').amount, null); assert.equal(P('').payerId, null);
assert.equal(L2.fuelCost(720, 12, 6.5), 390); assert.equal(L2.fuelCost(0, 12, 6.5), 0);
// pending + include toggle
const st4 = JSON.parse(JSON.stringify(st));
st4.expenses.push({ id: 'p1', amount: 42.6, category: 'gas', payerId: 'd1', proof: 'none' });
st4.expenses.push({ id: 'p2', amount: 85, category: 'groceries', payerId: 'b2', proof: 'none', confirmedBy: 'C' });
st4.expenses.push({ id: 'p3', amount: 100, category: 'gas', payerId: 'a1', proof: 'comp', estimated: true });
const pi = L2.pendingInfo(st4); assert.equal(pi.unconfirmed.length, 1); assert(near(pi.unconfirmedTotal, 42.6)); assert.equal(pi.estimated.length, 1);
assert.equal(pi.byProof.none.count, 2); assert.equal(pi.byProof.nf.count, 7);
const inc = L2.computeSplit(st4); st4.includeUnconfirmed = false; const exc = L2.computeSplit(st4);
assert(near(inc.total - exc.total, 42.6)); assert.equal(exc.excluded, 1); assert(near(exc.persons.reduce((x, p) => x + p.net, 0), 0));
console.log('PARSER + PROOF TESTS PASSED (' + cases.length + ' parser cases)');

// ---- planning: portion-based split + shopping aggregation
const L3 = new Function(src.replace(/^[^\n]*\n/, '') + '\nreturn {computeSplit,portions,shoppingList,shoppingText,parseBought,tripDays};')();
const base = () => ({ splitMode: 'porcoes', families: [
  { id: 'A', name: 'Família A', members: [{ id: 'a1', name: 'Ad', drinks: true }, { id: 'a2', name: 'Kid', type: 'crianca', drinks: false }] },
  { id: 'B', name: 'Família B', members: [{ id: 'b1', name: 'Bd', drinks: true }, { id: 'b2', name: 'Baby', type: 'bebe', drinks: false }] },
  { id: 'C', name: 'Família C', arrive: '2026-12-03', arriveMeal: 'cafe', members: [{ id: 'c1', name: 'Late', drinks: true }] } ],
  trip: { start: '2026-12-01', end: '2026-12-04', meals: { cafe: true, almoco: true, lanche: false, jantar: true } }, plan: {}, expenses: [] });
const s1 = base();
assert.deepStrictEqual(L3.tripDays(s1.trip), ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']);
const P1 = L3.portions(s1);
assert.equal(P1.per.a1.casa, 12); assert.equal(P1.per.a2.casa, 6); assert.equal(P1.per.b2.casa, 0); assert.equal(P1.per.c1.casa, 6); // 4 days x 3 meals; late = 2 days
assert.equal(P1.per.c1.days, 2); assert.equal(P1.per.a1.drinkerDays, 4); assert.equal(P1.per.c1.drinkerDays, 2);
s1.expenses = [{ id: 'x1', amount: 360, category: 'groceries', payerId: 'a1' }, { id: 'x2', amount: 100, category: 'alcohol', payerId: 'b1' }, { id: 'x3', amount: 90, category: 'gas', payerId: 'c1' }];
const sp = L3.computeSplit(s1), o = id => sp.persons.find(p => p.id === id).owed;
assert(near(sp.persons.reduce((x, p) => x + p.net, 0), 0), 'portion split nets sum to 0');
assert(near(sp.persons.reduce((x, p) => x + p.owed, 0), 550), 'portion split owed sums to total');
// groceries 360 over 12+6+12+0+6 = 36 portions -> 10/portion
assert(near(o('a1'), 120 + 100 * 4 / 10 + 18)); assert(near(o('a2'), 60 + 18)); assert(near(o('b2'), 18)); assert(near(o('c1'), 60 + 100 * 2 / 10 + 18));
assert(o('c1') < o('a1'), 'late arrival pays less'); assert(near(o('a2') - 18, (o('a1') - 18 - 40) / 2), 'kid weighted 0.5');
s1.splitMode = 'igual'; const eq = L3.computeSplit(s1); eq.persons.forEach(p => assert(near(p.owed, 110)));
s1.splitMode = 'pessoa'; const pp = L3.computeSplit(s1); assert(near(pp.persons.find(p => p.id === 'a2').owed, 72 + 18)); // groceries/5 + gas/5, no alcohol
// shopping aggregation
const q2 = base(); q2.plan = { '2026-12-01': { almoco: { mode: 'casa', menu: 'churrasco' }, jantar: { mode: 'fora' }, cafe: { mode: 'livre' } } };
const S = L3.shoppingList(q2), row = k => S.rows.find(r => r.key === k);
// portions on 12-01 almoço: a1 1 + a2 .5 + b1 1 + b2 0 = 2.5 (C not yet arrived) -> carne 1000 g
assert(near(row('carne').need, 1000)); assert.equal(row('carne').packs, 1); assert(near(row('carvao').need, 1250)); assert.equal(row('carvao').packs, 1);
assert(row('agua').need === (4 + 4 + 4 + 2) * 2000, 'water per non-baby person-day'); assert.equal(row('cerveja').need, (4 + 4 + 2) * 1500);
assert(near(S.groceryTotal, S.rows.reduce((x, r) => x + r.cost, 0))); assert(near(S.perFamily.reduce((x, f) => x + f.cost, 0), S.total), 'family preview sums to total');
assert(S.P.foraTotal === 2.5 && near(S.foraTotal, 2.5 * 55));
q2.expenses = [{ id: 'b', amount: 80, category: 'groceries', payerId: 'a1', items: 'picanha 0,6 kg, carvão, cerveja 2 fardos, 12 latas cerveja' }];
const QS2 = L3.shoppingList(q2), r2 = k => QS2.rows.find(r => r.key === k);
assert(near(r2('carne').toBuy, 400)); assert.equal(r2('carvao').toBuy, 0); assert(near(r2('cerveja').bought, 2 * 4200 + 12 * 350));
assert(/☐ Carne bovina/.test(L3.shoppingText(q2, QS2)));
console.log('PLANNING TESTS PASSED (portions, late arrival, kid weights, scenarios, shopping, bought items)');

// ---- recipe parser, scaling, diet, rota
const R = new Function(src.replace(/^[^\n]*\n/, '') + '\nreturn {parseRecipe,parseIngredient,shoppingList,recipeCost,dietConflicts,kitchenRota,portions};')();
const I = t => R.parseIngredient(t);
const chk = (t, exp) => { const r = I(t); for (const k in exp) { const got = r[k]; const ok = typeof exp[k] === 'number' ? Math.abs(got - exp[k]) < 1e-6 : got === exp[k]; assert(ok, `"${t}" ${k}: expected ${exp[k]} got ${got}`); } };
chk('500 g de carne moída', { qty: 500, unit: 'g', itemKey: 'carne_moida', name: 'carne moída', status: 'ok' });
chk('1 kg de arroz', { qty: 1000, unit: 'g', itemKey: 'arroz' });
chk('2 xícaras (chá) de arroz', { qty: 2 * 240 * 0.77, unit: 'g', itemKey: 'arroz', status: 'ok' });
chk('1/2 xícara de óleo', { qty: 120, unit: 'ml', itemKey: 'oleo' });
chk('½ xícara de açúcar', { qty: 120 * 0.8, unit: 'g', itemKey: 'acucar' });
chk('1 e 1/2 xícara de farinha de trigo', { qty: 1.5 * 240 * 0.53, unit: 'g', itemKey: 'farinha' });
chk('1 1/2 litro de leite', { qty: 1500, unit: 'ml', itemKey: 'leite' });
chk('2 a 3 dentes de alho', { qty: 2.5, unit: 'un', itemKey: 'alho', range: true });
chk('3 colheres de sopa de azeite', { qty: 45, unit: 'ml', itemKey: 'azeite' });
chk('1 colher (chá) de sal', { qty: 5 * 1.2, unit: 'g', itemKey: 'sal' });
chk('1 lata de molho de tomate', { qty: 340, unit: 'g', itemKey: 'molho' });
chk('1 pacote de macarrão', { qty: 500, unit: 'g', itemKey: 'macarrao' });
chk('2 cebolas picadas', { qty: 2, unit: 'un', itemKey: 'cebola' });
chk('1 dúzia de ovos', { qty: 12, unit: 'un', itemKey: 'ovos' });
chk('1 maço de cheiro-verde', { qty: 1, unit: 'un', itemKey: 'cheiro_verde' });
chk('Sal e pimenta a gosto', { qty: null, aGosto: true, name: 'Sal e pimenta', itemKey: 'sal' });
chk('- uma pitada de sal', { qty: 0.5, unit: 'g', itemKey: 'sal' });
chk('meia xícara de leite', { qty: 120, unit: 'ml' });
chk('1,5 kg de picanha', { qty: 1500, unit: 'g', itemKey: 'carne' });
chk('2 xícaras de grão misterioso', { status: 'medio', unit: 'g' });
chk('cozinhe tudo junto', { status: 'erro' });
const txt = `*Arroz carreteiro*
Rende 6 a 8 porções

Ingredientes:
- 500 g de carne seca dessalgada
- 2 xícaras (chá) de arroz
- 1 cebola picada
- 3 dentes de alho
- 2 tomates
- 3 colheres (sopa) de óleo
- Cheiro-verde a gosto
- algo estranho sem medida

Modo de preparo:
1. Desfie a carne seca.
2. Refogue alho e cebola no óleo.
3) Junte o arroz e a água.`;
const rc = R.parseRecipe(txt);
assert.equal(rc.title, 'Arroz carreteiro'); assert.equal(rc.yield, 7); assert(rc.yieldFound);
assert.equal(rc.ingredients.length, 8); assert.equal(rc.steps.length, 3); assert.equal(rc.steps[0], 'Desfie a carne seca.');
assert.equal(rc.ingredients[7].status, 'erro'); assert(rc.ingredients.slice(0, 7).every(i => i.status === 'ok'), JSON.stringify(rc.ingredients.map(i => [i.name, i.status])));
assert.equal(R.parseRecipe('Bolo simples\n2 ovos\n1 xícara de leite\nMisture tudo e asse.').yield, 4); // default
const rb = R.parseRecipe('Bolo simples\n2 ovos\n1 xícara de leite\nMisture tudo e asse.'); assert.equal(rb.ingredients.length, 2); assert.equal(rb.steps.length, 1);
assert.equal(R.parseRecipe('Feijoada (serve 10 pessoas)\n1 kg de feijão').yield, 10);
// scaling + aggregation exactness: recipe for 4 cooked for 2.5 weighted portions
const rs = { splitMode: 'porcoes', families: [{ id: 'A', name: 'A', members: [{ id: 'a', name: 'Ad' }, { id: 'k', name: 'Kid', type: 'crianca', diet: { lactose: true } }] }, { id: 'B', name: 'B', members: [{ id: 'b', name: 'Bd', diet: { veg: true, alergia: 'tomate' } }] }],
  trip: { start: '2026-12-01', end: '2026-12-01', meals: { almoco: true } }, recipes: [{ id: 'r1', title: 'Teste', yield: 4, ingredients: [R.parseIngredient('400 g de carne moída'), R.parseIngredient('1 lata de molho de tomate'), R.parseIngredient('200 ml de leite'), R.parseIngredient('sal a gosto'), R.parseIngredient('2 xícaras de grão misterioso')] }],
  plan: { '2026-12-01': { almoco: { mode: 'casa', recipes: ['r1', 'r1'] } } }, expenses: [] };
const SS = R.shoppingList(rs), rr = k => SS.rows.find(x => x.key === k);
assert(near(rr('carne_moida').need, 2 * 400 * 2.5 / 4)); assert(near(rr('molho').need, 2 * 340 * 2.5 / 4)); assert(near(rr('leite').need, 2 * 200 * 2.5 / 4));
assert(rr('sal').aGosto && rr('sal').packs === 1); assert(SS.rows.some(x => x.custom && /Grão misterioso/i.test(x.name)));
assert.equal(SS.dishes.length, 2); assert(near(SS.dishes.reduce((x, d) => x + d.cost, 0), SS.rows.filter(x => !x.aGosto && ['carne_moida', 'molho', 'leite'].includes(x.key) || x.custom).reduce((x, r) => x + r.need * r.price / (r.custom ? 1000 : ({ carne_moida: 500, molho: 340, leite: 1000 })[r.key]), 0)));
const rcst = R.recipeCost(rs, rs.recipes[0]); assert(near(rcst.perPortion * 4, rcst.total));
assert.deepStrictEqual(R.dietConflicts(rs, rs.recipes[0], rs.families[0].members[1]).length, 1);
assert.equal(R.dietConflicts(rs, rs.recipes[0], rs.families[1].members[0]).length, 2); // veg + tomate allergy
const rot = R.kitchenRota({ ...rs, trip: { start: '2026-12-01', end: '2026-12-04', meals: { almoco: true, jantar: true } }, plan: {} });
const cooks = Object.values(rot.rota).map(x => x.cook); assert.equal(cooks.length, 8); assert(cooks.includes('A') && cooks.includes('B'));
assert(Object.values(rot.rota).every(x => x.cook !== x.clean));
console.log('RECIPE TESTS PASSED (parser: fractions, units, ranges, a gosto, yields; scaling; diet; rota)');

// Governança 2.9: textos que vão para o WhatsApp nunca carregam dieta/alergia
{
  const T = new Function(src.replace(/^[^\n]*\n/, '') + '\nreturn {computeSplit,settle,kitty,summaryText,shoppingList,shoppingText};')();
  const sd = { splitMode: 'porcoes', includeUnconfirmed: true, kittyPerFamily: 100, weights: {}, prices: {}, planQty: {}, recipes: [],
    trip: { start: '2031-03-03', end: '2031-03-05', meals: { cafe: true, almoco: true, lanche: false, jantar: true } }, plan: {}, settled: {},
    families: [{ id: 'fa', name: 'Família A', members: [{ id: 'a1', name: 'Ana', drinks: true, diet: { veg: true, lactose: true, alergia: 'castanhaxyz' } }, { id: 'a2', name: 'Lia', type: 'crianca', diet: { alergia: 'amendoimxyz', gluten: true } }] },
      { id: 'fb', name: 'Família B', members: [{ id: 'b1', name: 'Beto', drinks: true, diet: { veg: true } }] }],
    expenses: [{ id: 'e1', amount: 200, category: 'groceries', description: 'Mercado', payerId: 'a1', proof: 'nf', ts: 1 }, { id: 'e2', amount: 50, category: 'food', description: 'Pão', payerId: 'b1', proof: 'none', ts: 2 }] };
  const sp = T.computeSplit(sd), tr = T.settle(sp.families), kt = T.kitty(sd, sp);
  const out = T.summaryText(sd, sp, tr, kt) + '\n' + T.shoppingText(sd, T.shoppingList(sd));
  for (const bad of ['amendoimxyz', 'castanhaxyz', 'alergia', 'Alergia', 'veg', 'lactose', 'glúten', 'gluten']) assert(!out.includes(bad), 'texto compartilhado vazou: ' + bad);
  console.log('PRIVACY TEXT TESTS PASSED (summaryText/shoppingText sem dieta/alergia)');
}
