// Testes do modo compartilhado (Supabase) com um cliente falso que simula dois aparelhos, RLS e tempo real.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const src = html.split('// ===== LOGIC-START')[1].split('// ===== LOGIC-END')[0];
const L = new Function(src.replace(/^[^\n]*\n/, '') + '\nreturn {computeSplit,settle,stateToRows,rowsToState,diffRows,createSync,importCheck,genEventCode,validCode,normCode,CODE_ALPHABET,SYNC_PK};')();
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- fake Supabase ----------
const PK = { events: ['id'], ...L.SYNC_PK };
function fakeServer() {
  const db = { events: [], families: [], people: [], expenses: [], settlement_marks: [] }, members = new Set(), chans = [];
  const reorderJson = v => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map(k => [k, v[k]])) : v;
  const serverShape = (t, r) => { const o = { ...r, updated_at: new Date().toISOString() };
    for (const k of ['amount', 'kitty_per_family']) if (o[k] != null) o[k] = Number(o[k]).toFixed(2); // numeric as text
    for (const k of ['meals', 'weights']) if (o[k]) o[k] = reorderJson(o[k]); return o; };
  const broadcast = (t, row) => chans.forEach(c => c.handlers.forEach(h => {
    if (h.table !== t || !c.client.online || !members.has(row.event_id || row.id) || !c.client.isMember(row.event_id || row.id)) return;
    const [col, v] = h.filter.split('=eq.'); if (String(row[col]) === v) h.cb({ new: clone(row) });
  }));
  function client(userId) {
    const c = { online: true, userId, isMember: e => members.has(e + '|' + userId) };
    const net = () => { const e = new Error('TypeError: Failed to fetch'); return { data: null, error: e }; };
    const visible = (t, r) => c.isMember(t === 'events' ? r.id : r.event_id);
    c.from = t => ({
      select: () => ({ eq: async (col, v) => c.online ? { data: clone(db[t].filter(r => String(r[col]) === String(v) && visible(t, r))), error: null } : net() }),
      update: patch => ({ eq: async (col, v) => { if (!c.online) return net();
        db[t].forEach((r, i) => { if (String(r[col]) === String(v) && visible(t, r)) { db[t][i] = serverShape(t, { ...r, ...patch }); broadcast(t, db[t][i]); } }); return { error: null }; } }),
      upsert: async (rows, opt) => { if (!c.online) return net();
        assert.strictEqual(opt.onConflict, PK[t].join(','));
        for (const r of rows) {
          if (!c.isMember(r.event_id)) return { error: { message: 'new row violates row-level security policy', code: '42501' } };
          assert(!('photo' in r) && !('diet' in r), 'no local-only fields');
          const k = PK[t].map(x => r[x]).join('|'), i = db[t].findIndex(x => PK[t].map(y => x[y]).join('|') === k);
          const row = serverShape(t, { ...(i >= 0 ? db[t][i] : {}), ...r, created_by: i >= 0 ? db[t][i].created_by : userId });
          if (i >= 0) db[t][i] = row; else db[t].push(row); broadcast(t, row);
        }
        return { error: null }; },
    });
    c.channel = () => { const ch = { client: c, handlers: [], on(_, f, cb) { this.handlers.push({ table: f.table, filter: f.filter, cb }); return this; }, subscribe(cb) { chans.push(this); cb && cb('SUBSCRIBED'); return this; } }; return ch; };
    c.removeChannel = ch => { const i = chans.indexOf(ch); if (i >= 0) chans.splice(i, 1); };
    return c;
  }
  const createEvent = (id, name, owner) => { db.events.push(serverShape('events', { id, name, created_by: owner, start_date: null, end_date: null, meals: { cafe: true, almoco: true, lanche: false, jantar: true }, split_mode: 'pessoa', include_unconfirmed: true, kitty_per_family: 0, weights: {} })); members.add(id); members.add(id + '|' + owner); };
  const join = (id, user) => members.add(id + '|' + user);
  return { db, client, createEvent, join };
}
// manual timers so tests are deterministic
const tick = () => new Promise(r => setTimeout(r, 5));
const timers = () => { const q = []; return { set: (f) => { q.push(f); return q.length; }, clear: () => {}, run: async () => { for (const f of q.splice(0)) await f(); } }; };
function device(server, user, eventId, initial) {
  const dev = { state: initial || { families: [], expenses: [], settled: {} }, statuses: [], savedBase: null, T: timers() };
  dev.client = server.client(user);
  dev.sync = L.createSync({ client: dev.client, eventId, timers: dev.T, getState: () => dev.state, setState: s => { dev.state = s; },
    onStatus: s => dev.statuses.push(s), loadBase: () => dev.savedBase && clone(dev.savedBase), saveBase: b => { dev.savedBase = b; } });
  dev.edit = async fn => { fn(dev.state); dev.sync.schedule(); await dev.T.run(); await tick(); };
  return dev;
}

// ---------- sample (fictional) ----------
const sample = () => ({
  eventName: 'Teste', splitMode: 'porcoes', includeUnconfirmed: false, kittyPerFamily: 500, weights: { crianca: 0.6 },
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
const nets = s => Object.fromEntries(L.computeSplit(s).families.map(f => [f.id, f.net]));
const sameNets = (a, b) => { const x = nets(a), y = nets(b); assert.deepStrictEqual(Object.keys(x).sort(), Object.keys(y).sort()); for (const k in x) assert(near(x[k], y[k]), `net ${k}: ${x[k]} vs ${y[k]}`); };

(async () => {
  // 1) mapping never carries health data, photos, recipes or plan
  const rows = L.stateToRows(sample(), 'ev1', 'Teste'), dump = JSON.stringify(rows);
  for (const bad of ['amendoim', 'veg', 'diet', 'alergia', 'data:image', 'photo', 'Bolo', 'recipes', 'plan', 'carne": 70']) assert(!dump.includes(bad), 'leak: ' + bad);
  assert.strictEqual(rows.people.length, 5); assert.strictEqual(rows.expenses.length, 4); assert.strictEqual(rows.settlement_marks.length, 1);
  assert.deepStrictEqual([rows.settlement_marks[0].from_family, rows.settlement_marks[0].to_family], ['fa', 'f_c'], 'settle key with "_" in id');
  assert(Object.keys(rows.people[0]).every(k => !/diet|cpf|pix|card|bank|conta/i.test(k)));

  // 2) round trip keeps balances and local-only overlay
  const sh = { ...sample(), syncMode: true }, back = L.rowsToState(L.stateToRows(sh, 'ev1', 'Teste'), sh);
  sameNets(sh, back);
  assert.strictEqual(back.families[0].members[1].diet.alergia, 'amendoim', 'diet kept locally');
  assert.strictEqual(back.expenses.find(e => e.id === 'e1').photo.slice(0, 10), 'data:image', 'photo kept locally');
  assert.strictEqual(back.recipes.length, 1); assert(back.plan['2026-10-10']);
  assert.strictEqual(back.expenses.find(e => e.id === 'e2').confirmedAt, 1760000000000);
  assert.strictEqual(back.families[1].arriveMeal, 'jantar'); assert.strictEqual(back.families[1].members[1].departMeal, 'almoco');
  // shared split ignores the local meal grid (same result on every device)
  sameNets({ ...sh, plan: {} }, sh);
  const fresh = L.rowsToState(L.stateToRows(sh, 'ev1', 'Teste'), null); sameNets(sh, fresh);
  assert(!fresh.families[0].members[1].diet, 'another device never sees diet');
  // unknown category/type from another device never crashes the UI; orphan people are never auto-deleted
  const odd = L.rowsToState({ events: {}, families: [{ id: 'f1', name: 'F', pos: 0 }], people: [{ id: 'p1', family_id: 'f1', first_name: 'X', type: 'alien', pos: 0 }, { id: 'p2', family_id: 'gone', first_name: 'Y', pos: 0 }],
    expenses: [{ id: 'x', amount: '10.00', category: 'zzz', proof: 'qq' }], settlement_marks: [] }, null);
  assert.strictEqual(odd.expenses[0].category, 'food'); assert.strictEqual(odd.expenses[0].proof, 'nf'); assert.strictEqual(odd.families[0].members[0].type, 'adulto');
  const ob = { events: null, families: {}, people: { 'ev|p2': { event_id: 'ev', id: 'p2', family_id: 'gone' } }, expenses: {}, settlement_marks: {} };
  assert(!(L.diffRows(ob, L.stateToRows(odd, 'ev', 'n')).upserts.people || []).some(r => r.id === 'p2' && r.deleted_at), 'orphan not deleted');
  console.log('MAPPING TESTS PASSED (no health/photo/recipe leak, round trip, local overlay, settle keys)');

  // 3) two devices on the same event
  const S = fakeServer(); S.createEvent('ev1', 'Teste', 'uA'); S.join('ev1', 'uB');
  const A = device(S, 'uA', 'ev1'), B = device(S, 'uB', 'ev1');
  await A.sync.load(); A.sync.subscribe(); await tick(); await A.T.run();
  await B.sync.load(); B.sync.subscribe(); await tick(); await B.T.run();
  // import into the empty event (A, the creator)
  await A.edit(st => { Object.assign(st, L.rowsToState(L.stateToRows({ ...sample(), syncMode: true }, 'ev1', 'Teste'), { ...sample(), syncMode: true })); });
  assert.strictEqual(A.sync.status(), 'synced'); assert.strictEqual(A.sync.pendingCount(), 0, 'no perpetual dirty rows (numeric/jsonb echo)');
  assert.strictEqual(B.state.families.length, 3); assert.strictEqual(B.state.expenses.length, 4);
  sameNets(A.state, B.state);
  assert.deepStrictEqual(L.settle(L.computeSplit(A.state).families), L.settle(L.computeSplit(B.state).families));
  assert(!B.state.expenses.find(e => e.id === 'e1').photo, 'photo not synced'); assert(!B.state.families[0].members[1].diet, 'diet not synced');
  assert.strictEqual(B.state.splitMode, 'porcoes'); assert.strictEqual(B.state.kittyPerFamily, 500); assert.strictEqual(B.state.weights.crianca, 0.6);
  assert.strictEqual(B.state.trip.end, '2026-10-12'); assert.strictEqual(B.state.includeUnconfirmed, false);
  // B adds an expense -> A sees it live
  await B.edit(st => st.expenses.unshift({ id: 'e5', amount: 50, category: 'food', description: 'Pão', payerId: 'b2', proof: 'none', ts: 9 }));
  assert(A.state.expenses.find(e => e.id === 'e5'), 'A got B expense'); sameNets(A.state, B.state);
  assert(A.state.expenses.find(e => e.id === 'e1').photo, 'A keeps own photo after remote rebuild');
  // A confirms B's sem-nota expense; A marks a transfer paid; then unmarks
  await A.edit(st => { const e = st.expenses.find(e => e.id === 'e5'); e.confirmedBy = 'fa'; e.confirmedAt = Date.now(); });
  assert.strictEqual(B.state.expenses.find(e => e.id === 'e5').confirmedBy, 'fa');
  const x = L.settle(L.computeSplit(A.state).families)[0];
  await A.edit(st => { st.settled[x.from + '_' + x.to] = { amount: x.amount, at: Date.now() }; });
  assert(B.state.settled[x.from + '_' + x.to] && near(B.state.settled[x.from + '_' + x.to].amount, x.amount));
  await A.edit(st => { delete st.settled[x.from + '_' + x.to]; });
  assert(!B.state.settled[x.from + '_' + x.to], 'unmark propagates');
  // B deletes an expense -> soft delete on server, gone on A
  await B.edit(st => { st.expenses = st.expenses.filter(e => e.id !== 'e4'); });
  assert(!A.state.expenses.find(e => e.id === 'e4')); assert(S.db.expenses.find(e => e.id === 'e4').deleted_at, 'soft delete');
  // B edits a member and the event settings
  await B.edit(st => { st.families[2].members.push({ id: 'c2', name: 'Cora', type: 'crianca' }); st.splitMode = 'pessoa'; st.kittyPerFamily = 650; });
  assert.strictEqual(A.state.families[2].members.length, 2); assert.strictEqual(A.state.splitMode, 'pessoa'); assert.strictEqual(A.state.kittyPerFamily, 650);
  sameNets(A.state, B.state);
  console.log('TWO-DEVICE TESTS PASSED (import, live add, confirm, settle mark/unmark, soft delete, members, settings)');

  // 4) offline: edits stay pending, then flush when back
  A.client.online = false;
  await A.edit(st => st.expenses.unshift({ id: 'e6', amount: 33.33, category: 'food', description: 'Açaí', payerId: 'a1', ts: 10 }));
  assert.strictEqual(A.sync.status(), 'offline'); assert(A.sync.pendingCount() >= 1); assert(!B.state.expenses.find(e => e.id === 'e6'));
  A.client.online = true; await A.T.run();
  assert.strictEqual(A.sync.status(), 'synced'); assert(B.state.expenses.find(e => e.id === 'e6'), 'pending edit delivered');
  // 5) reload after offline edit while the other device deleted something: local edit kept, remote delete respected
  A.client.online = false;
  await A.edit(st => { st.expenses.find(e => e.id === 'e3').amount = 99; });
  await B.edit(st => { st.expenses = st.expenses.filter(e => e.id !== 'e2'); });
  A.sync.stop(); const cached = clone(A.state), savedBase = clone(A.savedBase);
  const A2 = device(S, 'uA', 'ev1', cached); A2.savedBase = savedBase;
  await A2.sync.load(); assert(!A2.state.expenses.find(e => e.id === 'e2'), 'remote delete not resurrected');
  assert.strictEqual(A2.state.expenses.find(e => e.id === 'e3').amount, 99); assert.strictEqual(A2.sync.pendingCount(), 1);
  A2.sync.subscribe(); await tick(); await A2.T.run(); await A2.sync.flush();
  assert.strictEqual(B.state.expenses.find(e => e.id === 'e3').amount, 99); sameNets(A2.state, B.state);
  // 6) same row edited on both: last write wins, both converge
  await A2.edit(st => { st.expenses.find(e => e.id === 'e1').description = 'Mercado A'; });
  await B.edit(st => { st.expenses.find(e => e.id === 'e1').description = 'Mercado B'; });
  assert.strictEqual(A2.state.expenses.find(e => e.id === 'e1').description, 'Mercado B'); assert.strictEqual(B.state.expenses.find(e => e.id === 'e1').description, 'Mercado B');
  console.log('OFFLINE/CONFLICT TESTS PASSED (pending + retry, reload with saved base, last write wins)');

  // 7) non-member sees nothing and cannot write
  const Cx = device(S, 'uC', 'ev1');
  await assert.rejects(Cx.sync.load(), e => e.code === 'not_member');
  Cx.state = clone(B.state); Cx.state.expenses.push({ id: 'hack', amount: 1, category: 'food', payerId: 'a1' }); Cx.sync.schedule(); await Cx.T.run();
  assert(!S.db.expenses.find(e => e.id === 'hack')); assert(['error', 'offline'].includes(Cx.sync.status()));
  // 8) codes and import check
  for (let i = 0; i < 200; i++) { const c = L.genEventCode(); assert(L.validCode(c), c); assert(!/[01OIL]/.test(c)); }
  assert.strictEqual(L.normCode(' abcd-2345 '), 'ABCD2345');
  const ic = L.importCheck(sample()); assert(ic.ok, ic.errs.join(';')); assert(ic.maxDiff <= 0.01); assert.strictEqual(ic.before.total, 545.65);
  const bad = sample(); bad.expenses[0].amount = -1; bad.families[1].id = 'fa'; const ib = L.importCheck(bad); assert(!ib.ok && ib.errs.length >= 2);
  assert(!L.importCheck({ foo: 1 }).ok);
  console.log('ACCESS/CODE/IMPORT TESTS PASSED (non-member blocked, 8-char codes, import validation R$ 0,01)');
})().catch(e => { console.error(e); process.exit(1); });
