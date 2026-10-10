// Servidor falso (só para testes) que imita o Supabase usando tests/fake-core.js: login anônimo e "GitHub",
// RPCs, apply_ops com versão, "RLS" por membro aprovado e tempo real por SSE. Também serve o index.html.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createCore } = require('../fake-core');
function start(port) {
  const core = createCore(), users = {}, streams = [];
  core.listen(null, () => {}); // keeps API symmetrical
  const html = () => fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
    .replace("SUPABASE_URL: null,", `SUPABASE_URL: 'http://localhost:${port}',`).replace("SUPABASE_ANON_KEY: null,", "SUPABASE_ANON_KEY: 'sb_publishable_TEST',");
  const op = ({ user, kind, table, args }) => {
    if (kind === 'signin') { const u = { id: crypto.randomUUID(), is_anonymous: true, user_metadata: {} }; users[u.id] = u; return { user: u }; }
    if (kind === 'oauth') { const id = 'aaaaaaaa-0000-4000-8000-' + crypto.createHash('sha1').update(args.login).digest('hex').slice(0, 12);
      const u = users[id] || (users[id] = { id, is_anonymous: false, user_metadata: { user_name: args.login } }); return { user: u }; }
    const u = users[user]; if (!u) return { error: { message: 'JWT required' } };
    if (kind === 'link') { u.is_anonymous = false; u.user_metadata = { user_name: args.login }; return { user: u }; }
    if (kind === 'select') return args.col ? core.select(u, table, args.col, args.val) : { data: core.db[table].filter(r => table === 'events' && core.rpc(u, 'my_membership', { p_event: r.id }).data.status === 'approved'), error: null };
    if (kind === 'rpc') return core.rpc(u, table, args || {});
    return { error: { message: 'unknown op' } };
  };
  streams.length = 0;
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html()); }
    if (url.pathname === '/fake/stream') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write(': ok\n\n');
      const off = core.listen(url.searchParams.get('user'), (table, row) => res.write(`data: ${JSON.stringify({ table, row })}\n\n`));
      const s = { res, off }; streams.push(s); req.on('close', () => { off(); streams.splice(streams.indexOf(s), 1); }); return; }
    if (url.pathname === '/fake/op' && req.method === 'POST') { let b = ''; req.on('data', c => b += c); req.on('end', () => { const out = op(JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); }); return; }
    res.writeHead(404); res.end();
  });
  return new Promise(r => srv.listen(port, () => r({ srv, db: core.db, core, users, close: () => { streams.forEach(s => s.res.end()); srv.close(); } })));
}
module.exports = { start };
