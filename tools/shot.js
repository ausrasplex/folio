// Usage: node tools/shot.js <path> <out.png> [width] [height] [clicks as JSON array of selectors/texts]
const { chromium } = require('playwright');
(async () => {
  const [, , path, out, w = '1280', h = '1400', steps = '[]'] = process.argv;
  const b = await chromium.launch();
  const fs = require('fs');
  const state = '/tmp/folio-auth.json';
  const who = process.env.WHO || 'alex';
  const sfile = state.replace('.json', '-' + who + '.json');
  const ctx = await b.newContext({ viewport: { width: +w, height: +h }, storageState: fs.existsSync(sfile) ? sfile : undefined });
  const p = await ctx.newPage();
  if (!fs.existsSync(sfile)) {
    await p.goto('http://localhost:3100/signin');
    await p.fill('input[name=email]', who + '@folio.local');
    await p.fill('input[name=password]', 'folio-demo');
    await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
    await ctx.storageState({ path: sfile });
  }
  const logs = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  p.on('pageerror', (e) => logs.push('pageerror: ' + e.message.slice(0, 400)));
  let pendingFiles = [];
  p.on('filechooser', async (fc) => { await fc.setFiles(pendingFiles); });
  await p.goto('http://localhost:3100' + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  for (const s of JSON.parse(steps)) {
    try {
      if (s.startsWith('text=')) await p.getByText(s.slice(5), { exact: false }).first().click();
      else if (s.startsWith('fill:')) { const [sel, val] = s.slice(5).split('=>'); await p.fill(sel, val); }
      else if (s.startsWith('file:')) { pendingFiles = s.slice(5).split('|'); continue; }
      else if (s.startsWith('eval:')) { logs.push('eval: ' + JSON.stringify(await p.evaluate(s.slice(5))).slice(0, 400)); continue; }
      else if (s.startsWith('wait:')) await p.waitForTimeout(+s.slice(5));
      else await p.click(s);
      await p.waitForTimeout(400);
    } catch (e) { logs.push('step failed ' + s + ': ' + e.message.split('\n')[0]); }
  }
  await p.screenshot({ path: out, fullPage: true });
  console.log(logs.slice(0, 25).join('\n') || 'no console errors');
  await b.close();
})();
