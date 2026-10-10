const { chromium } = require('playwright-core');
require('fs').mkdirSync(require('path').join(__dirname, '..', 'shots'), { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const url = process.env.URL || 'file://' + require('path').join(__dirname, '..', 'index.html');
  const errs = [];
  const theme = process.env.THEME || 'dark';
  const p = await b.newPage({ viewport: { width: +(process.env.W || 375), height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push('console: ' + m.text()));
  await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); if (process.env.WIDE) await p.addStyleTag({ content: '*{font-family:"DejaVu Sans",sans-serif!important;letter-spacing:.01em}html{font-size:110%}' }); await p.waitForTimeout(900);
  const sw = async n => { const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > +(process.env.W || 375)) errs.push(n + ' scrollWidth ' + w); };
  const audit = async n => { const bad = await p.evaluate(() => { const W = innerWidth, out = [];
      for (const el of document.querySelectorAll('main *, dialog[open] *')) { if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue; if (el.closest('.mxwrap') || el.closest('.sr,.sr-only')) continue;
        const r = el.getBoundingClientRect(); if (r.width && r.right > W + 1) out.push('edge:' + el.tagName + '.' + el.className + ' ' + Math.round(r.right)); const cd = el.closest('.card'); if (cd && el !== cd && r.width) { const cr = cd.getBoundingClientRect(); if (r.right > cr.right + 1 || r.left < cr.left - 1) out.push('card:' + el.tagName + '.' + el.className + '#' + el.id); }
        if ((el.matches('button,.btn,.badge,.t1,.t2,.amt,.v,.pills button,.rchip')) && el.scrollWidth > el.clientWidth + 1) out.push('clip:' + el.tagName + '.' + el.className + ' "' + el.textContent.trim().slice(0, 30) + '"'); }
      return [...new Set(out)].slice(0, 12); }); if (bad.length) errs.push(n + ': ' + bad.join(' | ')); };
  const FULLCSS = '.toast{display:none!important}.tabbar{display:none!important}.top{position:relative!important}';
  const S = async (n, full = false) => { await sw(n); await audit(n); let h = await p.addStyleTag({ content: full ? FULLCSS : '.toast{display:none!important}' }); await p.screenshot({ path: require('path').join(__dirname, '..', 'shots') + `/${process.env.W ? process.env.W + (process.env.WIDE ? 'w' : '') + '-' : ''}${theme}-${n}.png`, fullPage: full }); if (h) await h.evaluate(e => e.remove()); };
  await S('inicio', true); await S('inicio-vp');
  await p.evaluate(() => { App.setView('planejar'); App.setSub('cardapio'); }); await p.waitForTimeout(300);
  await p.click('#matrix [data-day="2026-12-31"][data-meal="jantar"]'); await p.waitForTimeout(500);
  await p.evaluate(() => window.scrollTo(0, 0)); await S('planejar-grid', true); await S('planejar-grid-vp');
  await p.evaluate(() => document.querySelector('#dayCard').scrollIntoView({ block: 'start' })); await p.evaluate(() => window.scrollBy(0, -64)); await S('planejar-dia-vp');
  await p.evaluate(() => App.setSub('receitas')); await p.waitForTimeout(200); await S('receitas', true);
  await p.fill('#recPaste', `Escondidinho de carne seca 🍲
Rende 6 a 8 porções

Ingredientes:
• 1 kg de mandioca
• 400 g de carne seca dessalgada
• 1 e 1/2 xícara de leite
• 2 colheres (sopa) de manteiga
• ½ cebola picada
• 2 a 3 dentes de alho
• 1 lata de creme de leite
• 200 g de queijo mussarela
• Sal e pimenta a gosto
• um punhado bom de amor
• queijo ralado para gratinar

Modo de preparo:
1. Cozinhe a mandioca e amasse com leite e manteiga.
2. Refogue a carne seca com cebola e alho.
3. Monte camadas, cubra com queijo e leve ao forno.`);
  await p.click('#recParse'); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#recEditor').scrollIntoView({ block: 'start' })); await p.waitForTimeout(300); await S('receita-parsed');
  await p.evaluate(() => window.scrollBy(0, 640)); await p.waitForTimeout(200); await S('receita-parsed-2');
  await p.evaluate(() => App.setSub('compras')); await p.waitForTimeout(300); await p.evaluate(() => window.scrollTo(0, 0)); await S('compras', true); await S('compras-vp');
  await p.click('#shopRange [data-rng="next"]'); await p.waitForTimeout(200); await S('compras-hoje-vp'); await p.click('#shopRange [data-rng="all"]');
  await p.evaluate(() => App.setSub('pessoas')); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector('#people details.memd:nth-of-type(4)')?.setAttribute('open', '')); await S('pessoas', true);
  await p.evaluate(() => { App.setSub('cardapio'); App.openCook({ day: '2026-12-31', meal: 'jantar' }); }); await p.waitForTimeout(400); await S('cozinha');
  await p.evaluate(() => document.querySelector('#cookDlg').close());
  await p.evaluate(() => App.setView('gastos')); await p.waitForTimeout(200); await S('gastos', true);
  await p.evaluate(() => App.setView('acertos')); await p.waitForTimeout(300); await S('acertos', true); await p.evaluate(() => window.scrollTo(0, 0)); await S('acertos-vp');
  // desktop
  const d = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
  d.on('pageerror', e => errs.push('desktop: ' + e.message));
  await d.goto(url); await d.waitForTimeout(700);
  for (const v of ['inicio', 'planejar', 'acertos']) { await d.evaluate(v => { App.setView(v); if (v === 'planejar') App.setSub('cardapio'); }, v); await d.waitForTimeout(300); await d.screenshot({ path: require('path').join(__dirname, '..', 'shots') + `/${theme}-desktop-${v}.png`, fullPage: true }); }
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
