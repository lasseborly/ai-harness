// Bygger kun en lokal side fra eksplicitte GitHub-metadata. Opretter eller udgiver ingen release.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { build } = require('../../scripts/build-pages.cjs');
const { auditUI } = require('./ui-audit.cjs');
(async () => {
  assert.equal(process.argv.length, 4, 'Angiv release- og repository-JSON hentet fra GitHub');
  const releases = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const metadata = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-demo-web-'));
  const site = await build(releases, metadata, path.join(root, 'site'));
  const errors = [], screens = [];
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'), file = path.resolve(site, '.' + decodeURIComponent(url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
      if (!file.startsWith(site + path.sep)) { res.writeHead(403); return res.end(); }
      const type = path.extname(file); res.setHeader('content-type', ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json' })[type] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage(); const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    page.on('pageerror', e => errors.push(e.message));
    const links = new Set();
    for (const width of [1280, 390]) for (const file of ['index.html', 'desktop.html', 'terminal.html', 'pakker.html', 'skills.html', 'vaerktoejer.html']) {
      await page.setViewportSize({ width, height: 844 }); await page.goto(origin + '/' + file);
      if (file === 'terminal.html') await page.waitForURL('**/desktop.html#terminal');
      await page.locator('main').waitFor();
      assert.equal(await page.locator('main').count(), 1);
      const audit = await page.evaluate(auditUI, 'body');
      assert.deepEqual(audit.unnamed, [], `${file}: navngivne kontroller`);
      assert.equal(audit.horizontalOverflow, false, `${file}: intet vandret overløb ved ${width}`);
      for (const url of await page.locator('a[href]').evaluateAll(els => els.map(el => el.href))) if (url.startsWith(origin)) links.add(url);
      const image = path.join(root, `${width}-${file}.png`); await page.screenshot({ path: image, fullPage: true }); screens.push({ file, width, image, audit });
      if (file === 'desktop.html') {
        if (!releases.some(r => !r.draft && r.assets?.length)) assert.equal(await page.locator('.artifact').count(), 0, 'Ingen opdigtede installationsfiler');
        assert.match(await page.locator('body').innerText(), /Beta/);
      }
    }
    for (const url of links) {
      const response = await page.request.get(url); assert.equal(response.ok(), true, `Lokalt link findes: ${url}`);
    }
    // Følg de to faktiske brugsveje, og kræv et fungerende springlink.
    await page.goto(origin);
    await page.locator('a.skip').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => location.hash), '#valg');
    assert.equal(await page.locator('.choices .choice-link').count(), 2);
    await page.locator('.choices .choice-link').nth(0).click();
    assert.equal(new URL(page.url()).pathname, '/pakker.html');
    await page.goto(origin);
    await page.locator('.choices .choice-link').nth(1).click();
    assert.equal(new URL(page.url()).hash, '#arbejdsomraade');
    assert.equal(await page.locator('#workspace-title').isVisible(), true);
    await page.getByRole('link', { name: 'Se installation og betastatus →' }).click();
    assert.equal(new URL(page.url()).hash, '#desktop');
    await page.getByRole('link', { name: 'Installation og hjælp →' }).click();
    assert.equal(new URL(page.url()).pathname, '/desktop.html');
    await page.locator('.beta-details:not(.version-history) > summary').click();
    assert.equal(await page.getByRole('link', { name: 'Læs betastatus og kendte begrænsninger ↗' }).count(), 1);
    await page.locator('.beta-details:not(.version-history) > summary').click();
    await page.getByText('Tidligere versioner', { exact: true }).click();
    assert.equal(await page.locator('.version-history li').count(), 9);
    await page.screenshot({ path: path.join(root, 'versionshistorik.png'), fullPage: true });
    // App og terminal deler side; gamle terminallinks vælger stadig terminalen.
    assert.equal(await page.getByRole('tab').count(), 2);
    assert.equal(await page.locator('#app').isVisible(), true);
    await page.getByRole('tab', { name: /^Terminal/ }).click();
    assert.equal(await page.locator('#terminal').isVisible(), true);
    assert.equal(await page.locator('#app').isVisible(), false);
    assert.equal(await page.locator('.platform').count(), 3);
    await page.goBack();
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.getByRole('tab', { name: /^App/ }).focus();
    await page.keyboard.press('End');
    assert.equal(await page.locator('#terminal-choice').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#app-choice').getAttribute('aria-selected'), 'true');
    await page.goto(origin + '/terminal.html');
    await page.waitForURL('**/desktop.html#terminal');
    await page.locator('#terminal').waitFor({ state: 'visible' });
    assert.doesNotMatch(await page.locator('body').innerText(), /Endnu ikke afprøvet|Intel-Mac mangler|Downloadknapper vises/);
    const noScript = await browser.newContext({ javaScriptEnabled: false });
    const fallback = await noScript.newPage();
    await fallback.goto(origin + '/desktop.html');
    assert.equal(await fallback.locator('#app').isVisible(), true);
    assert.equal(await fallback.locator('#terminal').isVisible(), true);
    await noScript.close();
    await page.goto(origin);
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.screenshot({ path: path.join(root, 'forside.png') });
    assert.deepEqual(errors, []);
    const report = { status: 'bestået', root, screens, localLinks: links.size, primaryChoices: 2, journeys: ['Webguide', 'App og betastatus'], skipLink: '#valg', errors, private: metadata.private, published: false, limitation: 'Lokal visning; ikke installation eller adgang fra en testpersons konto.' };
    await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
