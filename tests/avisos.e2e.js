// Avisos de sulfitos e 18+ sempre à vista: em «Hoje à mesa» e no cartão da garrafa de casa ficam fora do bloco recolhível.
// Dados fictícios; o navegador de teste é descartado no fim.
const { chromium } = require('playwright-core'), assert = require('assert'), path = require('path');
const URL = 'file://' + path.join(__dirname, '..', 'index.html');
assert(require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').includes('const PREVIEW_EXEMPLOS = false;'), 'exemplo da mesa só liga na prévia');
const SULF = 'Vinho contém sulfitos: quem tem sensibilidade confere o rótulo antes de servir.', AGE = 'Bebida alcoólica só para maiores de 18 anos. Beba com moderação.';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const width of [375, 1280]) {
    const ctx = await b.newContext({ viewport: { width, height: 900 } }), p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.waitForTimeout(600); await p.click('[data-view="chef"]'); await p.waitForTimeout(300);
    const fams = await p.evaluate(() => App.getState().families.map(f => f.id));
    await p.evaluate(() => document.querySelector('#homeCellar').scrollIntoView()); await p.click('[data-hc-add]'); await p.waitForTimeout(200);
    await p.fill('#hcName', 'Soalheiro Primeiras Vinhas'); await p.fill('#hcVintage', '2023'); await p.fill('#hcBottles', '2');
    if (!(await p.$eval('#hcStyle', s => s.value))) await p.selectOption('#hcStyle', 'st_branco_fresco');
    await p.selectOption('#hcFam', fams[0]); await p.click('#cellarForm button[type="submit"]'); await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const vis = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]');
      const warn = root => [...root.querySelectorAll('[data-aviso]')].map(e => ({ t: e.textContent, vis: vis(e), inCollapse: !!e.closest('#hojeServ, .hcsvcbox, [role="region"]') }));
      const home = document.querySelector('#hojeCard .hojehome'), btn = document.querySelector('[data-hoje-serv]'), panel = btn && document.getElementById(btn.getAttribute('aria-controls'));
      const item = document.querySelector('#homeCellar .hcitem'), sbtn = item && item.querySelector('[data-hc-svc]'), spanel = sbtn && document.getElementById(sbtn.getAttribute('aria-controls'));
      return { home: !!home, hoje: home ? warn(home) : [], btn: btn && [btn.getAttribute('aria-expanded'), !!panel, panel && panel.hidden, panel && /sulfitos|18 anos/.test(panel.textContent)],
        card: item ? warn(item) : [], sbtn: sbtn && [sbtn.getAttribute('aria-expanded'), !!spanel, spanel && spanel.hidden, spanel && /sulfitos|18 anos/.test(spanel.textContent)] };
    });
    assert(r.home, 'Hoje à mesa sem garrafa de casa');
    for (const [where, ws] of [['Hoje à mesa', r.hoje], ['cartão da garrafa', r.card]]) {
      assert.deepStrictEqual(ws.map(w => w.t), [SULF, AGE], `${where}: os dois avisos, com o texto idêntico`);
      for (const w of ws) { assert(w.vis, `${where}: aviso visível por padrão: ${w.t}`); assert(!w.inCollapse, `${where}: aviso fora do bloco recolhível: ${w.t}`); } }
    assert.deepStrictEqual(r.btn, ['false', true, true, false], 'Como servir: fechado por padrão, aria-expanded/aria-controls, sem os avisos dentro');
    if (r.sbtn) assert.deepStrictEqual(r.sbtn, ['false', true, true, false], 'Serviço da garrafa: recolhível, sem os avisos dentro');
    // abrir e fechar o «Como servir» não esconde os avisos
    await p.click('[data-hoje-serv]'); await p.waitForTimeout(150);
    assert.equal(await p.$eval('[data-hoje-serv]', x => x.getAttribute('aria-expanded')), 'true');
    await p.click('[data-hoje-serv]'); await p.waitForTimeout(150);
    assert(await p.$$eval('#hojeCard [data-aviso]', xs => xs.length === 2 && xs.every(x => x.getClientRects().length && !x.closest('[hidden]'))), 'avisos seguem à vista depois de fechar');
    assert(!errs.length, errs.join(' / ')); await ctx.close(); }
  await b.close(); console.log('AVISOS E2E PASSED (sulfitos e 18+ à vista em Hoje à mesa e no cartão da garrafa, fora do recolhível, 375 e 1280)');
})().catch(e => { console.error(e); process.exit(1); });
