// Click-through on an empty database: first-run setup, an empty Loans page, adding a lender and a loan, importing its statement.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/loans'); console.log('first visit lands on', new URL(p.url()).pathname);
  await p.fill('input[name=name]', 'Pat Example'); await p.fill('input[name=email]', 'pat@example.test'); await p.fill('input[name=password]', 'correct-horse-battery');
  await p.fill('input[name=household]', 'Test household');
  await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
  await p.waitForLoadState('networkidle'); console.log('after setup', new URL(p.url()).pathname);
  await p.screenshot({ path: '/tmp/f1.png', fullPage: true });
  for (const path of ['/accounts', '/statements', '/settings', '/profile', '/loans/new', '/accounts/new']) { await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(300); }
  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  for (const t of ['Layouts', 'Lenders', 'Brokers', 'Server']) { await p.locator('button', { hasText: t }).first().click(); await p.waitForTimeout(400); await p.screenshot({ path: '/tmp/f-' + t + '.png', fullPage: true }); }
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})();
