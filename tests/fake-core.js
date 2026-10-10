// Servidor falso em memória (só para testes) que imita o supabase.sql: membros com papel/status, RPCs,
// versão por linha, apply_ops idempotente, confirmação só-inserção com anulação e "RLS" por evento.
// Confere com o SQL real em supabase/test (rls_test.sql e postgrest.test.js).
const crypto = require('crypto');
const PK = { events: ['id'], event_members: ['event_id', 'user_id'], families: ['event_id', 'id'], people: ['event_id', 'id'], expenses: ['event_id', 'id'],
  settlement_marks: ['event_id', 'from_family', 'to_family'], event_overrides: ['event_id', 'kind', 'key'], expense_confirmations: ['event_id', 'id'],
  recipes: ['event_id', 'id'], meal_plan: ['event_id', 'day', 'meal'] };
const ALLOWED = {
  events: ['start_date', 'end_date', 'meals', 'split_mode', 'include_unconfirmed', 'kitty_per_family'],
  families: ['name', 'color', 'pos', 'arrive', 'arrive_meal', 'depart', 'depart_meal', 'deleted_at'],
  people: ['family_id', 'first_name', 'type', 'drinks', 'pos', 'arrive', 'arrive_meal', 'depart', 'depart_meal', 'deleted_at'],
  expenses: ['description', 'amount', 'category', 'payer_person_id', 'participants', 'proof', 'estimated', 'note', 'items', 'client_ts', 'photo_path', 'deleted_at'],
  settlement_marks: ['amount', 'deleted_at'], event_overrides: ['value', 'deleted_at'], expense_confirmations: ['expense_id', 'family_id'],
  recipes: ['title', 'yield', 'text', 'parsed', 'pos', 'deleted_at'], meal_plan: ['mode', 'recipe_ids', 'cook_family_id', 'clean_family_id', 'deleted_at'],
};
const SETTINGS = ['events', 'event_overrides'];
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
function createCore({ allow = null } = {}) { // allow: logins GitHub da organizer_allowlist (null = todos os não anônimos)
  const db = { events: [], secrets: [], members: [], families: [], people: [], recipes: [], meal_plan: [], expenses: [], settlement_marks: [], event_overrides: [], expense_confirmations: [], ops: new Set(), storage: {}, calls: [] };
  let clock = Date.parse('2031-03-01T12:00:00Z'); const now = () => new Date(clock += 1000).toISOString(); // monotonic server clock, 1 s per write
  const listeners = new Set();
  const mem = (e, u) => db.members.find(m => m.event_id === e && m.user_id === u);
  const approved = (e, u) => { const m = mem(e, u); return !!m && m.status === 'approved'; };
  const writable = (e, u) => approved(e, u) && !(db.events.find(x => x.id === e) || {}).locked;
  const organizer = (e, u) => { const m = mem(e, u); return !!m && m.status === 'approved' && m.role === 'organizer'; };
  const visible = (t, r, u) => t === 'event_members' ? (r.user_id === u || approved(r.event_id, u)) : approved(t === 'events' ? r.id : r.event_id, u);
  const emit = (t, row) => listeners.forEach(l => { if (visible(t, row, l.user)) l.cb(t, clone(row)); });
  const shape = (t, r) => { const o = { ...r, updated_at: now() };
    for (const k of ['amount', 'kitty_per_family']) if (o[k] != null) o[k] = Number(o[k]).toFixed(2); // numeric as text
    if (o.meals) o.meals = Object.fromEntries(Object.keys(o.meals).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map(k => [k, o.meals[k]]));
    return o; };
  const key = (t, r) => PK[t].map(c => r[c]).join('|');
  const find = (t, r) => db[t].find(x => key(t, x) === key(t, r));
  const put = (t, row) => { const i = db[t].findIndex(x => key(t, x) === key(t, row)); if (i >= 0) db[t][i] = row; else db[t].push(row); emit(t, row); return row; };
  const check = (t, r) => {
    if (t === 'expenses') { const a = Number(r.amount); if (!(a > 0 && a <= 1e6)) throw Object.assign(new Error('check amount'), { code: '23514' });
      if (!['food', 'groceries', 'gas', 'alcohol'].includes(r.category)) throw Object.assign(new Error('check category'), { code: '23514' }); }
    for (const bad of ['photo', 'diet', 'alergia', 'veg']) if (JSON.stringify(r).includes('"' + bad + '"')) throw new Error('LEAK ' + bad);
  };
  const voidConf = (e, expId) => db.expense_confirmations.filter(c => c.event_id === e && c.expense_id === expId && !c.voided_at).forEach(c => { c.voided_at = c.updated_at = now(); emit('expense_confirmations', c); });
  function applyOne(user, ev, o) {
    const t = o.table; if (!ALLOWED[t] || !o.op_id) return { op_id: o.op_id, status: 'error', error: 'bad_op' };
    if (!writable(ev, user) || (SETTINGS.includes(t) && !organizer(ev, user))) return { op_id: o.op_id, status: 'error', error: 'new row violates row-level security policy', code: '42501' };
    const r = { ...o.row, ...(t === 'events' ? { id: ev } : { event_id: ev }) };
    if (db.ops.has(o.op_id)) return { op_id: o.op_id, status: 'dup', row: clone(find(t, r)) };
    const cur = find(t, r);
    try {
      if (o.expected_version == null) {
        if (t === 'events') return { op_id: o.op_id, status: 'error', error: 'bad_op' };
        if (cur) return { op_id: o.op_id, status: 'conflict', row: clone(cur) };
        if (t === 'expense_confirmations') {
          const ex = db.expenses.find(x => x.event_id === ev && x.id === r.expense_id && !x.deleted_at);
          if (!ex || ex.proof !== 'none') throw Object.assign(new Error('only_sem_nota'), { code: '23514' });
          const payer = db.people.find(p => p.event_id === ev && p.id === ex.payer_person_id);
          if (payer && payer.family_id === r.family_id) throw Object.assign(new Error('payer_family_cannot_confirm'), { code: '23514' });
          const me = mem(ev, user); if (!organizer(ev, user) && (!me || me.family_id !== r.family_id)) return { op_id: o.op_id, status: 'error', error: 'not_your_family', code: '42501' };
          if (db.expense_confirmations.some(c => c.event_id === ev && c.expense_id === r.expense_id && !c.voided_at)) return { op_id: o.op_id, status: 'conflict', row: null };
          const ts = now(); const row = { event_id: ev, id: r.id, expense_id: r.expense_id, family_id: r.family_id, confirmed_by: user, confirmed_at: ts, updated_at: ts, voided_at: null };
          db.ops.add(o.op_id); return { op_id: o.op_id, status: 'ok', row: clone(put(t, row)) };
        }
        const row = shape(t, { ...Object.fromEntries(Object.entries(r).filter(([c]) => PK[t].includes(c) || ALLOWED[t].includes(c))), version: 1, created_by: user });
        check(t, row); db.ops.add(o.op_id); return { op_id: o.op_id, status: 'ok', row: clone(put(t, row)) };
      }
      if (t === 'expense_confirmations') return { op_id: o.op_id, status: 'error', error: 'insert_only', code: '42501' };
      if (!cur || cur.version !== o.expected_version) return { op_id: o.op_id, status: 'conflict', row: clone(cur) };
      const patch = Object.fromEntries(Object.entries(r).filter(([c]) => ALLOWED[t].includes(c)));
      const row = shape(t, { ...cur, ...patch, version: cur.version + 1 }); check(t, row);
      db.ops.add(o.op_id); put(t, row);
      if (t === 'expenses' && (row.payer_person_id !== cur.payer_person_id || row.proof !== 'none' || row.deleted_at)) voidConf(ev, row.id);
      return { op_id: o.op_id, status: 'ok', row: clone(row) };
    } catch (e) { return { op_id: o.op_id, status: 'error', error: e.message, code: e.code || 'P0001' }; }
  }
  const err = (message, code) => ({ data: null, error: { message, code } });
  const orgCount = e => db.members.filter(m => m.event_id === e && m.role === 'organizer' && m.status === 'approved').length;
  const rpc = (u, fn, a) => {
    const user = u && u.id; if (!user) return err('JWT required', '28000');
    if (fn === 'create_event') {
      if (u.is_anonymous !== false) return err('organizer_login_required', '42501');
      if (allow && !allow.map(x => x.toLowerCase()).includes(String(u.github || '').toLowerCase())) return err('organizer_only', '42501');
      const code = String(a.p_code).toUpperCase(); if (db.secrets.some(s => s.code === code)) return err('code_taken', '23505');
      const id = crypto.randomUUID();
      db.events.push(shape('events', { id, name: a.p_name, created_by: user, locked: false, code_version: 1, version: 1, start_date: null, end_date: null,
        meals: { cafe: true, almoco: true, lanche: false, jantar: true }, split_mode: 'pessoa', include_unconfirmed: true, kitty_per_family: 0 }));
      db.secrets.push({ event_id: id, code, version: 1 });
      put('event_members', { event_id: id, user_id: user, display_name: a.p_display_name, role: 'organizer', status: 'approved', joined_code_version: 1 });
      return { data: id, error: null };
    }
    if (fn === 'join_event') {
      const s = db.secrets.find(s => s.code === String(a.p_code).toUpperCase()); if (!s) return { data: { ok: false, error: 'invalid_code' }, error: null };
      const ev = db.events.find(e => e.id === s.event_id), m = mem(s.event_id, user);
      if (!m) { put('event_members', { event_id: s.event_id, user_id: user, display_name: a.p_display_name, role: 'member', status: 'pending', joined_code_version: s.version });
        return { data: { ok: true, event_id: s.event_id, status: 'pending', role: 'member' }, error: null }; }
      if (m.status === 'revoked') return { data: { ok: false, error: 'revoked' }, error: null };
      return { data: { ok: true, event_id: s.event_id, status: m.status, role: m.role, ...(m.status === 'approved' ? { event_name: ev.name } : {}) }, error: null };
    }
    if (fn === 'my_membership') { const m = mem(a.p_event, user), ev = db.events.find(e => e.id === a.p_event);
      return { data: m ? { status: m.status, role: m.role, display_name: m.display_name, ...(m.status === 'approved' ? { event_name: ev.name, locked: !!ev.locked, family_id: m.family_id || null } : {}) } : { status: 'none' }, error: null }; }
    if (fn === 'set_member_family') { if (!organizer(a.p_event, user)) return err('organizer_only', '42501');
      if (a.p_family && !db.families.some(f => f.event_id === a.p_event && f.id === a.p_family && !f.deleted_at)) return err('family_not_found', '23503');
      const m = mem(a.p_event, a.p_user); if (!m || m.status === 'revoked') return err('member_not_found', 'P0002');
      m.family_id = a.p_family || null; emit('event_members', m); return { data: null, error: null }; }
    if (fn === 'apply_ops') return { data: a.p_ops.map(o => applyOne(user, a.p_event, o)), error: null };
    if (!organizer(a.p_event, user)) return err('organizer_only', '42501');
    const ev = db.events.find(e => e.id === a.p_event);
    const bumpEv = patch => { const row = shape('events', { ...ev, ...patch, version: ev.version + 1 }); db.events[db.events.indexOf(ev)] = row; emit('events', row); };
    if (fn === 'approve_member' || fn === 'revoke_member') { const m = mem(a.p_event, a.p_user); if (!m) return err('member_not_found', 'P0002');
      if (fn === 'revoke_member' && (a.p_user === user || a.p_user === ev.created_by)) return err('cannot_revoke_self', '22023');
      if (fn === 'revoke_member' && m.role === 'organizer' && m.status === 'approved' && orgCount(a.p_event) <= 1) return err('last_organizer', '22023');
      if (fn === 'revoke_member') m.role = 'member';
      m.status = fn === 'approve_member' ? 'approved' : 'revoked'; if (fn === 'approve_member') m.joined_code_version = db.secrets.find(s => s.event_id === a.p_event).version;
      emit('event_members', m); return { data: null, error: null }; }
    if (fn === 'rotate_code') { const s = db.secrets.find(s => s.event_id === a.p_event); if (db.secrets.some(x => x.code === a.p_new_code)) return err('code_taken', '23505');
      s.code = String(a.p_new_code).toUpperCase(); s.version++; bumpEv({ code_version: s.version });
      if (a.p_repend) db.members.filter(m => m.event_id === a.p_event && m.status === 'approved' && m.role !== 'organizer').forEach(m => { m.status = 'pending'; emit('event_members', m); });
      return { data: s.version, error: null }; }
    if (fn === 'lock_event') { bumpEv({ locked: a.p_locked !== false }); return { data: null, error: null }; }
    if (fn === 'rename_event') { bumpEv({ name: a.p_name }); return { data: null, error: null }; }
    if (fn === 'set_member_role') { const m = mem(a.p_event, a.p_user); if (!m || m.status !== 'approved') return err('member_not_found', 'P0002');
      if (m.role === a.p_role) return { data: null, error: null };
      if (a.p_role === 'member' && orgCount(a.p_event) <= 1) return err('last_organizer', '22023');
      if (a.p_role === 'member' && a.p_user === ev.created_by) return err('cannot_demote_creator', '22023');
      m.role = a.p_role; emit('event_members', m); return { data: null, error: null }; }
    return err('unknown rpc ' + fn, '42883');
  };
  const select = (u, t, col, val, gte) => { db.calls.push({ user: u && u.id, t, gte: gte && gte[1] });
    return { data: clone(db[t === 'event_members' ? 'members' : t].filter(r => String(r[col]) === String(val) && visible(t, r, u && u.id) && (!gte || Date.parse(r[gte[0]]) >= Date.parse(gte[1])))), error: null }; };
  // Storage (bucket privado "comprovantes"), mesmas regras das policies do 0006
  const PATH_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[A-Za-z0-9_-]{1,40}\.jpg$/;
  const storage = (u, kind, path, opts = {}) => { const m = PATH_RE.exec(path || ''); const ev = m && m[1], user = u && u.id;
    const deny = () => ({ data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } });
    if (!ev) return deny();
    if (kind === 'upload') { if (!writable(ev, user)) return deny(); if (opts.size > 153600) return { data: null, error: { message: 'The object exceeded the maximum allowed size', statusCode: '413' } };
      if (!['image/jpeg', 'image/webp'].includes(opts.contentType)) return { data: null, error: { message: 'mime type not supported', statusCode: '415' } };
      if (db.storage[path]) { if (!opts.upsert) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } }; if (!organizer(ev, user)) return deny(); }
      db.storage[path] = { size: opts.size, contentType: opts.contentType, owner: user, data: opts.data }; return { data: { path }, error: null }; }
    if (kind === 'sign') { if (!approved(ev, user) || !db.storage[path]) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
      return { data: { signedUrl: '/fake/obj?path=' + encodeURIComponent(path) + '&exp=' + (Date.now() + 1000 * (opts.expiresIn || 0)) }, error: null }; }
    if (kind === 'remove') { if (!organizer(ev, user)) return { data: [], error: null }; delete db.storage[path]; return { data: [{ name: path }], error: null }; }
    return deny(); };
  db.event_members = db.members;
  return { db, rpc, select, storage, advance: ms => { clock += ms; }, listen: (user, cb) => { const l = { user, cb }; listeners.add(l); return () => listeners.delete(l); } };
}
module.exports = { createCore };
