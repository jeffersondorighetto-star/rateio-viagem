// Modo compartilhado (design completo) com servidor falso em memória (tests/fake-core.js) e vários aparelhos.
const fs = require('fs'), assert = require('assert');
const { createCore } = require('./fake-core');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const src = html.split('// ===== LOGIC-START')[1].split('// ===== LOGIC-END')[0];
const L = new Function(src.replace(/^[^\n]*\n/, '') + '\nreturn {computeSplit,settle,stateToRows,rowsToState,computeEdits,mergeBase,createSync,importCheck,genEventCode,validCode,normCode,createPhotoQueue,shoppingList,PHOTO_URL_TTL,parseRecipe,purgeEventPhotos,photoPurgeBy};')();
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;
const clone = o => JSON.parse(JSON.stringify(o));
const tick = () => new Promise(r => setTimeout(r, 5));

// ---------- fake supabase client over the core ----------
function client(core, user) {
  const c = { online: true, user };
  const net = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });
  c.from = t => ({ select: () => ({ eq: (col, v) => { const run = gte => Promise.resolve(c.online ? core.select(user, t, col, v, gte) : net());
    return { then: (a, b) => run().then(a, b), gte: (gc, gv) => run([gc, gv]) }; } }) });
  c.storage = { from: () => ({ upload: async (path, blob, o) => c.online ? core.storage(user, 'upload', path, { ...o, size: blob.size, data: blob.data }) : net(),
    createSignedUrl: async (path, exp) => c.online ? core.storage(user, 'sign', path, { expiresIn: exp }) : net(),
    remove: async paths => { if (!c.online) return net(); const data = []; for (const p of paths) data.push(...(core.storage(user, 'remove', p).data || [])); return { data, error: null }; } }) };
  c.rpc = async (fn, a) => { if (!c.online) return net(); const r = core.rpc(user, fn, clone(a)); if (c.dropReplies > 0 && fn === 'apply_ops') { c.dropReplies--; return net(); } return r; };
  c.channel = () => { const ch = { hs: [], on(_, f, cb) { this.hs.push({ f, cb }); return this; },
    subscribe(cb) { this.off = core.listen(user.id, (t, row) => setTimeout(() => { if (!c.online) return; this.hs.forEach(h => { if (h.f.table !== t) return; const [col, v] = h.f.filter.split('=eq.'); if (String(row[col]) === v) h.cb({ new: row }); }); }, 0)); setTimeout(() => cb && cb('SUBSCRIBED'), 0); return this; } }; return ch; };
  c.removeChannel = ch => ch.off && ch.off();
  return c;
}
const timers = () => { const q = []; return { set: f => { q.push(f); return q.length; }, clear: () => {}, run: async () => { for (const f of q.splice(0)) await f(); } }; };
function device(core, user, eventId, initial, savedBase) {
  const d = { state: initial || { families: [], expenses: [], settled: {} }, statuses: [], notices: [], members: [], savedBase: savedBase || null, T: timers() };
  d.client = client(core, user);
  d.sync = L.createSync({ client: d.client, eventId, timers: d.T, getState: () => d.state, setState: s => { d.state = s; },
    onStatus: s => d.statuses.push(s), onNotice: n => d.notices.push(...n), onMembership: m => d.members.push(m),
    loadBase: () => d.savedBase && clone(d.savedBase), saveBase: b => { d.savedBase = b; } });
  d.sync.setUser(user.id);
  d.edit = async fn => { fn(d.state); d.sync.schedule(); await d.T.run(); await tick(); };
  d.start = async () => { await d.sync.load(); d.sync.subscribe(); await tick(); await d.T.run(); await tick(); };
  return d;
}
// Datas claramente fictícias (2031); nomes inventados.
const D1 = '2031-03-03', D2 = '2031-03-04', D3 = '2031-03-05';
const sample = () => ({
  splitMode: 'porcoes', includeUnconfirmed: false, kittyPerFamily: 500, weights: { crianca: 0.6 },
  trip: { start: D1, end: D3, meals: { cafe: true, almoco: true, lanche: false, jantar: true } },
  plan: { [D1]: { almoco: { mode: 'fora' }, jantar: { mode: 'casa', recipes: ['r1'] } } },
  recipes: [{ id: 'r1', ...L.parseRecipe('Bolo teste\nRende 8 porções\nIngredientes\n500 g de farinha\n3 ovos\nModo de preparo\nAssar'), text: 'Bolo teste\nRende 8 porções\nIngredientes\n500 g de farinha\n3 ovos\nModo de preparo\nAssar', stepsText: 'Assar' }],
  prices: { farinha: 7.5 }, planQty: {},
  families: [
    { id: 'fa', name: 'Família A', members: [{ id: 'a1', name: 'Ana', drinks: true }, { id: 'a2', name: 'Lia', type: 'crianca', diet: { alergia: 'amendoim' } }] },
    { id: 'fb', name: 'Família B', arrive: D2, arriveMeal: 'jantar', members: [{ id: 'b1', name: 'Beto', drinks: true, diet: { veg: true } }, { id: 'b2', name: 'Bia', depart: D2, departMeal: 'almoco' }] },
    { id: 'f_c', name: 'Família C', members: [{ id: 'c1', name: 'Caio', type: 'adolescente' }] },
  ],
  expenses: [
    { id: 'e1', amount: 300.1, category: 'groceries', description: 'Mercado', payerId: 'a1', proof: 'nf', items: 'carne 2 kg', ts: 3, photo: 'data:image/jpeg;base64,AAAA' },
    { id: 'e2', amount: 120, category: 'alcohol', description: 'Cerveja', payerId: 'b1', proof: 'none', ts: 2, confirmedBy: 'fa', confirmedAt: 1760000000000 },
    { id: 'e3', amount: 80.55, category: 'gas', description: 'Gasolina', payerId: 'c1', proof: 'none', estimated: true, note: 'aprox', ts: 1 },
    { id: 'e4', amount: 45, category: 'food', description: 'Sorvete', payerId: 'b2', proof: 'comp', ts: 0 },
  ],
  settled: { 'fa_f_c': { amount: 10, at: 1 } },
});
const asRows = (st, ev) => { const r = L.stateToRows(st, ev); return { ...r, confirmations: r.confirm.map(c => ({ ...c, id: c.expense_id, voided_at: null })) }; };
const nets = s => Object.fromEntries(L.computeSplit(s).families.map(f => [f.id, f.net]));
const sameNets = (a, b) => { const x = nets(a), y = nets(b); assert.deepStrictEqual(Object.keys(x).sort(), Object.keys(y).sort()); for (const k in x) assert(near(x[k], y[k]), `net ${k}: ${x[k]} vs ${y[k]}`); };
const shop = s => JSON.stringify(L.shoppingList(s));
const O = { id: 'u-org', is_anonymous: false, github: 'org-teste', github_id: 1001 }, A = { id: 'u-a', is_anonymous: true }, B = { id: 'u-b', is_anonymous: true }, X = { id: 'u-x', is_anonymous: true };
const G = { id: 'u-g', is_anonymous: false, github: 'org-teste', github_id: 9009 }; // mesmo login, outro id
const settle3 = async (...ds) => { for (let i = 0; i < 3; i++) { for (const d of ds) { await d.T.run(); await tick(); } } };

(async () => {
  // 1) mapping
  const rows = L.stateToRows(sample(), 'ev1'), dump = JSON.stringify(rows);
  for (const bad of ['amendoim', '"veg"', 'diet', 'alergia', 'data:image']) assert(!dump.includes(bad), 'leak: ' + bad);
  assert.strictEqual(rows.people.length, 5); assert.strictEqual(rows.expenses.length, 4); assert.strictEqual(rows.settlement_marks.length, 1);
  assert.deepStrictEqual(rows.confirm, [{ expense_id: 'e2', family_id: 'fa' }]);
  assert.deepStrictEqual(rows.event_overrides.map(o => [o.kind, o.key, o.value]), [['weight', 'crianca', 0.6], ['price', 'farinha', 7.5]]);
  assert.strictEqual(rows.recipes.length, 1); assert.strictEqual(rows.recipes[0].yield, 8); assert(rows.recipes[0].parsed.ingredients.length === 2);
  assert.deepStrictEqual(rows.meal_plan.map(m => [m.day, m.meal, m.mode, m.recipe_ids]), [[D1, 'almoco', 'fora', []], [D1, 'jantar', 'casa', ['r1']]]);
  const sh = { ...sample(), syncMode: true }, back = L.rowsToState(asRows(sh, 'ev1'), sh);
  sameNets(sh, back); assert.strictEqual(back.families[0].members[1].diet.alergia, 'amendoim'); assert(back.expenses.find(e => e.id === 'e1').photo);
  assert.strictEqual(back.expenses.find(e => e.id === 'e2').confirmedBy, 'fa'); assert.strictEqual(back.weights.crianca, 0.6); assert.strictEqual(back.prices.farinha, 7.5);
  assert.strictEqual(back.recipes[0].stepsText, 'Assar', 'local-only recipe fields kept'); assert.strictEqual(shop(back), shop(sh), 'shopping list identical after round trip');
  const fresh = L.rowsToState(asRows(sh, 'ev1'), null); sameNets(sh, fresh); assert(!fresh.families[0].members[1].diet); assert.strictEqual(shop(fresh), shop(sh));
  const odd = L.rowsToState({ events: {}, families: [{ id: 'f1', name: 'F', pos: 0 }], people: [{ id: 'p1', family_id: 'f1', first_name: 'X', type: 'alien', pos: 0 }],
    expenses: [{ id: 'x', amount: '10.00', category: 'zzz', proof: 'qq' }] }, null);
  assert.strictEqual(odd.expenses[0].category, 'food'); assert.strictEqual(odd.expenses[0].proof, 'nf'); assert.strictEqual(odd.families[0].members[0].type, 'adulto');
  const b0 = { events: rows.events, versions: {}, confirmations: {}, families: {}, people: {}, expenses: {}, settlement_marks: {}, event_overrides: {}, recipes: {}, meal_plan: {} };
  rows.expenses.forEach(r => { b0.expenses['ev1|' + r.id] = r; });
  const st2 = clone(sample()); st2.expenses[0].amount = 999; st2.expenses.pop();
  const ed = L.computeEdits(b0, L.stateToRows(st2, 'ev1'));
  assert.deepStrictEqual(ed.rows.expenses.find(e => e.key === 'ev1|e1').patch, { amount: 999 }, 'only the changed field');
  assert(ed.rows.expenses.find(e => e.key === 'ev1|e4').patch.deleted_at, 'removed row -> soft delete');
  const edM = L.computeEdits({ ...b0, events: { ...rows.events, kitty_per_family: 1 } }, L.stateToRows(st2, 'ev1'), { settings: false });
  assert(!edM.events && !(edM.rows.event_overrides || []).length, 'settings excluded for members');
  console.log('MAPPING TESTS PASSED (no health/photo leak, recipes + plan + prices synced, shopping list identical, field patches)');

  // 2) allowlist + approval flow
  const core = createCore({ allow: [1001] });
  assert.strictEqual(core.rpc(G, 'create_event', { p_name: 'x', p_code: 'GGGG2345', p_display_name: 'g' }).error.message, 'organizer_only', 'GitHub fora da lista não cria');
  const ev = core.rpc(O, 'create_event', { p_name: 'Teste', p_code: 'ABCD2345', p_display_name: 'Org' }).data;
  assert.strictEqual(core.rpc(A, 'create_event', { p_name: 'x', p_code: 'BBBB2345', p_display_name: 'a' }).error.message, 'organizer_login_required');
  const DO = device(core, O, ev); await DO.start(); assert.strictEqual(DO.sync.status(), 'synced'); assert.strictEqual(DO.sync.role(), 'organizer');
  const j = core.rpc(A, 'join_event', { p_code: 'abcd2345', p_display_name: 'Ana' }).data;
  assert.strictEqual(j.status, 'pending'); assert(!('event_name' in j), 'pending join: no event name');
  const DA = device(core, A, ev);
  await assert.rejects(DA.sync.load(), e => e.code === 'pending' && !('event_name' in e.membership)); console.log('  ✓ pendente não carrega o evento nem vê o nome');
  await DO.edit(st => Object.assign(st, L.rowsToState(asRows({ ...sample(), syncMode: true }, ev), { ...sample(), syncMode: true })));
  assert.strictEqual(DO.sync.status(), 'synced', DO.statuses.slice(-3).join()); assert.strictEqual(DO.sync.pendingCount(), 0, 'no dirty rows after echo');
  assert.strictEqual(core.db.expenses.length, 4); assert.strictEqual(core.db.expense_confirmations.length, 1); assert.strictEqual(core.db.event_overrides.length, 2);
  assert.strictEqual(core.db.recipes.length, 1); assert.strictEqual(core.db.meal_plan.length, 2);
  core.rpc(O, 'approve_member', { p_event: ev, p_user: A.id }); await tick();
  assert(DO.members.some(m => m.user_id === A.id && m.status === 'approved'), 'organizer sees member change live');
  await DA.start(); assert.strictEqual(DA.state.expenses.length, 4); sameNets(DA.state, DO.state); assert.strictEqual(DA.sync.role(), 'member');
  assert(!DA.state.expenses.find(e => e.id === 'e1').photo && !DA.state.families[0].members[1].diet); assert.strictEqual(DA.state.expenses.find(e => e.id === 'e2').confirmedBy, 'fa');
  assert.strictEqual(DA.state.weights.crianca, 0.6); assert.strictEqual(DA.state.eventName, 'Teste'); assert.strictEqual(shop(DA.state), shop(DO.state), 'shared shopping list');
  console.log('APPROVAL TESTS PASSED (allowlist, anon cannot create, pending blind, approve -> same balances + shopping list)');

  // 3) settings organizer-only + roles
  await DA.edit(st => { st.kittyPerFamily = 1; st.weights.crianca = 0.9; st.splitMode = 'igual'; st.prices.farinha = 1; });
  assert.strictEqual(DA.state.kittyPerFamily, 500, 'member settings edit reverted'); assert.strictEqual(DA.state.weights.crianca, 0.6); assert.strictEqual(DA.state.splitMode, 'porcoes'); assert.strictEqual(DA.state.prices.farinha, 7.5);
  assert(DA.notices.some(n => n.kind === 'settings')); assert.strictEqual(core.db.events[0].kitty_per_family, '500.00');
  await DO.edit(st => { st.kittyPerFamily = 650; st.weights.crianca = 0.7; st.prices.farinha = 8; });
  assert.strictEqual(DA.state.kittyPerFamily, 650); assert.strictEqual(DA.state.weights.crianca, 0.7); assert.strictEqual(DA.state.prices.farinha, 8);
  assert.strictEqual(core.rpc(O, 'set_member_role', { p_event: ev, p_user: O.id, p_role: 'member' }).error.message, 'last_organizer');
  core.rpc(O, 'set_member_role', { p_event: ev, p_user: A.id, p_role: 'organizer' }); await tick();
  assert.strictEqual(DA.sync.role(), 'organizer', 'promotion arrives live');
  await DA.edit(st => { st.kittyPerFamily = 700; }); assert.strictEqual(DO.state.kittyPerFamily, 700, 'promoted member edits settings');
  assert.strictEqual(core.rpc(A, 'set_member_role', { p_event: ev, p_user: O.id, p_role: 'member' }).error.message, 'cannot_demote_creator');
  core.rpc(O, 'set_member_role', { p_event: ev, p_user: A.id, p_role: 'member' }); await tick(); assert.strictEqual(DA.sync.role(), 'member');
  await DA.edit(st => { st.kittyPerFamily = 5; }); assert.strictEqual(DA.state.kittyPerFamily, 700, 'demoted: read-only again');
  console.log('SETTINGS/ROLES TESTS PASSED (member read-only + notice, organizer writes, promote/demote live, last organizer + creator guarded)');

  // 4) live edits + versions + confirmations by own family
  await DA.edit(st => st.expenses.unshift({ id: 'e5', amount: 50, category: 'food', description: 'Pão', payerId: 'b2', proof: 'none', ts: 9 }));
  assert(DO.state.expenses.find(e => e.id === 'e5')); sameNets(DO.state, DA.state);
  await DA.edit(st => { const e = st.expenses.find(e => e.id === 'e5'); e.confirmedBy = 'fa'; e.confirmedAt = Date.now(); });
  assert(!DA.state.expenses.find(e => e.id === 'e5').confirmedBy, 'member without family cannot confirm'); assert(!core.db.expense_confirmations.some(c => c.expense_id === 'e5'));
  core.rpc(O, 'set_member_family', { p_event: ev, p_user: A.id, p_family: 'fa' }); await tick();
  assert.strictEqual((await DA.sync.membership()).family_id, 'fa');
  await DA.edit(st => { const e = st.expenses.find(e => e.id === 'e5'); e.confirmedBy = 'f_c'; e.confirmedAt = Date.now(); });
  assert(!core.db.expense_confirmations.some(c => c.expense_id === 'e5' && !c.voided_at), 'member cannot confirm for another family');
  await DA.edit(st => { const e = st.expenses.find(e => e.id === 'e5'); e.confirmedBy = 'fa'; e.confirmedAt = Date.now(); });
  assert.strictEqual(DO.state.expenses.find(e => e.id === 'e5').confirmedBy, 'fa', 'own-family confirmation propagates');
  await DA.edit(st => { const e = st.expenses.find(e => e.id === 'e5'); e.payerId = 'c1'; delete e.confirmedBy; });
  assert(!DO.state.expenses.find(e => e.id === 'e5').confirmedBy, 'payer change voids confirmation on every device');
  DA.client.online = false;
  await DA.edit(st => { st.expenses.find(e => e.id === 'e1').description = 'Mercado grande'; });
  await DO.edit(st => { st.expenses.find(e => e.id === 'e1').amount = 310; });
  DA.client.online = true; await DA.sync.resync(); await tick(); await DO.T.run(); await tick();
  for (const d of [DA, DO]) { const e1 = d.state.expenses.find(e => e.id === 'e1'); assert.strictEqual(e1.description, 'Mercado grande'); assert.strictEqual(e1.amount, 310); }
  assert.strictEqual(DA.notices.filter(n => n.kind === 'conflict').length, 0, 'no notice when fields differ');
  DA.client.online = false;
  await DA.edit(st => { st.expenses.find(e => e.id === 'e3').amount = 99; });
  await DO.edit(st => { st.expenses.find(e => e.id === 'e3').amount = 120; });
  DA.client.online = true; await DA.sync.resync(); await tick();
  assert.strictEqual(DA.state.expenses.find(e => e.id === 'e3').amount, 120, 'server wins on same field');
  assert(DA.notices.some(n => n.kind === 'conflict' && n.field === 'amount' && n.mine === 99 && n.theirs === 120), 'conflict notice');
  const x = L.settle(L.computeSplit(DO.state).families)[0];
  await DO.edit(st => { st.settled[x.from + '_' + x.to] = { amount: x.amount, at: Date.now() }; });
  assert(DA.state.settled[x.from + '_' + x.to]); await DO.edit(st => { delete st.settled[x.from + '_' + x.to]; }); assert(!DA.state.settled[x.from + '_' + x.to]);
  sameNets(DO.state, DA.state);
  console.log('VERSION/MERGE TESTS PASSED (field merge, server-wins notice, own-family confirmation, void on payer change, settle marks)');

  // 5) shared recipes + meal plan
  const bolo2 = 'Bolo dois\nRende 4 porções\nIngredientes\n200 g de açúcar\nModo de preparo\nMisturar';
  await DA.edit(st => { st.recipes.push({ id: 'r2', ...L.parseRecipe(bolo2), text: bolo2 }); st.plan[D2] = { almoco: { mode: 'casa', recipes: ['r2'] } }; });
  assert(DO.state.recipes.find(r => r.id === 'r2'), 'recipe propagates'); assert.deepStrictEqual(DO.state.plan[D2].almoco.recipes, ['r2']);
  assert.strictEqual(shop(DO.state), shop(DA.state), 'shopping list recomputed equally on both');
  DA.client.online = false;
  await DA.edit(st => { st.recipes.find(r => r.id === 'r2').title = 'Bolo da Ana'; });
  await DO.edit(st => { st.recipes.find(r => r.id === 'r2').yield = 6; st.plan[D2].almoco.mode = 'fora'; });
  DA.client.online = true; await DA.sync.resync(); await settle3(DA, DO);
  for (const d of [DA, DO]) { const r = d.state.recipes.find(r => r.id === 'r2'); assert.strictEqual(r.title, 'Bolo da Ana'); assert.strictEqual(r.yield, 6); assert.strictEqual(d.state.plan[D2].almoco.mode, 'fora'); }
  assert.strictEqual(shop(DO.state), shop(DA.state));
  await DO.edit(st => { st.recipes = st.recipes.filter(r => r.id !== 'r2'); delete st.plan[D2]; });
  assert(!DA.state.recipes.find(r => r.id === 'r2') && !(DA.state.plan[D2] && DA.state.plan[D2].almoco), 'recipe + cell soft-deleted everywhere');
  assert(core.db.recipes.find(r => r.id === 'r2').deleted_at, 'soft delete on server');
  console.log('RECIPES/PLAN TESTS PASSED (shared, versioned, field merge, delete, shopping list from shared data)');

  // 6) three phones: interleaved edits, reconnect delta, idempotent replays
  core.rpc(B, 'join_event', { p_code: 'ABCD2345', p_display_name: 'Bia' }); core.rpc(O, 'approve_member', { p_event: ev, p_user: B.id });
  core.rpc(O, 'set_member_family', { p_event: ev, p_user: B.id, p_family: 'fb' });
  const DB = device(core, B, ev); await DB.start(); sameNets(DB.state, DO.state);
  const phones = [DO, DA, DB];
  for (let round = 0; round < 6; round++) {
    const off = phones[round % 3]; off.client.online = false;
    for (const [i, d] of phones.entries()) await d.edit(st => {
      st.expenses.unshift({ id: `p${round}_${i}`, amount: 10 + round + i, category: 'food', description: `R${round} by ${i}`, payerId: ['a1', 'b1', 'c1'][i], proof: 'nf', ts: 100 + round * 3 + i });
      const e1 = st.expenses.find(e => e.id === 'e1'); if (i === 0) e1.amount = 300 + round; if (i === 1) e1.note = 'nota ' + round; if (i === 2) e1.items = 'itens ' + round;
    });
    off.client.online = true; await off.sync.resync(); await settle3(...phones);
  }
  const ids = d => d.state.expenses.map(e => e.id).sort().join();
  assert.strictEqual(ids(DA), ids(DO)); assert.strictEqual(ids(DB), ids(DO)); assert.strictEqual(DO.state.expenses.filter(e => /^p\d_\d$/.test(e.id)).length, 18, 'all 18 interleaved inserts kept');
  sameNets(DO.state, DA.state); sameNets(DO.state, DB.state);
  const srv = core.db.expenses.find(e => e.id === 'e1'); for (const d of phones) { const e1 = d.state.expenses.find(e => e.id === 'e1'); assert.strictEqual(e1.amount, Number(srv.amount)); assert.strictEqual(e1.note, srv.note); assert.strictEqual(e1.items, srv.items); }
  for (const d of phones) assert.strictEqual(d.sync.pendingCount(), 0, 'nothing left pending');
  console.log('  ✓ 3 aparelhos, 6 rodadas intercaladas com um offline por vez: todos convergem');
  // reconnect delta: only rows changed since the cursor are fetched
  DB.client.online = false; core.advance(60000); // a minute later
  await DO.edit(st => { st.expenses.find(e => e.id === 'e3').description = 'Gasolina posto'; });
  DB.client.online = true; core.db.calls.length = 0; await DB.sync.resync(); await tick();
  const dcalls = core.db.calls.filter(c => c.user === B.id);
  assert(dcalls.length && dcalls.every(c => c.gte), 'reconnect uses delta (gte updated_at) ' + JSON.stringify(dcalls)); assert(DB.sync.lastDelta().rows <= 8, 'delta fetched only the changed rows: ' + JSON.stringify(DB.sync.lastDelta()) + ' ' + core.db.expenses.map(e => e.updated_at).sort().slice(-3));
  assert.strictEqual(DB.state.expenses.find(e => e.id === 'e3').description, 'Gasolina posto'); sameNets(DB.state, DO.state);
  // idempotent replay: server applies, reply is lost twice, client retries with the same op_ids
  DB.client.dropReplies = 2;
  await DB.edit(st => { st.expenses.unshift({ id: 'rp1', amount: 7, category: 'food', description: 'Replay', payerId: 'b1', proof: 'nf', ts: 999 }); st.expenses.find(e => e.id === 'e4').amount = 46; });
  assert.strictEqual(core.db.expenses.filter(e => e.id === 'rp1').length, 1); assert.strictEqual(DB.sync.status(), 'offline');
  const opsN = core.db.ops.size; await DB.T.run(); await tick(); await DB.T.run(); await tick();
  assert.strictEqual(core.db.ops.size, opsN, 'replays did not create new ops'); assert.strictEqual(core.db.expenses.filter(e => e.id === 'rp1').length, 1, 'no duplicate row');
  assert.strictEqual(core.db.expenses.find(e => e.id === 'e4').amount, '46.00'); assert.strictEqual(core.db.expenses.find(e => e.id === 'e4').version, 2, 'update applied once (v2)');
  assert.strictEqual(DB.sync.status(), 'synced'); assert.strictEqual(DB.sync.pendingCount(), 0); await settle3(...phones); sameNets(DO.state, DB.state);
  console.log('CONCURRENCY/OFFLINE TESTS PASSED (3 phones interleaved, reconnect delta, idempotent replay after lost replies)');

  // 7) offline reload with saved base
  DA.client.online = false;
  await DA.edit(st => st.expenses.unshift({ id: 'e6', amount: 33.33, category: 'food', description: 'Açaí', payerId: 'a1', ts: 10 }));
  assert.strictEqual(DA.sync.status(), 'offline'); assert(DA.sync.pendingCount() >= 1);
  await DO.edit(st => { st.expenses = st.expenses.filter(e => e.id !== 'e2'); });
  DA.sync.stop(); const cached = clone(DA.state), saved = clone(DA.savedBase);
  const DA2 = device(core, A, ev, cached, saved); assert.strictEqual(DA2.sync.role(), 'member', 'last role restored offline');
  await DA2.start();
  assert(!DA2.state.expenses.find(e => e.id === 'e2'), 'remote delete respected'); assert(DO.state.expenses.find(e => e.id === 'e6'), 'offline edit delivered after reload');
  console.log('OFFLINE RELOAD TESTS PASSED');

  // 8) photos (bucket "comprovantes"): queue offline, upload, 5-min signed URL, organizer replace/delete
  const mem = () => { const m = new Map(); return { m, put: async it => { m.set(it.path, it); }, all: async () => [...m.values()], del: async p => { m.delete(p); } }; };
  const blob = (n, tag = 'x') => ({ size: n, data: tag });
  const upl = [], errs = [];
  const QA = L.createPhotoQueue({ storage: DA2.client.storage.from('comprovantes'), eventId: ev, store: mem(), isOrganizer: () => DA2.sync.role() === 'organizer',
    onUploaded: (id, p) => upl.push([id, p]), onError: (id, e) => errs.push([id, e]) });
  DA2.client.online = false;
  assert.strictEqual(await QA.enqueue('e6', blob(90000)), 'offline'); assert.deepStrictEqual(await QA.pending(), ['e6'], 'kept in queue offline');
  DA2.client.online = true; assert.strictEqual(await QA.process(), 'done');
  assert.deepStrictEqual(upl.pop(), ['e6', `${ev}/e6.jpg`]); assert(core.db.storage[`${ev}/e6.jpg`]); assert.deepStrictEqual(await QA.pending(), []);
  const u1 = await QA.url(`${ev}/e6.jpg`); assert(/exp=/.test(u1)); assert.strictEqual(L.PHOTO_URL_TTL, 300, 'signed URL lasts at most 5 min');
  assert(!/getPublicUrl/.test(html), 'never public URLs');
  await QA.enqueue('e6', blob(50000)); assert.deepStrictEqual(errs.pop(), ['e6', 'exists'], 'member cannot replace');
  await assert.rejects(QA.remove(`${ev}/e6.jpg`), e => e.code === '42501');
  await QA.enqueue('e1', blob(200000)); assert.deepStrictEqual(errs.pop(), ['e1', 'too_big']);
  const QO = L.createPhotoQueue({ storage: DO.client.storage.from('comprovantes'), eventId: ev, store: mem(), isOrganizer: () => true, onUploaded: (id, p) => upl.push([id, p]), onError: (id, e) => errs.push([id, e]) });
  await QO.enqueue('e6', blob(60000, 'novo')); assert.strictEqual(core.db.storage[`${ev}/e6.jpg`].data, 'novo', 'organizer replaces');
  assert.strictEqual(await QO.remove(`${ev}/e6.jpg`), true); assert(!core.db.storage[`${ev}/e6.jpg`], 'organizer deletes');
  const QX = L.createPhotoQueue({ storage: client(core, X).storage.from('comprovantes'), eventId: ev, store: mem(), isOrganizer: () => false, onError: (id, e) => errs.push([id, e]) });
  await QX.enqueue('e1', blob(1000)); assert.deepStrictEqual(errs.pop(), ['e1', 'denied'], 'outsider cannot upload');
  // lost reply on upload: retry gets 409 -> treated as uploaded
  const st = mem(); const flaky = { n: 0, upload: async (p, b, o) => { const r = await DA2.client.storage.from('comprovantes').upload(p, b, o); if (flaky.n++ === 0) throw new TypeError('Failed to fetch'); return r; } };
  const QF = L.createPhotoQueue({ storage: flaky, eventId: ev, store: st, isOrganizer: () => false, onUploaded: (id, p) => upl.push([id, p]), onError: (id, e) => errs.push([id, e]) });
  assert.strictEqual(await QF.enqueue('e3', blob(1000)), 'offline'); assert.strictEqual(await QF.process(), 'done'); assert.deepStrictEqual(upl.pop(), ['e3', `${ev}/e3.jpg`]);
  // retention: organizer purges the event's photos; other events untouched; member/outsider refused
  const ev2 = core.rpc(O, 'create_event', { p_name: 'Outro', p_code: 'MNPQ3456', p_display_name: 'Org' }).data;
  core.db.storage[`${ev2}/k1.jpg`] = { size: 10, contentType: 'image/jpeg', data: 'z' };
  await QA.enqueue('e1', blob(1000)); await QA.enqueue('e4', blob(1000)); // DA2 is a member (not organizer): uploads allowed
  await DA2.edit(st => { st.expenses.find(e => e.id === 'e1').photoPath = `${ev}/e1.jpg`; });
  assert(core.db.storage[`${ev}/e1.jpg`] && core.db.storage[`${ev}/e4.jpg`]);
  await assert.rejects(L.purgeEventPhotos(DA2.client, ev), e => /organizer_only/.test(e.message), 'member cannot purge');
  await assert.rejects(L.purgeEventPhotos(client(core, X), ev), e => /organizer_only/.test(e.message), 'outsider cannot purge');
  const pr = await L.purgeEventPhotos(DO.client, ev);
  assert.strictEqual(pr.remaining, 0); assert(pr.found >= 2 && pr.removed === pr.found); assert(pr.clearedRefs >= 1);
  assert(!Object.keys(core.db.storage).some(p => p.startsWith(ev + '/')), 'no photos left for the event'); assert(core.db.storage[`${ev2}/k1.jpg`], 'other event untouched');
  await tick(); assert(!DA2.state.expenses.some(e => e.photoPath), 'photo refs cleared on every device');
  assert.strictEqual(L.photoPurgeBy('2031-03-05'), '2031-04-04');
  console.log('PHOTO TESTS PASSED (offline queue, upload, 5-min signed URL, member no replace/delete, organizer replace/delete, size, outsider, lost reply, 30-day purge: organizer only, other event untouched)');

  // 9) lock, revoke, rotate
  core.rpc(O, 'lock_event', { p_event: ev, p_locked: true }); await tick();
  assert.strictEqual(DA2.state.eventLocked, true);
  await DA2.edit(st => { st.expenses.find(e => e.id === 'e1').description = 'travado'; });
  assert.notStrictEqual(DA2.state.expenses.find(e => e.id === 'e1').description, 'travado', 'locked: local edit reverted'); assert(DA2.notices.some(n => n.kind === 'locked'));
  core.rpc(O, 'lock_event', { p_event: ev, p_locked: false }); await tick();
  await DA2.edit(st => { st.expenses.find(e => e.id === 'e1').description = 'destravado'; }); assert.strictEqual(DO.state.expenses.find(e => e.id === 'e1').description, 'destravado', 'unlocked: writes again');
  core.rpc(O, 'revoke_member', { p_event: ev, p_user: A.id }); await tick();
  assert(DA2.members.some(m => m.user_id === A.id && m.status === 'revoked'), 'revoked device is told live');
  await DA2.edit(st => { st.expenses.find(e => e.id === 'e1').description = 'revogado'; }); assert.strictEqual(DO.state.expenses.find(e => e.id === 'e1').description, 'destravado');
  assert.strictEqual(core.rpc(A, 'join_event', { p_code: 'ABCD2345', p_display_name: 'Ana' }).data.error, 'revoked');
  assert(!('event_name' in core.rpc(A, 'my_membership', { p_event: ev }).data), 'revoked: no event name');
  assert.strictEqual(core.rpc(O, 'rotate_code', { p_event: ev, p_new_code: 'WXYZ6789', p_repend: true }).data, 2);
  assert.strictEqual(core.rpc(B, 'my_membership', { p_event: ev }).data.status, 'pending');
  assert.strictEqual(core.rpc(X, 'join_event', { p_code: 'ABCD2345', p_display_name: 'X' }).data.error, 'invalid_code');
  assert.strictEqual(core.rpc(B, 'approve_member', { p_event: ev, p_user: B.id }).error.message, 'organizer_only');
  console.log('ACCESS TESTS PASSED (lock read-only, unlock, revoke live, revoked cannot rejoin, rotate + re-pending, organizer-only)');

  // 10) codes + import check + no real trip dates
  for (let i = 0; i < 200; i++) { const c = L.genEventCode(); assert(L.validCode(c), c); assert(!/[01OIL]/.test(c)); }
  const ic = L.importCheck(sample()); assert(ic.ok, ic.errs.join(';')); assert(ic.maxDiff <= 0.01); assert.strictEqual(ic.before.total, 545.65);
  const bad = sample(); bad.expenses[0].amount = -1; bad.families[1].id = 'fa'; assert(!L.importCheck(bad).ok); assert(!L.importCheck({ foo: 1 }).ok);
  console.log('CODE/IMPORT TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
