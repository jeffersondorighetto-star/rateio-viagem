// Overflow audit: widths x font modes (default, and wide "iOS-like": DejaVu Sans, +10% size).
const { chromium } = require('playwright-core');
const URL = process.argv[2] || 'file://' + require('path').join(__dirname, '..', 'index.html');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  let total = 0;
  for (const theme of ['dark', 'light']) for (const wide of [false, true]) for (const w of [320, 360, 375, 390, 430, 768, 1280]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 }, isMobile: w < 800, colorScheme: theme });
    await p.goto(URL); await p.waitForTimeout(500);
    const r = await p.evaluate(async wide => {
      document.querySelectorAll('details').forEach(d => d.open = true);
      document.getElementById('top').classList.add('scrolled');
      if (wide) {
        const els = [...document.querySelectorAll('body *')];
        const sizes = els.map(e => parseFloat(getComputedStyle(e).fontSize));
        els.forEach((e, i) => { e.style.fontSize = (sizes[i] * 1.1) + 'px'; });
        const st = document.createElement('style'); st.textContent = '*{font-family:"DejaVu Sans",sans-serif!important;letter-spacing:.01em}'; document.head.appendChild(st);
      }
      await new Promise(r => setTimeout(r, 300));
      const issues = [], trunc = [];
      const vis = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
      const name = e => (e.tagName + (e.id ? '#' + e.id : '') + '.' + String(e.className).trim().replace(/\s+/g, '.')).slice(0, 40) + ' "' + (e.textContent || '').trim().slice(0, 24) + '"';
      for (const e of document.querySelectorAll('body *')) {
        if (!vis(e) || e.matches('.sr') || e.closest('svg') || ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'svg'].includes(e.tagName)) continue;
        const cs = getComputedStyle(e);
        if (e.matches('.sugg') || ['auto', 'scroll'].includes(cs.overflowX)) continue;
        if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) (cs.textOverflow === 'ellipsis' ? trunc : issues).push(name(e) + ` ${e.scrollWidth}>${e.clientWidth}`);
      }
      // children escaping interactive boxes / pills / chips
      for (const e of document.querySelectorAll('button, .btn, .tag, .chk, .seg button, .sugg button, .bal, .av')) {
        if (!vis(e)) continue; const R = e.getBoundingClientRect();
        for (const c of e.querySelectorAll('*')) { if (!vis(c)) continue; const q = c.getBoundingClientRect();
          if (q.left < R.left - 0.5 || q.right > R.right + 0.5 || q.top < R.top - 0.5 || q.bottom > R.bottom + 0.5) { issues.push('escapes ' + name(e)); break; } }
      }
      // sibling overlap among grid/flex items in chip and action groups
      for (const g of document.querySelectorAll('.seg, .actions, .formactions, .stats, .xf, .li')) {
        const kids = [...g.children].filter(vis).map(k => k.getBoundingClientRect());
        for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i], c = kids[j];
          if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1 && !g.matches('.avs')) issues.push('overlap in ' + name(g)); }
      }
      return { issues: [...new Set(issues)].filter(x => !x.includes('avs')), trunc: [...new Set(trunc)], doc: document.documentElement.scrollWidth, vw: innerWidth };
    }, wide);
    const pageOverflow = r.doc > r.vw;
    const n = r.issues.length + (pageOverflow ? 1 : 0); total += n;
    console.log(`${theme} ${wide ? 'wide' : 'std '} ${w}px: ${n ? 'ISSUES ' + n : 'ok'}${pageOverflow ? ' page ' + r.doc + '>' + r.vw : ''}${r.trunc.length ? ' (ellipsis-truncated: ' + r.trunc.length + ')' : ''}`);
    r.issues.forEach(x => console.log('    ', x)); if (wide && w === 320) r.trunc.forEach(x => console.log('     trunc', x));
    await p.close();
  }
  await b.close(); console.log(total ? 'OVERFLOW ISSUES: ' + total : 'NO OVERFLOW ANYWHERE');
})();
