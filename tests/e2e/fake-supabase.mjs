// supabase-js falso para o navegador (testes). Mesma API usada pelo app, inclusive login "GitHub" com redirecionamento.
export function createClient(url, key, opts) {
  const SK = (opts && opts.auth && opts.auth.storageKey) || 'sb-auth';
  const me = () => { try { return JSON.parse(localStorage.getItem(SK)); } catch (e) { return null; } };
  const call = async body => { try { const r = await fetch(url + '/fake/op', { method: 'POST', body: JSON.stringify({ user: (me() || {}).id, ...body }) }); return await r.json(); } catch (e) { return { data: null, error: { message: 'TypeError: Failed to fetch' } }; } };
  const login = () => localStorage.getItem('fake-gh-login') || 'jeff';
  const go = to => { setTimeout(() => location.assign(to + (to.includes('?') ? '&' : '?') + 'code=fake'), 10); return { data: {}, error: null }; };
  const auth = {
    getSession: async () => ({ data: { session: me() ? { user: me() } : null } }),
    signInAnonymously: async () => { const r = await call({ kind: 'signin' }); if (r.error) return r; localStorage.setItem(SK, JSON.stringify(r.user)); return { data: { user: r.user } }; },
    signInWithOAuth: async ({ options }) => { const r = await call({ kind: 'oauth', args: { login: login() } }); if (r.error) return r; localStorage.setItem(SK, JSON.stringify(r.user)); return go(options.redirectTo); },
    linkIdentity: async ({ options }) => { if (localStorage.getItem('fake-no-link')) return { data: null, error: { message: 'Manual linking is disabled' } };
      const r = await call({ kind: 'link', args: { login: login() } }); if (r.error) return r; localStorage.setItem(SK, JSON.stringify(r.user)); return go(options.redirectTo); },
  };
  const from = table => ({ select: () => { const q = call({ kind: 'select', table, args: {} }); return { eq: (col, val) => call({ kind: 'select', table, args: { col, val } }), then: (a, b) => q.then(a, b) }; } });
  const rpc = (fn, args) => call({ kind: 'rpc', table: fn, args });
  const channel = () => {
    const handlers = []; let es = null;
    const ch = { on(_, f, cb) { handlers.push({ f, cb }); return ch; },
      subscribe(cb) { es = new EventSource(url + '/fake/stream?user=' + encodeURIComponent((me() || {}).id));
        es.onopen = () => cb && cb('SUBSCRIBED'); es.onerror = () => cb && cb('CHANNEL_ERROR');
        es.onmessage = m => { const { table, row } = JSON.parse(m.data); handlers.forEach(h => { if (h.f.table !== table) return; const [c, v] = h.f.filter.split('=eq.'); if (String(row[c]) === v) h.cb({ new: row }); }); };
        ch._es = es; return ch; } };
    return ch;
  };
  return { auth, from, rpc, channel, removeChannel: ch => ch && ch._es && ch._es.close() };
}
