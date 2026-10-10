// supabase-js v2 (mesma versão do app) contra Postgres + PostgREST locais com o supabase.sql e RLS de verdade.
// Pré-requisito: PostgREST em http://localhost:54402 (ver README em supabase/test). Uso: NODE_PATH=<dir com @supabase/supabase-js> node postgrest.test.js
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const src = html.split('// ===== LOGIC-START')[1].split('// ===== LOGIC-END')[0];
const L = new Function(src.replace(/^[^\n]*\n/, '') + '\nreturn {computeSplit,stateToRows,rowsToState,createSync,genEventCode};')();
const SECRET = 'local-test-only-secret-not-used-anywhere-0123456789', URL = 'http://localhost:54402';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = claims => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims }); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url')}`; };
const strip = (u, o) => fetch(String(u).replace('/rest/v1', ''), o);
const user = (anon = true) => { const id = crypto.randomUUID(); return { id, sb: createClient(URL, jwt({ role: 'anon' }), { global: { fetch: strip, headers: { Authorization: 'Bearer ' + jwt({ role: 'authenticated', sub: id, is_anonymous: anon }) } }, auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: class { constructor() {} close() {} } } }) }; };
const timers = () => { const q = []; return { set: f => { q.push(f); return q.length; }, clear: () => {}, run: async () => { for (const f of q.splice(0)) await f(); } }; };
const dev = (u, eventId, st) => { const d = { state: st || { families: [], expenses: [], settled: {} }, T: timers(), notices: [] };
  d.sync = L.createSync({ client: u.sb, eventId, timers: d.T, getState: () => d.state, setState: s => { d.state = s; }, onNotice: n => d.notices.push(...n) }); d.sync.setUser(u.id);
  d.edit = async fn => { fn(d.state); d.sync.schedule(); await d.T.run(); }; return d; };
const nets = s => Object.fromEntries(L.computeSplit(s).families.map(f => [f.id, Math.round(f.net * 100) / 100]));
const ok = m => console.log('  ✓ ' + m);
(async () => {
  const O = user(false), A = user(), B = user(), C = user();
  const code = L.genEventCode();
  let r = await A.sb.rpc('create_event', { p_name: 'x', p_code: code, p_display_name: 'Ana' }); assert(r.error && /organizer_login_required/.test(r.error.message)); ok('anônimo não cria evento');
  r = await O.sb.rpc('create_event', { p_name: 'Teste REST', p_code: code, p_display_name: 'Jeff' }); assert.ifError(r.error); const ev = r.data;
  const sample = { splitMode: 'porcoes', includeUnconfirmed: true, kittyPerFamily: 300, weights: { crianca: 0.5 }, trip: { start: '2026-10-10', end: '2026-10-12', meals: { cafe: true, almoco: true, lanche: false, jantar: true } },
    families: [{ id: 'fa', name: 'Família A', members: [{ id: 'a1', name: 'Ana', drinks: true }, { id: 'a2', name: 'Lia', type: 'crianca', diet: { alergia: 'amendoim' } }] },
      { id: 'fb', name: 'Família B', arrive: '2026-10-11', arriveMeal: 'almoco', members: [{ id: 'b1', name: 'Beto', drinks: true }] }],
    expenses: [{ id: 'e1', amount: 250.35, category: 'groceries', description: 'Mercado', payerId: 'a1', items: 'carne', ts: 2, photo: 'data:image/jpeg;base64,AA' },
      { id: 'e2', amount: 90, category: 'alcohol', description: 'Cerveja', payerId: 'b1', proof: 'none', confirmedBy: 'fa', confirmedAt: Date.now(), ts: 1 }],
    settled: { fa_fb: { amount: 12.5, at: 1 } }, plan: {}, recipes: [] };
  const DO = dev(O, ev); await DO.sync.load();
  const sh = { ...sample, syncMode: true }, rows = L.stateToRows(sh, ev);
  await DO.edit(st => Object.assign(st, L.rowsToState({ ...rows, confirmations: rows.confirm.map(c => ({ ...c, id: c.expense_id })) }, sh)));
  assert.strictEqual(DO.sync.status(), 'synced', 'O synced: ' + DO.sync.status()); assert.strictEqual(DO.sync.pendingCount(), 0, 'nothing dirty after real echo');
  ok('organizador (GitHub) criou o evento e gravou tudo por apply_ops; eco real (numeric/jsonb/timestamptz) sem pendências');
  r = await B.sb.rpc('join_event', { p_code: 'AAAA2222', p_display_name: 'Beto' }); assert.strictEqual(r.data.error, 'invalid_code'); ok('código errado recusado');
  r = await B.sb.rpc('join_event', { p_code: code.toLowerCase(), p_display_name: 'Beto' }); assert.ifError(r.error); assert.strictEqual(r.data.status, 'pending'); assert.strictEqual(r.data.event_id, ev);
  const DB = dev(B, ev); await assert.rejects(DB.sync.load(), e => e.code === 'pending'); ok('B entra e fica pendente (load recusado)');
  r = await B.sb.from('expenses').select('*').eq('event_id', ev); assert.strictEqual(r.data.length, 0); ok('pendente lê 0 gastos pela API');
  r = await B.sb.rpc('approve_member', { p_event: ev, p_user: B.id }); assert(r.error && /organizer_only/.test(r.error.message));
  r = await O.sb.rpc('approve_member', { p_event: ev, p_user: B.id }); assert.ifError(r.error);
  await DB.sync.load();
  assert.deepStrictEqual(nets(DB.state), nets(DO.state)); assert.strictEqual(DB.sync.pendingCount(), 0);
  assert(!DB.state.families[0].members[1].diet && !DB.state.expenses.find(e => e.id === 'e1').photo); assert.strictEqual(DB.state.expenses.find(e => e.id === 'e2').confirmedBy, 'fa');
  assert.strictEqual(DB.state.families[1].arriveMeal, 'almoco'); assert.strictEqual(DB.state.kittyPerFamily, 300); assert.strictEqual(DB.state.settled.fa_fb.amount, 12.5); assert.strictEqual(DB.state.weights.crianca, 0.5);
  ok('aprovado: B vê os mesmos saldos, confirmação e pesos; sem dieta/foto');
  // concurrent: different fields merge; same field server wins + notice
  await DO.edit(st => { st.expenses.find(e => e.id === 'e1').amount = 260; });
  await DB.edit(st => { st.expenses.find(e => e.id === 'e1').description = 'Mercado grande'; });
  r = await O.sb.from('expenses').select('amount,description,version').eq('event_id', ev); const e1 = r.data.find(x => x.description === 'Mercado grande');
  assert(e1 && Number(e1.amount) === 260 && e1.version === 3, JSON.stringify(r.data)); assert.strictEqual(DB.notices.length, 0); ok('campos diferentes: as duas edições ficam (v3)');
  await DO.edit(st => { st.expenses.find(e => e.id === 'e1').amount = 280; });
  await DB.edit(st => { st.expenses.find(e => e.id === 'e1').amount = 270; });
  assert.strictEqual(DB.state.expenses.find(e => e.id === 'e1').amount, 280); assert(DB.notices.some(n => n.field === 'amount' && n.theirs === 280));
  r = await O.sb.from('expenses').update({ amount: 1, version: 1 }).eq('event_id', ev).eq('id', 'e1'); assert(r.error && r.error.code === 'PT409');
  ok('mesmo campo: vale o servidor + aviso; versão velha direto na API = PT409 (HTTP 409)');
  // confirmation insert-only + void
  await DB.edit(st => { const e = st.expenses.find(e => e.id === 'e2'); e.payerId = 'a1'; delete e.confirmedBy; });
  r = await O.sb.from('expense_confirmations').select('*').eq('event_id', ev); assert(r.data.every(c => c.voided_at)); ok('troca de pagador anula a confirmação no servidor');
  await DB.edit(st => { const e = st.expenses.find(e => e.id === 'e2'); e.confirmedBy = 'fb'; });
  await DO.sync.load(); assert.strictEqual(DO.state.expenses.find(e => e.id === 'e2').confirmedBy, 'fb'); ok('nova confirmação (só inserção) chega ao organizador');
  r = await B.sb.from('expense_confirmations').update({ family_id: 'fa' }).eq('event_id', ev); assert(r.error); ok('confirmação não é editável pela API');
  // outsider
  const DC = dev(C, ev); await assert.rejects(DC.sync.load(), e => e.code === 'not_member'); ok('quem não entrou não vê o evento');
  r = await C.sb.rpc('apply_ops', { p_event: ev, p_ops: [{ op_id: crypto.randomUUID(), table: 'expenses', row: { id: 'h', amount: 1, category: 'food' } }] }); assert.strictEqual(r.data[0].status, 'error'); ok('não-membro não grava');
  r = await C.sb.from('event_secrets').select('*'); assert(r.error); ok('event_secrets ilegível pela API');
  // lock
  r = await O.sb.rpc('lock_event', { p_event: ev, p_locked: true }); assert.ifError(r.error);
  await DB.sync.load(); assert.strictEqual(DB.state.eventLocked, true);
  await DB.edit(st => { st.kittyPerFamily = 999; }); assert.strictEqual(DB.state.kittyPerFamily, 300); assert(DB.notices.some(n => n.kind === 'locked'));
  await O.sb.rpc('lock_event', { p_event: ev, p_locked: false }); await DB.sync.load(); await DB.edit(st => { st.kittyPerFamily = 450; });
  await DO.sync.load(); assert.strictEqual(DO.state.kittyPerFamily, 450); ok('travado: edição desfeita com aviso; destravado grava');
  // rotate + revoke
  const code2 = L.genEventCode(); r = await O.sb.rpc('rotate_code', { p_event: ev, p_new_code: code2, p_repend: true }); assert.strictEqual(r.data, 2);
  await assert.rejects(DB.sync.load(), e => e.code === 'pending'); r = await C.sb.rpc('join_event', { p_code: code, p_display_name: 'Caio' }); assert.strictEqual(r.data.error, 'invalid_code');
  await O.sb.rpc('approve_member', { p_event: ev, p_user: B.id }); await DB.sync.load(); ok('trocar código + reaprovar');
  await O.sb.rpc('revoke_member', { p_event: ev, p_user: B.id }); await assert.rejects(DB.sync.load(), e => e.code === 'revoked');
  r = await B.sb.rpc('join_event', { p_code: code2, p_display_name: 'Beto' }); assert.strictEqual(r.data.error, 'revoked'); ok('removido não carrega nem volta com o código');
  r = await O.sb.from('expenses').delete().eq('event_id', ev); assert(r.error); ok('DELETE físico negado');
  console.log('POSTGREST + SUPABASE-JS TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
