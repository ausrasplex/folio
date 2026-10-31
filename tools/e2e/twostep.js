// Click-through: turn on two-step verification with a real authenticator code, then sign in again with it.
const { chromium } = require('playwright');
const { generate } = require('otplib');
const BASE = process.env.BASE || 'http://localhost:3100';
const WHO = process.env.WHO || 'sam@folio.local';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const logs = []; p.on('pageerror', (e) => logs.push('pageerror ' + e.message));
  const signin = async () => { await p.goto(BASE + '/signin'); await p.fill('input[name=email]', WHO); await p.fill('input[name=password]', 'folio-demo'); await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]); };
  await signin();
  await p.goto(BASE + '/profile', { waitUntil: 'networkidle' });
  await p.click('button:has-text("Set up")'); await p.waitForTimeout(1200);
  await p.screenshot({ path: '/tmp/t1.png' });
  const key = (await p.locator('code').first().textContent()).replace(/\s/g, '');
  const input = p.locator('input[inputmode=numeric], input[autocomplete=one-time-code]').first();
  await input.fill(await generate({ secret: key }));
  await p.click('button:has-text("Verify and turn on")'); await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/t2.png' });
  const codes = (await p.locator('body').innerText()).match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g) || [];
  console.log('recovery codes shown:', codes.length);
  await p.goto(BASE + '/signout'); await signin();
  console.log('after sign in:', p.url());
  // six wrong codes end the sign-in and land on /signin (the fifth already does)
  for (let i = 1; i <= 6; i++) {
    if (!p.url().includes('/twostep')) break;
    await p.fill('input[name=code]', String(100000 + i));
    await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
  }
  console.log('after six wrong codes:', p.url(), p.url().includes('/signin') ? 'OK' : 'FAILED');
  await signin();
  // a code works once: wait for the next 30-second window so this is not the code used to turn two-step on
  await p.waitForTimeout((30 - (Math.floor(Date.now() / 1000) % 30)) * 1000 + 500);
  await p.fill('input[name=code]', await generate({ secret: key }));
  await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
  console.log('after code:', p.url());
  // turn it off again with a recovery code
  await p.goto(BASE + '/profile', { waitUntil: 'networkidle' });
  await p.click('button:has-text("Turn off")'); await p.waitForTimeout(300);
  await p.locator('input[aria-label*="code" i]').last().fill(codes[1] || '');
  await p.locator('button:has-text("Turn off")').last().click(); await p.waitForTimeout(1500);
  console.log('two-step now:', await p.locator('text=Adds a code from an authenticator app').count() ? 'off' : 'still on');
  console.log(logs.join('\n') || 'no page errors');
  await b.close();
})();
