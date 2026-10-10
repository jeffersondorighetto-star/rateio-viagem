// supabase-js falso para o navegador (testes). Mesma API usada pelo app.
export function createClient(url, key, opts) {
  const SK = (opts && opts.auth && opts.auth.storageKey) || 'sb-auth';
  const me = () => { try { return JSON.parse(localStorage.getItem(SK)); } catch (e) { return null; } };
  const call = async body => { try { const r = await fetch(url + '/fake/op', { method: 'POST', body: JSON.stringify({ user: (me() || {}).id, ...body }) }); return await r.json(); } catch (e) { return { data: null, error: { message: 'TypeError: Failed to fetch' } }; } };
  const auth = {
    getSession: async () => ({ data: { session: me() ? { user: me() } : null } }),
    signInAnonymously: async () => { const r = await call({ kind: 'signin' }); if (r.error) return r; localStorage.setItem(SK, JSON.stringify(r.user)); return { data: { user: r.user } }; },
  };
  const from = table => ({
    select: () => ({ eq: (col, val) => call({ kind: 'select', table, args: { col, val } }) }),
    update: patch => ({ eq: (col, val) => call({ kind: 'update', table, args: { patch, col, val } }) }),
    upsert: (rows, o) => call({ kind: 'upsert', table, args: { rows, onConflict: o && o.onConflict } }),
  });
  const rpc = (fn, args) => call({ kind: 'rpc', table: fn, args });
  const channel = name => {
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
