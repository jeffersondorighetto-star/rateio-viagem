// Servidor falso (só para testes) que imita o Supabase: auth anônimo, RPCs create_event/join_event,
// tabelas com "RLS" por evento, upsert/update e tempo real por SSE. Também serve o index.html.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PK = { events: ['id'], families: ['event_id', 'id'], people: ['event_id', 'id'], expenses: ['event_id', 'id'], settlement_marks: ['event_id', 'from_family', 'to_family'] };
function start(port, opts = {}) {
  const db = { events: [], secrets: [], members: [], families: [], people: [], expenses: [], settlement_marks: [] }, streams = [];
  const isMember = (e, u) => db.members.some(m => m.event_id === e && m.user_id === u);
  const shape = r => { const o = { ...r, updated_at: new Date().toISOString() }; if (o.amount != null) o.amount = Number(o.amount).toFixed(2); return o; };
  const push = (t, row) => streams.forEach(s => { if (isMember(t === 'events' ? row.id : row.event_id, s.user)) s.res.write(`data: ${JSON.stringify({ table: t, row })}\n\n`); });
  const html = () => fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
    .replace("SUPABASE_URL: null,", `SUPABASE_URL: 'http://localhost:${port}',`).replace("SUPABASE_ANON_KEY: null,", "SUPABASE_ANON_KEY: 'sb_publishable_TEST',");
  const op = ({ user, kind, table, args }) => {
    if (kind === 'signin') return { user: { id: crypto.randomUUID() } };
    if (!user) return { error: { message: 'JWT required' } };
    if (kind === 'rpc' && table === 'create_event') {
      const code = String(args.p_code).toUpperCase(); if (db.secrets.some(s => s.code === code)) return { error: { message: 'code_taken' } };
      const id = crypto.randomUUID(), ev = shape({ id, name: args.p_name, created_by: user, start_date: null, end_date: null, meals: { cafe: true, almoco: true, jantar: true, lanche: false }, split_mode: 'pessoa', include_unconfirmed: true, kitty_per_family: '0.00', weights: {} });
      db.events.push(ev); db.secrets.push({ event_id: id, code }); db.members.push({ event_id: id, user_id: user, display_name: args.p_display_name }); return { data: id };
    }
    if (kind === 'rpc' && table === 'join_event') {
      const s = db.secrets.find(s => s.code === String(args.p_code).toUpperCase()); if (!s) return { error: { message: 'invalid_code', code: '22023' } };
      if (!isMember(s.event_id, user)) db.members.push({ event_id: s.event_id, user_id: user, display_name: args.p_display_name }); return { data: s.event_id };
    }
    const vis = r => isMember(table === 'events' ? r.id : r.event_id, user);
    if (kind === 'select') return { data: db[table].filter(r => String(r[args.col]) === String(args.val) && vis(r)) };
    if (kind === 'update') { db[table].forEach((r, i) => { if (String(r[args.col]) === String(args.val) && vis(r)) { db[table][i] = shape({ ...r, ...args.patch }); push(table, db[table][i]); } }); return { data: null }; }
    if (kind === 'upsert') {
      for (const r of args.rows) {
        if (!isMember(r.event_id, user)) return { error: { message: 'new row violates row-level security policy for table "' + table + '"', code: '42501' } };
        for (const bad of ['photo', 'diet', 'veg', 'alergia']) if (JSON.stringify(r).includes('"' + bad + '"')) return { error: { message: 'LEAK ' + bad } };
        const k = PK[table].map(c => r[c]).join('|'), i = db[table].findIndex(x => PK[table].map(c => x[c]).join('|') === k);
        const row = shape({ ...(i >= 0 ? db[table][i] : { created_by: user }), ...r }); if (i >= 0) db[table][i] = row; else db[table].push(row); push(table, row);
      }
      return { data: null };
    }
    return { error: { message: 'unknown op' } };
  };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html()); }
    if (u.pathname === '/fake-supabase.mjs') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(__dirname, 'fake-supabase.mjs'))); }
    if (u.pathname === '/fake/stream') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write(': ok\n\n'); const s = { user: u.searchParams.get('user'), res }; streams.push(s); req.on('close', () => streams.splice(streams.indexOf(s), 1)); return; }
    if (u.pathname === '/fake/op' && req.method === 'POST') { let b = ''; req.on('data', c => b += c); req.on('end', () => { const out = op(JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); }); return; }
    res.writeHead(404); res.end();
  });
  return new Promise(r => srv.listen(port, () => r({ srv, db, close: () => { streams.forEach(s => s.res.end()); srv.close(); } })));
}
module.exports = { start };
