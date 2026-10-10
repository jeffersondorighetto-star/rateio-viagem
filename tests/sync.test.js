// Modo compartilhado (design completo) com servidor falso em memória (tests/fake-core.js) e vários aparelhos.
const fs = require('fs'), assert = require('assert');
const { createCore } = require('./fake-core');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const src = html.split('// ===== LOGIC-START')[1].split('// ===== LOGIC-END')[0];
const L = new Function(src.replace(/^[^\n]*\n/, '') + '\nreturn {computeSplit,settle,stateToRows,rowsToState,computeEdits,mergeBase,createSync,importCheck,genEventCode,validCode,normCode};')();
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;
const clone = o => JSON.parse(JSON.stringify(o));
const tick = () => new Promise(r => setTimeout(r, 5));

// ---------- fake supabase client over the core ----------
function client(core, user) {
  const c = { online: true, user };
  const net = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });
  c.from = t => ({ select: () => ({ eq: async (col, v) => c.online ? core.select(user, t, col, v) : net() }) });
  c.rpc = async (fn, a) => c.online ? core.rpc(user, fn, clone(a)) : net();
  c.channel = () => { const ch = { hs: [], on(_, f, cb) { this.hs.push({ f, cb }); return this; },
    subscribe(cb) { this.off = core.listen(user.id, (t, row) => setTimeout(() => { if (!c.online) return; this.hs.forEach(h => { if (h.f.table !== t) return; const [col, v] = h.f.filter.split('=eq.'); if (String(row[col]) === v) h.cb({ new: row }); }); }, 0)); setTimeout(() => cb && cb('SUBSCRIBED'), 0); return this; } }; return ch; };
  c.removeChannel = ch => ch.off && ch.off();
  return c;
}
const timers = () => { const q = []; return { set: f => { q.push(f); return q.length; }, clear: () => {}, run: async () => { for (const f of q.splice(0)) await f(); } }; };
function device(core, user, eventId, initial) {
  const d = { state: initial || { families: [], expenses: [], settled: {} }, statuses: [], notices: [], members: [], savedBase: null, T: timers() };
  d.client = client(core, user);
  d.sync = L.createSync({ client: d.client, eventId, timers: d.T, getState: () => d.state, setState: s => { d.state = s; },
    onStatus: s => d.statuses.push(s), onNotice: n => d.notices.push(...n), onMembership: m => d.members.push(m),
    loadBase: () => d.savedBase && clone(d.savedBase), saveBase: b => { d.savedBase = b; } });
  d.sync.setUser(user.id);
  d.edit = async fn => { fn(d.state); d.sync.schedule(); await d.T.run(); await tick(); };
  d.start = async () => { await d.sync.load(); d.sync.subscribe(); await tick(); await d.T.run(); await tick(); };
  return d;
}
const sample = () => ({
  splitMode: 'porcoes', includeUnconfirmed: false, kittyPerFamily: 500, weights: { crianca: 0.6 },
  trip: { start: '2026-10-10', end: '2026-10-12', meals: { cafe: true, almoco: true, lanche: false, jantar: true } },
  plan: { '2026-10-10': { almoco: { mode: 'fora' } } }, recipes: [{ id: 'r1', text: 'Bolo\nRende 8', title: 'Bolo' }], prices: { carne: 70 }, planQty: {},
  families: [
    { id: 'fa', name: 'Família A', members: [{ id: 'a1', name: 'Ana', drinks: true }, { id: 'a2', name: 'Lia', type: 'crianca', diet: { alergia: 'amendoim' } }] },
    { id: 'fb', name: 'Família B', arrive: '2026-10-11', arriveMeal: 'jantar', members: [{ id: 'b1', name: 'Beto', drinks: true, diet: { veg: true } }, { id: 'b2', name: 'Bia', depart: '2026-10-11', departMeal: 'almoco' }] },
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
const O = { id: 'u-org', is_anonymous: false }, A = { id: 'u-a', is_anonymous: true }, B = { id: 'u-b', is_anonymous: true }, X = { id: 'u-x', is_anonymous: true };

(async () => {
  // 1) mapping
  const rows = L.stateToRows(sample(), 'ev1'), dump = JSON.stringify(rows);
  for (const bad of ['amendoim', 'veg', 'diet', 'alergia', 'data:image', 'photo', 'Bolo', 'recipes', 'plan', 'carne": 70']) assert(!dump.includes(bad), 'leak: ' + bad);
  assert.strictEqual(rows.people.length, 5); assert.strictEqual(rows.expenses.length, 4); assert.strictEqual(rows.settlement_marks.length, 1);
  assert.deepStrictEqual(rows.confirm, [{ expense_id: 'e2', family_id: 'fa' }]); assert.deepStrictEqual(rows.event_overrides.map(o => [o.kind, o.key, o.value]), [['weight', 'crianca', 0.6]]);
  assert.deepStrictEqual([rows.settlement_marks[0].from_family, rows.settlement_marks[0].to_family], ['fa', 'f_c']);
  const sh = { ...sample(), syncMode: true }, back = L.rowsToState(asRows(sh, 'ev1'), sh);
  sameNets(sh, back); assert.strictEqual(back.families[0].members[1].diet.alergia, 'amendoim'); assert(back.expenses.find(e => e.id === 'e1').photo);
  assert.strictEqual(back.expenses.find(e => e.id === 'e2').confirmedBy, 'fa'); assert.strictEqual(back.weights.crianca, 0.6);
  const fresh = L.rowsToState(asRows(sh, 'ev1'), null); sameNets(sh, fresh); assert(!fresh.families[0].members[1].diet);
  const odd = L.rowsToState({ events: {}, families: [{ id: 'f1', name: 'F', pos: 0 }], people: [{ id: 'p1', family_id: 'f1', first_name: 'X', type: 'alien', pos: 0 }],
    expenses: [{ id: 'x', amount: '10.00', category: 'zzz', proof: 'qq' }] }, null);
  assert.strictEqual(odd.expenses[0].category, 'food'); assert.strictEqual(odd.expenses[0].proof, 'nf'); assert.strictEqual(odd.families[0].members[0].type, 'adulto');
  // field-level edits
  const b0 = { events: rows.events, versions: {}, confirmations: {}, families: {}, people: {}, expenses: {}, settlement_marks: {}, event_overrides: {} };
  rows.expenses.forEach(r => { b0.expenses['ev1|' + r.id] = r; });
  const st2 = clone(sample()); st2.expenses[0].amount = 999; st2.expenses.pop();
  const ed = L.computeEdits(b0, L.stateToRows(st2, 'ev1'));
  assert.deepStrictEqual(ed.rows.expenses.find(e => e.key === 'ev1|e1').patch, { amount: 999 }, 'only the changed field');
  assert(ed.rows.expenses.find(e => e.key === 'ev1|e4').patch.deleted_at, 'removed row -> soft delete');
  console.log('MAPPING TESTS PASSED (no health/photo/recipe leak, round trip, overlay, field patches, confirmations, weights)');

  // 2) approval flow
  const core = createCore();
  const ev = core.rpc(O, 'create_event', { p_name: 'Teste', p_code: 'ABCD2345', p_display_name: 'Jeff' }).data;
  assert.strictEqual(core.rpc(A, 'create_event', { p_name: 'x', p_code: 'BBBB2345', p_display_name: 'a' }).error.message, 'organizer_login_required');
  const DO = device(core, O, ev); await DO.start(); assert.strictEqual(DO.sync.status(), 'synced');
  assert.strictEqual(core.rpc(A, 'join_event', { p_code: 'abcd2345', p_display_name: 'Ana' }).data.status, 'pending');
  const DA = device(core, A, ev);
  await assert.rejects(DA.sync.load(), e => e.code === 'pending'); console.log('  ✓ pendente não carrega o evento');
  // organizer imports
  await DO.edit(st => Object.assign(st, L.rowsToState(asRows({ ...sample(), syncMode: true }, ev), { ...sample(), syncMode: true })));
  assert.strictEqual(DO.sync.status(), 'synced', DO.statuses.slice(-3).join()); assert.strictEqual(DO.sync.pendingCount(), 0, 'no dirty rows after echo');
  assert.strictEqual(core.db.expenses.length, 4); assert.strictEqual(core.db.expense_confirmations.length, 1); assert.strictEqual(core.db.event_overrides.length, 1);
  core.rpc(O, 'approve_member', { p_event: ev, p_user: A.id }); await tick();
  assert(DO.members.some(m => m.user_id === A.id && m.status === 'approved'), 'organizer sees member change live');
  await DA.start(); assert.strictEqual(DA.state.expenses.length, 4); sameNets(DA.state, DO.state);
  assert(!DA.state.expenses.find(e => e.id === 'e1').photo && !DA.state.families[0].members[1].diet); assert.strictEqual(DA.state.expenses.find(e => e.id === 'e2').confirmedBy, 'fa');
  assert.strictEqual(DA.state.weights.crianca, 0.6); assert.strictEqual(DA.state.eventName, 'Teste');
  console.log('APPROVAL TESTS PASSED (anon cannot create, pending blocked, approve -> loads same balances)');

  // 3) live edits + versions
  await DA.edit(st => st.expenses.unshift({ id: 'e5', amount: 50, category: 'food', description: 'Pão', payerId: 'b2', proof: 'none', ts: 9 }));
  assert(DO.state.expenses.find(e => e.id === 'e5')); sameNets(DO.state, DA.state);
  await DO.edit(st => { const e = st.expenses.find(e => e.id === 'e5'); e.confirmedBy = 'fa'; e.confirmedAt = Date.now(); });
  assert.strictEqual(DA.state.expenses.find(e => e.id === 'e5').confirmedBy, 'fa', 'confirmation propagates');
  await DA.edit(st => { const e = st.expenses.find(e => e.id === 'e5'); e.payerId = 'c1'; delete e.confirmedBy; });
  assert(!DO.state.expenses.find(e => e.id === 'e5').confirmedBy, 'payer change voids confirmation on every device');
  assert.strictEqual(core.db.expense_confirmations.filter(c => !c.voided_at).length, 1);
  // concurrent edits on different fields of the same expense: both kept
  DA.client.online = false;
  await DA.edit(st => { st.expenses.find(e => e.id === 'e1').description = 'Mercado grande'; });
  await DO.edit(st => { st.expenses.find(e => e.id === 'e1').amount = 310; });
  DA.client.online = true; await DA.sync.resync(); await tick(); await DO.T.run(); await tick();
  const e1a = DA.state.expenses.find(e => e.id === 'e1'), e1o = DO.state.expenses.find(e => e.id === 'e1');
  assert.strictEqual(e1a.description, 'Mercado grande'); assert.strictEqual(e1a.amount, 310); assert.strictEqual(e1o.description, 'Mercado grande'); assert.strictEqual(e1o.amount, 310);
  assert.strictEqual(DA.notices.filter(n => n.kind === 'conflict').length, 0, 'no notice when fields differ');
  console.log('  ✓ campos diferentes do mesmo gasto: as duas edições ficam');
  // same field: server wins + notice
  DA.client.online = false;
  await DA.edit(st => { st.expenses.find(e => e.id === 'e3').amount = 99; });
  await DO.edit(st => { st.expenses.find(e => e.id === 'e3').amount = 120; });
  DA.client.online = true; await DA.sync.resync(); await tick();
  assert.strictEqual(DA.state.expenses.find(e => e.id === 'e3').amount, 120, 'server wins on same field');
  assert.strictEqual(core.db.expenses.find(e => e.id === 'e3').amount, '120.00');
  assert(DA.notices.some(n => n.kind === 'conflict' && n.field === 'amount' && n.mine === 99 && n.theirs === 120), 'conflict notice');
  console.log('  ✓ mesmo campo: vale o servidor e aparece o aviso');
  // delete + settle + weights + settings
  await DA.edit(st => { st.expenses = st.expenses.filter(e => e.id !== 'e4'); st.weights.crianca = 0.7; st.kittyPerFamily = 650; });
  assert(!DO.state.expenses.find(e => e.id === 'e4')); assert.strictEqual(DO.state.weights.crianca, 0.7); assert.strictEqual(DO.state.kittyPerFamily, 650);
  const x = L.settle(L.computeSplit(DO.state).families)[0];
  await DO.edit(st => { st.settled[x.from + '_' + x.to] = { amount: x.amount, at: Date.now() }; });
  assert(DA.state.settled[x.from + '_' + x.to]); await DO.edit(st => { delete st.settled[x.from + '_' + x.to]; }); assert(!DA.state.settled[x.from + '_' + x.to]);
  sameNets(DO.state, DA.state);
  console.log('VERSION/MERGE TESTS PASSED (live, confirmation insert-only + void, field merge, server-wins notice, soft delete, overrides, settings)');

  // 4) offline + reload with saved base + idempotent retry
  DA.client.online = false;
  await DA.edit(st => st.expenses.unshift({ id: 'e6', amount: 33.33, category: 'food', description: 'Açaí', payerId: 'a1', ts: 10 }));
  assert.strictEqual(DA.sync.status(), 'offline'); assert(DA.sync.pendingCount() >= 1);
  await DO.edit(st => { st.expenses = st.expenses.filter(e => e.id !== 'e2'); });
  DA.sync.stop(); const cached = clone(DA.state), saved = clone(DA.savedBase);
  const DA2 = device(core, A, ev, cached); DA2.savedBase = saved; await DA2.start();
  assert(!DA2.state.expenses.find(e => e.id === 'e2'), 'remote delete respected'); assert(DO.state.expenses.find(e => e.id === 'e6'), 'offline edit delivered after reload');
  const opsBefore = core.db.ops.size;
  const replay = core.rpc(A, 'apply_ops', { p_event: ev, p_ops: [{ op_id: [...core.db.ops][0], table: 'expenses', row: { id: 'e1', amount: 1 }, expected_version: 1 }] }).data[0];
  assert.strictEqual(replay.status, 'dup'); assert.strictEqual(core.db.ops.size, opsBefore);
  console.log('OFFLINE TESTS PASSED (pending, reload keeps edit + respects remote delete, op_id dedupe)');

  // 5) lock, revoke, rotate
  core.rpc(O, 'lock_event', { p_event: ev, p_locked: true }); await tick();
  assert.strictEqual(DA2.state.eventLocked, true);
  await DA2.edit(st => { st.kittyPerFamily = 1; });
  assert.strictEqual(DA2.state.kittyPerFamily, 650, 'locked: local edit reverted'); assert(DA2.notices.some(n => n.kind === 'locked'));
  core.rpc(O, 'lock_event', { p_event: ev, p_locked: false }); await tick();
  await DA2.edit(st => { st.kittyPerFamily = 700; }); assert.strictEqual(DO.state.kittyPerFamily, 700, 'unlocked: writes again');
  core.rpc(O, 'revoke_member', { p_event: ev, p_user: A.id }); await tick();
  assert(DA2.members.some(m => m.user_id === A.id && m.status === 'revoked'), 'revoked device is told live');
  await DA2.edit(st => { st.kittyPerFamily = 5; }); assert.strictEqual(DO.state.kittyPerFamily, 700);
  assert.strictEqual(core.rpc(A, 'join_event', { p_code: 'ABCD2345', p_display_name: 'Ana' }).data.error, 'revoked');
  core.rpc(B, 'join_event', { p_code: 'ABCD2345', p_display_name: 'Bia' }); core.rpc(O, 'approve_member', { p_event: ev, p_user: B.id });
  assert.strictEqual(core.rpc(O, 'rotate_code', { p_event: ev, p_new_code: 'WXYZ6789', p_repend: true }).data, 2);
  assert.strictEqual(core.rpc(B, 'my_membership', { p_event: ev }).data.status, 'pending');
  assert.strictEqual(core.rpc(X, 'join_event', { p_code: 'ABCD2345', p_display_name: 'X' }).data.error, 'invalid_code');
  assert.strictEqual(core.rpc(B, 'approve_member', { p_event: ev, p_user: B.id }).error.message, 'organizer_only');
  console.log('ACCESS TESTS PASSED (lock read-only, unlock, revoke live, revoked cannot rejoin, rotate + re-pending, organizer-only)');

  // 6) codes + import check
  for (let i = 0; i < 200; i++) { const c = L.genEventCode(); assert(L.validCode(c), c); assert(!/[01OIL]/.test(c)); }
  const ic = L.importCheck(sample()); assert(ic.ok, ic.errs.join(';')); assert(ic.maxDiff <= 0.01); assert.strictEqual(ic.before.total, 545.65);
  const bad = sample(); bad.expenses[0].amount = -1; bad.families[1].id = 'fa'; assert(!L.importCheck(bad).ok); assert(!L.importCheck({ foo: 1 }).ok);
  console.log('CODE/IMPORT TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
