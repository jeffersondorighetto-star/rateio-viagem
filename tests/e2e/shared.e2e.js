// Ponta a ponta do modo compartilhado: 2 celulares (contextos separados), backend falso, 375 px.
// Uso: node tests/e2e/shared.e2e.js   (precisa do Chrome em /usr/bin/google-chrome ou CHROME_PATH)
const { chromium } = require('playwright-core'), fs = require('fs'), path = require('path'), assert = require('assert');
const { start } = require('./fake-backend');
const PORT = 54400, BASE = `http://localhost:${PORT}/`, OUT = path.join(__dirname, '..', '..', 'shots', 'e2e');
fs.mkdirSync(OUT, { recursive: true });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-supabase.mjs'), 'utf8');
(async () => {
  const be = await start(PORT);
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const mk = async (name, theme = 'light') => {
    const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, colorScheme: theme });
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.3\/\+esm/, r => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: FAKE }));
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(name + ': ' + e.message)); p.on('dialog', d => d.accept());
    return { ctx, p };
  };
  const pill = p => p.$eval('#syncPill', e => e.textContent).catch(() => '');
  const waitSynced = p => p.waitForFunction(() => document.getElementById('syncPill').textContent === 'Sincronizado', null, { timeout: 8000 });
  const nets = p => p.evaluate(() => Object.fromEntries(computeSplit(App.getState()).families.map(f => [f.name, Math.round(f.net * 100) / 100])));
  const step = m => console.log('  ✓ ' + m);

  const contrast = (p, sel) => p.evaluate(sel => {
    const parse = c => { let m = c.match(/rgba?\(([^)]+)\)/); if (m) { const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] == null ? 1 : v[3]]; }
      m = c.match(/color\(srgb ([^)]+)\)/); if (m) { const v = m[1].split(/[ \/]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v[3] == null ? 1 : v[3]]; } return null; };
    const lum = ([r, g, b]) => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = e => { const stack = []; for (let x = e; x; x = x.parentElement) { const c = parse(getComputedStyle(x).backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } }
      if (!stack.length || stack[stack.length - 1][3] < 1) stack.push(parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1]);
      let out = stack.pop(); while (stack.length) { const c = stack.pop(); out = [0, 1, 2].map(i => c[i] * c[3] + out[i] * (1 - c[3])).concat(1); } return out; };
    const bad = []; let n = 0, min = 99;
    for (const root of document.querySelectorAll(sel)) for (const e of [root, ...root.querySelectorAll('*')]) {
      if (!e.getClientRects().length || ![...e.childNodes].some(t => t.nodeType === 3 && t.textContent.trim()) || e.closest('[disabled]')) continue;
      const fg = parse(getComputedStyle(e).color), bg = bgOf(e); if (!fg) continue;
      const fgm = [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
      const a = lum(fgm), b = lum(bg), r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); n++; min = Math.min(min, r);
      if (r < 4.5) bad.push(e.tagName + ' "' + e.textContent.trim().slice(0, 30) + '" ' + r.toFixed(2));
    }
    return { n, min: +min.toFixed(2), bad };
  }, sel);
  const checkContrast = async (p, sel, label) => { const r = await contrast(p, sel); assert.deepStrictEqual(r.bad, [], label + ': ' + r.bad.join(', ')); console.log(`    contraste ${label}: ${r.n} textos, mínimo ${r.min}`); };

  // ---- A: abre, vê a tela de entrada, guarda o exemplo como "dados deste aparelho", cria evento
  const A = await mk('A');
  await A.p.goto(BASE); await A.p.waitForSelector('#gateDlg[open]');
  await A.p.screenshot({ path: path.join(OUT, '01-gate-375.png') }); await checkContrast(A.p, '#gateBody', 'entrada (claro)'); step('tela "Evento compartilhado" aparece');
  await A.p.click('#gateLocal');
  await A.p.evaluate(() => localStorage.setItem('racha-viagem-v3', JSON.stringify(App.getState())));
  const localNets = await A.p.evaluate(() => Object.fromEntries(computeSplit({ ...App.getState(), plan: {} }).families.map(f => [f.name, Math.round(f.net * 100) / 100])));
  await A.p.evaluate(() => App.openGate());
  await A.p.waitForSelector('#ghBtn'); await checkContrast(A.p, '#orgCard', 'organizador (claro)');
  await Promise.all([A.p.waitForNavigation(), A.p.click('#ghBtn')]); // "GitHub" e volta com ?org=1&code=
  await A.p.waitForSelector('#createForm'); assert(!/[?&]code=/.test(await A.p.evaluate(() => location.search)), 'URL limpa depois do login');
  assert(/Conectado como/.test(await A.p.textContent('#orgBody'))); step('organizador entra com GitHub (volta para o app)');
  await A.p.fill('#cName', 'Feriado teste'); await A.p.fill('#cMe', 'Jefferson');
  await Promise.all([A.p.waitForNavigation(), A.p.click('#createForm button[type=submit]')]);
  await waitSynced(A.p);
  const code = await A.p.evaluate(() => location.hash.slice(1)); assert(/^[A-HJ-NP-Z2-9]{8}$/.test(code), code); step('evento criado, código ' + code);
  assert.strictEqual(await A.p.evaluate(() => App.getState().families.length), 0, 'evento novo começa vazio');
  await A.p.waitForFunction(() => /você organiza/.test(document.getElementById('dataMeta').textContent));
  // importa os dados locais
  await A.p.click('[data-d="importlocal"]'); await A.p.waitForSelector('#importDlg[open]');
  const impTxt = await A.p.textContent('#importBody'); assert(/diferença máxima/.test(impTxt)); assert(/substitui/.test(impTxt));
  await A.p.screenshot({ path: path.join(OUT, '02-import-375.png') }); await checkContrast(A.p, '#importBody', 'importar (claro)');
  await A.p.click('[data-imp="yes"]'); await A.p.waitForTimeout(600); await waitSynced(A.p);
  assert.strictEqual(be.db.expenses.length, 10); assert.strictEqual(be.db.families.length, 4); assert.strictEqual(be.db.people.length, 14);
  assert(!JSON.stringify(be.db).match(/amendoim|camarão|"veg"|data:image/), 'nenhum dado de saúde/foto no servidor');
  step('importou 4 famílias, 14 pessoas, 10 gastos; nada de dieta/foto no servidor');
  const aNets = await nets(A.p); for (const k in localNets) assert(Math.abs(localNets[k] - aNets[k]) <= 0.01, 'saldo ' + k);
  step('saldos antes/depois da importação batem (R$ 0,01)');
  assert.strictEqual(await A.p.evaluate(() => App.sync().pendingCount()), 0, 'nada pendente depois do eco');

  // ---- B: abre o link com o código, entra e fica aguardando
  const B = await mk('B', 'dark');
  await B.p.goto(BASE + '#' + code); await B.p.waitForSelector('#gateDlg[open]');
  await checkContrast(B.p, '#gateBody', 'entrada (escuro)');
  assert.strictEqual((await B.p.inputValue('#gCode')).replace('-', ''), code); step('link com #código preenche o código');
  await B.p.fill('#gCode', 'ZZZZ2345'); await B.p.fill('#gName', 'Ana'); await B.p.click('#joinForm button[type=submit]');
  await B.p.waitForFunction(() => !document.getElementById('joinErr').hidden); assert(/não confere/.test(await B.p.textContent('#joinErr'))); step('código errado é recusado');
  await B.p.fill('#gCode', code.toLowerCase()); await B.p.fill('#gFam', 'Botelho');
  await Promise.all([B.p.waitForNavigation(), B.p.click('#joinForm button[type=submit]')]);
  await B.p.waitForFunction(() => /Aguardando aprovação/.test(document.getElementById('gateTitle') && document.getElementById('gateTitle').textContent), null, { timeout: 8000 });
  assert.strictEqual(await B.p.evaluate(() => App.getState().expenses.length), 0, 'pendente não recebe gastos');
  assert(/Feriado teste/.test(await B.p.textContent('#gateBody')));
  await B.p.screenshot({ path: path.join(OUT, '03-aguardando-375.png') }); await checkContrast(B.p, '#gateBody', 'aguardando (escuro)'); step('B fica «Aguardando aprovação» e não vê nada');
  // A vê o pendente e aprova
  await A.p.click('#tabbar [data-view="acertos"]');
  await A.p.waitForSelector('[data-m="approve"]', { timeout: 6000 }); assert(/1 aguardando/.test(await A.p.textContent('#dataCard')));
  await A.p.$eval('#dataCard', e => e.scrollIntoView()); await A.p.screenshot({ path: path.join(OUT, '04-membros-375.png') });
  await checkContrast(A.p, '#dataCard', 'painel do organizador (claro)');
  await A.p.click('[data-m="approve"]'); step('organizador vê «1 aguardando» e aprova');
  await B.p.waitForFunction(() => App.getState().expenses.length === 10, null, { timeout: 12000 }); await waitSynced(B.p);
  assert.deepStrictEqual(await nets(B.p), aNets); step('B aprovado: vê os mesmos 10 gastos e saldos');
  assert(!(await B.p.evaluate(() => JSON.stringify(App.getState()))).match(/amendoim|data:image/), 'B não recebe dieta/foto');
  assert(await B.p.isDisabled('[data-d="import"]')); assert(await B.p.isHidden('[data-d="sharelink"]').catch(() => true)); step('B não importa nem vê o código (só o organizador)');

  // ---- B lança um gasto pela tela; A recebe ao vivo
  await B.p.click('#tabbar [data-view="gastos"]'); await B.p.fill('#amt', '87,50'); await B.p.fill('#desc', 'Pão e leite');
  await B.p.click('#submitBtn'); await B.p.waitForTimeout(1200);
  await A.p.waitForFunction(() => App.getState().expenses.some(e => e.description === 'Pão e leite'), null, { timeout: 5000 });
  assert.deepStrictEqual(await nets(A.p), await nets(B.p)); step('gasto lançado no B aparece no A ao vivo; saldos iguais');
  await A.p.click('#tabbar [data-view="acertos"]'); await A.p.click('#xfers [data-settle]'); await A.p.waitForTimeout(1200);
  await B.p.waitForFunction(() => Object.keys(App.getState().settled).length === 1, null, { timeout: 5000 }); step('marcação de acerto sincroniza');

  // ---- offline no A: banner + pendente; B muda o MESMO campo; A volta: vale o servidor + aviso
  await A.ctx.setOffline(true);
  await A.p.click('#tabbar [data-view="gastos"]'); await A.p.fill('#amt', '12'); await A.p.fill('#desc', 'Gelo offline'); await A.p.click('#submitBtn');
  await A.p.waitForFunction(() => document.getElementById('syncPill').textContent === 'Offline', null, { timeout: 6000 });
  assert(!(await A.p.isHidden('#syncBanner'))); assert(/só neste aparelho/.test(await A.p.textContent('#syncBannerText')));
  await A.p.screenshot({ path: path.join(OUT, '05-offline-375.png') }); await checkContrast(A.p, '#syncBanner, #syncPill', 'aviso offline (claro)'); step('sem internet: pílula Offline + aviso de alteração pendente');
  const target = await A.p.evaluate(() => App.getState().expenses.find(e => e.description === 'Pão e leite').id);
  await A.p.evaluate(id => { App.__edit(st => { st.expenses.find(e => e.id === id).amount = 90; }); }, target);
  await B.p.evaluate(id => { App.__edit(st => { st.expenses.find(e => e.id === id).amount = 95; }); }, target);
  await B.p.waitForTimeout(1200); await waitSynced(B.p);
  await A.ctx.setOffline(false); await A.p.evaluate(() => dispatchEvent(new Event('online')));
  await B.p.waitForFunction(() => App.getState().expenses.some(e => e.description === 'Gelo offline'), null, { timeout: 20000 });
  await waitSynced(A.p);
  await A.p.waitForSelector('#noticeBox:not([hidden])', { timeout: 6000 });
  assert(/valeu o valor de lá/.test(await A.p.textContent('#noticeBox')));
  assert.strictEqual(await A.p.evaluate(id => App.getState().expenses.find(e => e.id === id).amount, target), 95, 'mesmo campo: vale o servidor');
  await A.p.screenshot({ path: path.join(OUT, '06-aviso-conflito-375.png') }); await checkContrast(A.p, '#noticeBox', 'aviso de conflito (claro)');
  await A.p.click('[data-nclose]'); assert(await A.p.isHidden('#noticeBox'));
  step('voltou a internet: pendente enviado; mesmo campo editado nos dois = vale o servidor + aviso');

  // ---- travar / destravar
  await A.p.click('#tabbar [data-view="acertos"]'); await A.p.click('[data-d="lock"]');
  await B.p.waitForFunction(() => /travado/.test(document.getElementById('syncBannerText').textContent), null, { timeout: 6000 });
  await B.p.evaluate(() => App.__edit(st => { st.kittyPerFamily = 1234; })); await B.p.waitForTimeout(1200);
  assert.notStrictEqual(await A.p.evaluate(() => App.getState().kittyPerFamily), 1234); assert.notStrictEqual(await B.p.evaluate(() => App.getState().kittyPerFamily), 1234, 'travado: edição desfeita');
  await B.p.screenshot({ path: path.join(OUT, '07-travado-375.png') }); await checkContrast(B.p, '#syncBanner', 'evento travado (escuro)');
  await A.p.click('[data-d="lock"]'); await B.p.waitForFunction(() => !/travado/.test(document.getElementById('syncBannerText').textContent) || document.getElementById('syncBanner').hidden, null, { timeout: 6000 });
  step('travar deixa o evento só leitura para todos; destravar libera');

  // ---- recarregar mantém o evento; ?offline=1 abre o modo local intacto
  await B.p.reload(); await waitSynced(B.p); assert.strictEqual(await B.p.evaluate(() => App.getState().expenses.length), 12); step('recarregar mantém o evento');
  const A2 = await A.ctx.newPage(); await A2.goto(BASE + '?offline=1'); await A2.waitForTimeout(400);
  assert(await A2.isHidden('#syncPill')); assert.strictEqual(await A2.evaluate(() => App.getState().expenses.length), 10, 'cópia local intacta'); step('?offline=1 abre a versão local intacta'); await A2.close();

  // ---- overflow 375 nas telas novas
  for (const [p, n] of [[A.p, 'A'], [B.p, 'B']]) {
    await p.click('#tabbar [data-view="acertos"]'); await p.waitForTimeout(200);
    const over = await p.evaluate(() => { const bad = []; for (const e of document.querySelectorAll('#dataCard *, #top *, #syncBanner *, #noticeBox *')) { if (!e.getClientRects().length || e.tagName === 'INPUT' || e.closest('svg')) continue; const cs = getComputedStyle(e); if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && cs.textOverflow !== 'ellipsis') bad.push(e.tagName + '#' + e.id + '.' + e.className + ' ' + e.scrollWidth + '>' + e.clientWidth); } return bad.concat(document.documentElement.scrollWidth > innerWidth + 1 ? ['page wider than viewport'] : []); });
    assert.deepStrictEqual(over, [], n + ' overflow: ' + over.join(', '));
    await checkContrast(p, '#dataCard, #top, footer', 'Dados ' + n);
    await p.$eval('#dataCard', e => e.scrollIntoView()); await p.screenshot({ path: path.join(OUT, `08-dados-${n}-375.png`) });
  }
  step('sem texto vazando a 375 px (cabeçalho, avisos, card Dados, painel do organizador)');

  // ---- trocar código (pedindo nova aprovação) e remover membro
  await A.p.check('#repend'); await A.p.click('[data-d="rotate"]');
  await A.p.waitForFunction(old => location.hash.slice(1) !== old, code, { timeout: 6000 });
  const code2 = await A.p.evaluate(() => location.hash.slice(1)); assert(/^[A-HJ-NP-Z2-9]{8}$/.test(code2) && code2 !== code);
  await B.p.waitForFunction(() => /Aguardando aprovação/.test((document.getElementById('gateTitle') || {}).textContent || ''), null, { timeout: 8000 });
  step('trocar código com reaprovação: B volta a «Aguardando»');
  const C = await mk('C'); await C.p.goto(BASE + '#' + code); await C.p.waitForSelector('#gCode');
  await C.p.fill('#gName', 'Caio'); await C.p.click('#joinForm button[type=submit]');
  await C.p.waitForFunction(() => !document.getElementById('joinErr').hidden); step('link antigo não entra mais');
  await A.p.waitForSelector('[data-m="approve"]'); await A.p.click('[data-m="approve"]');
  await B.p.waitForFunction(() => App.getState().expenses.length === 12 && !document.getElementById('gateDlg').open, null, { timeout: 12000 });
  await A.p.waitForSelector('[data-m="revoke"]'); await A.p.click('[data-m="revoke"]');
  await B.p.waitForFunction(() => /Acesso removido/.test((document.getElementById('gateTitle') || {}).textContent || ''), null, { timeout: 8000 });
  await B.p.screenshot({ path: path.join(OUT, '09-removido-375.png') }); await checkContrast(B.p, '#gateBody', 'acesso removido (escuro)');
  step('reaprovado volta a ver; removido recebe «Acesso removido» na hora');

  assert.deepStrictEqual(errors, [], 'erros de JS: ' + errors.join(' | '));
  console.log('E2E SHARED TESTS PASSED');
  await b.close(); be.close();
})().catch(async e => { console.error(e); process.exit(1); });
