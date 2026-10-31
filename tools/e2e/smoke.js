// Visits every screen (and each Settings tab) as one person, on desktop and phone sizes, and reports page errors.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
const WHO = process.env.WHO || 'alex@folio.local';
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
    await p.goto(BASE + '/signin'); await p.fill('input[name=email]', WHO); await p.fill('input[name=password]', 'folio-demo');
    await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
    const loans = await (await p.request.get(BASE + '/api/state')).json();
    const pages = ['/', '/loans', '/loans/new', '/accounts', '/accounts/new', '/statements', '/settings', '/profile'].concat((loans.loans || []).concat(loans.archivedLoans || []).map((l) => '/loan?id=' + l.id)).concat((loans.accounts || []).map((a) => '/accounts?id=' + a.id));
    for (const path of pages) {
      errs.length = 0;
      await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(300);
      if (path === '/settings') for (const t of ['Notifications', 'Layouts', 'Lenders', 'Brokers', 'Data and privacy', 'Server']) { const btn = p.locator('button', { hasText: t }).first(); if (await btn.count()) { await btn.click(); await p.waitForTimeout(400); } }
      if (path.startsWith('/loan?')) for (const t of ['Details', 'History', 'Statements', 'Scenarios', 'Overview']) { const btn = p.locator('button', { hasText: new RegExp('^' + t + '$') }).first(); if (await btn.count() && await btn.isVisible()) { await btn.click(); await p.waitForTimeout(300); } }
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (errs.length || wide) { bad++; console.log(vp.width, path, wide ? 'HORIZONTAL SCROLL' : '', errs.slice(0, 3).join(' | ')); }
    }
    await ctx.close();
  }
  console.log(bad ? bad + ' problems' : 'all screens clean');
  await b.close();
})();
