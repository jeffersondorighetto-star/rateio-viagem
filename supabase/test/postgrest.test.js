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
const user = () => { const id = crypto.randomUUID(); return { id, sb: createClient(URL, jwt({ role: 'anon' }), { global: { fetch: strip, headers: { Authorization: 'Bearer ' + jwt({ role: 'authenticated', sub: id, is_anonymous: true }) } }, auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: class { constructor() {} close() {} } } }) }; };
const timers = () => { const q = []; return { set: f => { q.push(f); return q.length; }, clear: () => {}, run: async () => { for (const f of q.splice(0)) await f(); } }; };
const dev = (sb, eventId, st) => { const d = { state: st || { families: [], expenses: [], settled: {} }, T: timers() };
  d.sync = L.createSync({ client: sb, eventId, timers: d.T, getState: () => d.state, setState: s => { d.state = s; } }); return d; };
const nets = s => Object.fromEntries(L.computeSplit(s).families.map(f => [f.id, Math.round(f.net * 100) / 100]));
(async () => {
  const A = user(), B = user(), C = user();
  const code = L.genEventCode();
  let r = await A.sb.rpc('create_event', { p_name: 'Teste REST', p_code: code, p_display_name: 'Ana' }); assert.ifError(r.error); const ev = r.data;
  const sample = { splitMode: 'porcoes', includeUnconfirmed: true, kittyPerFamily: 300, weights: { crianca: 0.5 }, trip: { start: '2026-10-10', end: '2026-10-12', meals: { cafe: true, almoco: true, lanche: false, jantar: true } },
    families: [{ id: 'fa', name: 'Família A', members: [{ id: 'a1', name: 'Ana', drinks: true }, { id: 'a2', name: 'Lia', type: 'crianca', diet: { alergia: 'amendoim' } }] },
      { id: 'fb', name: 'Família B', arrive: '2026-10-11', arriveMeal: 'almoco', members: [{ id: 'b1', name: 'Beto', drinks: true }] }],
    expenses: [{ id: 'e1', amount: 250.35, category: 'groceries', description: 'Mercado', payerId: 'a1', items: 'carne', ts: 2, photo: 'data:image/jpeg;base64,AA' },
      { id: 'e2', amount: 90, category: 'alcohol', description: 'Cerveja', payerId: 'b1', proof: 'none', confirmedBy: 'fa', confirmedAt: Date.now(), ts: 1 }],
    settled: { fa_fb: { amount: 12.5, at: 1 } }, plan: {}, recipes: [] };
  const DA = dev(A.sb, ev); await DA.sync.load();
  DA.state = L.rowsToState(L.stateToRows({ ...sample, syncMode: true }, ev, 'Teste REST'), { ...sample, syncMode: true }); DA.sync.schedule(); await DA.T.run();
  assert.strictEqual(DA.sync.status(), 'synced', 'A synced'); console.log('  ✓ A criou o evento e gravou (upsert onConflict) com RLS');
  r = await B.sb.rpc('join_event', { p_code: 'AAAA2222', p_display_name: 'Beto' }); assert(r.error && /invalid_code/.test(r.error.message)); console.log('  ✓ código errado recusado');
  const DC = dev(C.sb, ev); await assert.rejects(DC.sync.load(), e => e.code === 'not_member'); console.log('  ✓ quem não entrou não vê o evento');
  r = await C.sb.from('expenses').upsert([{ event_id: ev, id: 'hack', amount: 1, category: 'food' }], { onConflict: 'event_id,id' }); assert(r.error && r.error.code === '42501'); console.log('  ✓ não-membro não grava (42501)');
  r = await C.sb.from('event_secrets').select('*'); assert(r.error); console.log('  ✓ event_secrets ilegível pela API');
  r = await B.sb.rpc('join_event', { p_code: code.toLowerCase(), p_display_name: 'Beto' }); assert.ifError(r.error); assert.strictEqual(r.data, ev);
  const DB = dev(B.sb, ev); await DB.sync.load();
  assert.deepStrictEqual(nets(DB.state), nets(DA.state)); assert.strictEqual(DB.sync.pendingCount(), 0, 'no dirty rows after real numeric/jsonb echo');
  assert(!DB.state.families[0].members[1].diet && !DB.state.expenses.find(e => e.id === 'e1').photo); assert.strictEqual(DB.state.expenses.find(e => e.id === 'e2').confirmedBy, 'fa');
  assert.strictEqual(DB.state.families[1].arriveMeal, 'almoco'); assert.strictEqual(DB.state.kittyPerFamily, 300); assert.strictEqual(DB.state.settled.fa_fb.amount, 12.5);
  console.log('  ✓ B entrou com o código e vê os mesmos saldos; nada pendente; sem dieta/foto');
  DB.state.expenses = DB.state.expenses.filter(e => e.id !== 'e2'); DB.state.kittyPerFamily = 450; DB.sync.schedule(); await DB.T.run(); assert.strictEqual(DB.sync.status(), 'synced');
  await DA.sync.load(); assert(!DA.state.expenses.find(e => e.id === 'e2')); assert.strictEqual(DA.state.kittyPerFamily, 450);
  r = await A.sb.from('expenses').select('id,deleted_at').eq('event_id', ev); assert(r.data.find(x => x.id === 'e2').deleted_at); console.log('  ✓ exclusão lógica e ajuste do evento chegam ao A');
  r = await A.sb.from('expenses').delete().eq('event_id', ev); assert(r.error); console.log('  ✓ DELETE físico negado');
  r = await A.sb.from('expenses').upsert([{ event_id: ev, id: 'big', amount: 5000000, category: 'food' }], { onConflict: 'event_id,id' }); assert(r.error && r.error.code === '23514'); console.log('  ✓ limite de valor (check)');
  console.log('POSTGREST + SUPABASE-JS TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
