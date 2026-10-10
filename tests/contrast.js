// WCAG contrast audit of every visible text element (and key non-text UI) in both themes.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  let fail = 0;
  for (const theme of ['light', 'dark']) {
    for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      const p = await b.newPage({ viewport: vp, colorScheme: theme });
      await p.goto('file://' + require('path').join(__dirname, '..', 'index.html')); await p.waitForTimeout(900);
      await p.evaluate(() => { document.querySelectorAll('.view,[data-panel]').forEach(v => v.hidden = false); document.getElementById('recParse') && (document.getElementById('recPaste').value = '1 xícara de arroz\nalgo sem medida', document.getElementById('recParse').click()); document.querySelectorAll('details').forEach(d => d.open = true); document.getElementById('top').classList.add('scrolled');
        document.querySelector('.err').classList.add('on'); document.querySelectorAll('.toptotal').forEach(e => e.style.transition = 'none'); });
      await p.waitForTimeout(400);
      const res = await p.evaluate(() => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1; const ctx = cv.getContext('2d', { willReadFrequently: true });
        const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
        const paint = (el, fg) => {
          const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(getComputedStyle(e).backgroundColor);
          ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg'); ctx.fillRect(0, 0, 1, 1);
          for (const c of chain) { ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); }
          const bg = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
          ctx.fillStyle = fg; ctx.fillRect(0, 0, 1, 1);
          const f = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
          return ratio(f, bg);
        };
        const out = [], seen = new Set();
        const all = [...document.querySelectorAll('body *')].filter(el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
        for (const el of all) {
          const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
          if (!txt) continue;
          const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
          const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, large = size >= 24 || (bold && size >= 18.66);
          const r = paint(el, cs.color), need = large ? 3 : 4.5;
          const key = el.className + '|' + txt.slice(0, 20);
          if (!seen.has(key)) { seen.add(key); out.push({ t: txt.slice(0, 28), cls: (el.tagName + '.' + el.className).slice(0, 30), r: +r.toFixed(2), need }); }
        }
        for (const el of document.querySelectorAll('input.inp')) { if (el.offsetParent === null || el.value) continue; const r = paint(el, getComputedStyle(el, '::placeholder').color); out.push({ t: 'placeholder ' + el.id, cls: 'INPUT', r: +r.toFixed(2), need: 4.5 }); }
        // non-text: chart segments / swatches vs card surface, accent button vs surface (3:1)
        for (const el of document.querySelectorAll('.legend .sw')) out.push({ t: 'swatch ' + el.parentElement.textContent.trim().split(' ')[0], cls: 'non-text', r: +paint(el.parentElement, getComputedStyle(el).backgroundColor).toFixed(2), need: 3 });
        const pb = document.querySelector('.btn.primary'); out.push({ t: 'primary btn bg vs card', cls: 'non-text', r: +paint(pb.parentElement, getComputedStyle(pb).backgroundColor).toFixed(2), need: 3 });
        const sw = document.querySelector('.switch input:checked'); out.push({ t: 'switch on vs card', cls: 'non-text', r: +paint(sw.parentElement, getComputedStyle(sw).backgroundColor).toFixed(2), need: 3 });
        return out;
      });
      const bad = res.filter(x => x.r < x.need);
      const min = res.filter(x => x.cls !== 'non-text').reduce((m, x) => Math.min(m, x.r), 99);
      console.log(`${theme} ${vp.width}px: ${res.length} checks, min TEXT ratio ${min.toFixed(2)}, failures ${bad.length}`);
      bad.forEach(x => console.log('   FAIL', x)); fail += bad.length;
      if (vp.width === 390) { const pick = n => res.filter(x => x.t.includes(n)).map(x => x.r); console.log('   samples: text-3', pick('pessoa')[0], '| pos', pick('+R$')[0], '| neg', pick('−R$')[0], '| btn', pick('Adicionar despesa')[0], '| swatches', res.filter(x => x.t.startsWith('swatch')).map(x => x.r).join('/')); }
      await p.close();
    }
  }
  await b.close(); console.log(fail ? 'CONTRAST FAILURES: ' + fail : 'ALL CONTRAST CHECKS PASS (AA)');
})();
