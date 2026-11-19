// supabase-js v2 (mesma versão do app) contra Postgres + PostgREST locais com o supabase.sql e RLS de verdade.
// Pré-requisito: PostgREST em http://localhost:54402 (ver README em supabase/test). Uso: NODE_PATH=<dir com @supabase/supabase-js> node postgrest.test.js
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { execFileSync } = require('child_process');
// lista de organizadores: o teste grava direto no banco (no Supabase real isso é feito no SQL Editor)
const sql = q => execFileSync('psql', ['-X', '-q', '-d', process.env.REST_DB || 'rest', '-c', q], { env: { PGHOST: '/tmp', PGPORT: '54329', PGUSER: 'postgres', ...process.env } });
// lista por id numérico do GitHub (auth.identities.provider_id); o login não conta
const allow = (u, login, ghId, listed = true) => sql(`insert into auth.identities (user_id, provider, identity_data, provider_id) values ('${u.id}', 'github', '{"user_name":"${login}"}', '${ghId}'); ${listed ? `insert into public.organizer_allowlist (github_id, note) values (${ghId}, '${login}') on conflict do nothing;` : ''}`);
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
  const O = user(false), A = user(), B = user(), C = user(), G = user(false), O2 = user(false);
  allow(O, 'org-rest', 7001); allow(O2, 'org-rest-2', 7002); allow(G, 'org-rest', 7999, false); // G: mesmo login de O, outro id
  const code = L.genEventCode();
  let r = await A.sb.rpc('create_event', { p_name: 'x', p_code: code, p_display_name: 'Ana' }); assert(r.error && /organizer_login_required/.test(r.error.message)); ok('anônimo não cria evento');
  r = await G.sb.rpc('create_event', { p_name: 'x', p_code: L.genEventCode(), p_display_name: 'G' }); assert(r.error && /organizer_only/.test(r.error.message)); ok('mesmo login do GitHub com outro id numérico não cria evento');
  r = await G.sb.from('organizer_allowlist').select('*'); assert(r.error); ok('lista de organizadores ilegível pela API');
  r = await O.sb.rpc('create_event', { p_name: 'Teste REST', p_code: code, p_display_name: 'Org' }); assert.ifError(r.error); const ev = r.data;
  const sample = { splitMode: 'porcoes', includeUnconfirmed: true, kittyPerFamily: 300, weights: { crianca: 0.5 }, trip: { start: '2031-03-03', end: '2031-03-05', meals: { cafe: true, almoco: true, lanche: false, jantar: true } },
    families: [{ id: 'fa', name: 'Família A', members: [{ id: 'a1', name: 'Ana', drinks: true }, { id: 'a2', name: 'Lia', type: 'crianca', diet: { alergia: 'amendoim' } }] },
      { id: 'fb', name: 'Família B', arrive: '2031-03-04', arriveMeal: 'almoco', members: [{ id: 'b1', name: 'Beto', drinks: true }] }],
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
  assert(!('event_name' in r.data)); r = await B.sb.rpc('my_membership', { p_event: ev }); assert(!('event_name' in r.data) && !('locked' in r.data)); ok('pendente não recebe o nome do evento (join_event e my_membership)');
  const DB = dev(B, ev); await assert.rejects(DB.sync.load(), e => e.code === 'pending'); ok('B entra e fica pendente (load recusado)');
  r = await B.sb.from('expenses').select('*').eq('event_id', ev); assert.strictEqual(r.data.length, 0); ok('pendente lê 0 gastos pela API');
  r = await B.sb.rpc('approve_member', { p_event: ev, p_user: B.id }); assert(r.error && /organizer_only/.test(r.error.message));
  r = await O.sb.rpc('approve_member', { p_event: ev, p_user: B.id }); assert.ifError(r.error);
  await DB.sync.load();
  assert.deepStrictEqual(nets(DB.state), nets(DO.state)); assert.strictEqual(DB.sync.pendingCount(), 0);
  assert(!DB.state.families[0].members[1].diet && !DB.state.expenses.find(e => e.id === 'e1').photo); assert.strictEqual(DB.state.expenses.find(e => e.id === 'e2').confirmedBy, 'fa');
  assert.strictEqual(DB.state.families[1].arriveMeal, 'almoco'); assert.strictEqual(DB.state.kittyPerFamily, 300); assert.strictEqual(DB.state.settled.fa_fb.amount, 12.5); assert.strictEqual(DB.state.weights.crianca, 0.5);
  ok('aprovado: B vê os mesmos saldos, confirmação e pesos; sem dieta/foto');
  // PostgREST direto: privilégios por coluna, configurações do organizador, membros e dieta
  r = await O.sb.from('events').select('version').eq('id', ev); const ev1v = r.data[0].version;
  r = await B.sb.from('events').update({ split_mode: 'igual', kitty_per_family: 1, version: ev1v + 1 }).eq('id', ev).select();
  assert(!r.error && r.data.length === 0, JSON.stringify(r)); r = await O.sb.from('events').select('split_mode,kitty_per_family').eq('id', ev);
  assert.strictEqual(r.data[0].split_mode, 'porcoes'); assert.strictEqual(Number(r.data[0].kitty_per_family), 300); ok('membro não muda modo de divisão nem caixinha por PATCH (0 linhas)');
  r = await B.sb.from('expenses').update({ confirmed_by_family_id: 'fb', version: 99 }).eq('event_id', ev).eq('id', 'e2'); assert(r.error && r.error.code === '42501', JSON.stringify(r.error)); ok('PATCH confirmed_by_family_id = 42501');
  r = await B.sb.from('expenses').update({ id: 'zz' }).eq('event_id', ev).eq('id', 'e2'); assert(r.error && r.error.code === '42501'); ok('PATCH id = 42501');
  r = await B.sb.from('event_members').update({ family_id: 'fa' }).eq('event_id', ev).eq('user_id', B.id); assert(r.error && r.error.code === '42501'); ok('membro não muda a própria família por PATCH (42501)');
  r = await B.sb.from('expenses').insert({ event_id: ev, id: 'ins1', amount: 1, category: 'food', version: 50 }); assert(r.error && r.error.code === '42501'); ok('INSERT com version = 42501');
  r = await B.sb.from('person_diet').select('*'); assert(r.error); r = await B.sb.from('person_diet').insert({ event_id: ev, person_id: 'a2' }); assert(r.error); ok('não existe person_diet na API (dieta só no aparelho)');
  // usuário em dois eventos
  const code3 = L.genEventCode(); r = await O2.sb.rpc('create_event', { p_name: 'Outro REST', p_code: code3, p_display_name: 'Org2' }); assert.ifError(r.error); const ev2 = r.data;
  r = await B.sb.rpc('join_event', { p_code: code3, p_display_name: 'Beto' }); r = await O2.sb.rpc('approve_member', { p_event: ev2, p_user: B.id }); assert.ifError(r.error);
  r = await B.sb.from('events').select('id'); assert.strictEqual(r.data.length, 2);
  r = await B.sb.from('expenses').update({ event_id: ev2, version: 99 }).eq('event_id', ev).eq('id', 'e1'); assert(r.error && r.error.code === '42501', JSON.stringify(r.error));
  r = await B.sb.from('families').update({ event_id: ev2, version: 99 }).eq('event_id', ev).eq('id', 'fa'); assert(r.error && r.error.code === '42501');
  r = await O2.sb.from('expenses').select('id').eq('event_id', ev); assert.strictEqual(r.data.length, 0);
  r = await O2.sb.rpc('apply_ops', { p_event: ev, p_ops: [{ op_id: crypto.randomUUID(), table: 'expenses', row: { id: 'h2', amount: 1, category: 'food' } }] }); assert.strictEqual(r.data[0].status, 'error');
  r = await B.sb.rpc('approve_member', { p_event: ev2, p_user: C.id }); assert(r.error && /organizer_only/.test(r.error.message));
  ok('usuário nos dois eventos não move linhas entre eles (event_id por coluna); organizador de um não lê nem grava no outro');
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
  assert(DB.notices.some(n => n.kind === 'family')); r = await O.sb.from('expense_confirmations').select('*').eq('event_id', ev); assert(r.data.every(c => c.voided_at)); ok('sem família definida, o membro não confirma (aviso)');
  r = await O.sb.rpc('set_member_family', { p_event: ev, p_user: B.id, p_family: 'fb' }); assert.ifError(r.error);
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
  await DB.edit(st => { st.expenses.find(e => e.id === 'e1').note = 'travado'; }); assert.notStrictEqual(DB.state.expenses.find(e => e.id === 'e1').note, 'travado'); assert(DB.notices.some(n => n.kind === 'locked'));
  await O.sb.rpc('lock_event', { p_event: ev, p_locked: false }); await DB.sync.load(); await DB.edit(st => { st.expenses.find(e => e.id === 'e1').note = 'ok'; });
  await DO.sync.load(); assert.strictEqual(DO.state.expenses.find(e => e.id === 'e1').note, 'ok'); ok('travado: edição desfeita com aviso; destravado grava');
  await DB.edit(st => { st.kittyPerFamily = 999; }); assert.strictEqual(DB.state.kittyPerFamily, 300); assert(DB.notices.some(n => n.kind === 'settings')); ok('membro: caixinha só leitura (aviso)');
  await DO.edit(st => { st.kittyPerFamily = 450; }); await DB.sync.load(); assert.strictEqual(DB.state.kittyPerFamily, 450); ok('organizador muda a caixinha');
  // retenção: purge_event_photos só do organizador, outro evento intacto (arquivos simulados direto no banco)
  sql(`insert into storage.objects (bucket_id, name) values ('comprovantes', '${ev}/e1.jpg'), ('comprovantes', '${ev2}/k1.jpg'); select set_config('rateio.server_write', 'on', true); update public.expenses set photo_path = '${ev}/e1.jpg' where event_id = '${ev}' and id = 'e1';`);
  r = await B.sb.rpc('purge_event_photos', { p_event: ev }); assert(r.error && /organizer_only/.test(r.error.message)); r = await O2.sb.rpc('purge_event_photos', { p_event: ev }); assert(r.error && /organizer_only/.test(r.error.message));
  r = await B.sb.rpc('event_photo_status', { p_event: ev }); assert(r.error);
  r = await O.sb.rpc('purge_event_photos', { p_event: ev }); assert.ifError(r.error); assert.deepStrictEqual(r.data.paths, [`${ev}/e1.jpg`]); assert(r.data.cleared_refs >= 1);
  r = await O.sb.from('expenses').select('id').eq('event_id', ev).not('photo_path', 'is', null); assert.strictEqual(r.data.length, 0);
  r = await O2.sb.rpc('event_photo_status', { p_event: ev2 }); assert.strictEqual(r.data.remaining, 1);
  sql(`set storage.allow_delete_query = 'true'; delete from storage.objects where name = '${ev}/e1.jpg';`); // o que a Storage API faz com o remove()
  r = await O.sb.rpc('event_photo_status', { p_event: ev }); assert.strictEqual(r.data.remaining, 0);
  sql(`set storage.allow_delete_query = 'true'; delete from storage.objects where name = '${ev2}/k1.jpg';`);
  ok('purge_event_photos: membro e organizador de outro evento recusados; organizador recebe só as fotos do próprio evento e as referências somem');
  // rotate + revoke
  const code2 = L.genEventCode(); r = await O.sb.rpc('rotate_code', { p_event: ev, p_new_code: code2, p_repend: true }); assert.strictEqual(r.data, 2);
  await assert.rejects(DB.sync.load(), e => e.code === 'pending'); r = await C.sb.rpc('join_event', { p_code: code, p_display_name: 'Caio' }); assert.strictEqual(r.data.error, 'invalid_code');
  await O.sb.rpc('approve_member', { p_event: ev, p_user: B.id }); await DB.sync.load(); ok('trocar código + reaprovar');
  await O.sb.rpc('revoke_member', { p_event: ev, p_user: B.id }); await assert.rejects(DB.sync.load(), e => e.code === 'revoked');
  r = await B.sb.rpc('join_event', { p_code: code2, p_display_name: 'Beto' }); assert.strictEqual(r.data.error, 'revoked'); ok('removido não carrega nem volta com o código');
  r = await O.sb.from('expenses').delete().eq('event_id', ev); assert(r.error); ok('DELETE físico negado');
  console.log('POSTGREST + SUPABASE-JS TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
