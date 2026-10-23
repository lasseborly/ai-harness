// Rigtig app, opdateringsklient og HTTP-download. GitHub-adresser omdirigeres kun i testprocessen.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash, randomBytes } = require('node:crypto');
const helpers = require('./ui-test-helpers.cjs');
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-update-ui-')));
  console.log('Testmateriale: ' + root);
  const file = randomBytes(2 * 1024 * 1024), hash = createHash('sha512').update(file).digest('base64');
  let app, page, downloads = 0, corrupt = false;
  // Den tilbudte version udledes af appens egen, så prøven ikke forældes ved en udgivelse.
  const next = require('../package.json').version.replace(/(\d+)$/, (_, n) => Number(n) + 1);
  const info = { version: next, critical: true, message: 'En rettelse til filadgang er klar.', files: [{ url: `https://github.com/ai-alliancen-org/ai-harness/releases/download/v${next}/Aura-${next}-mac-arm64.zip`, sha512: hash, size: file.length }] };
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/feed')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(info)); }
    downloads++; res.setHeader('content-length', file.length);
    const data = corrupt ? Buffer.alloc(file.length) : file;
    for (let start = 0; start < data.length && !res.destroyed; start += 65536) { res.write(data.subarray(start, start + 65536)); await new Promise(resolve => setTimeout(resolve, 40)); }
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverURL = `http://127.0.0.1:${server.address().port}`;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    await helpers.forbidGitWrites(app);
    await helpers.isolateDocuments(app, path.join(root, 'Dokumenter'));
    page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await helpers.skipIntroduction(page);
    // Fang den faktiske controllers tilstand gennem dens eksisterende læsemetode, uden en test-IPC i produktet.
    await app.evaluate(({ app }, directory) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { Updates } = require(app.getAppPath() + '/core/updates.cjs'), original = Updates.prototype.snapshot;
      Updates.prototype.snapshot = function () { global.updateTest = this; Updates.prototype.snapshot = original; return original.call(this); };
    }, root);
    await page.evaluate(() => window.harness.updatesState());
    await app.evaluate(async ({ app, session }, { root, serverURL }) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { MacUpdater } = require(app.getAppPath() + '/node_modules/electron-updater');
      const { DownloadedUpdateHelper } = require(app.getAppPath() + '/node_modules/electron-updater/out/DownloadedUpdateHelper');
      const fs = require('node:fs/promises');
      const updater = new MacUpdater(); updater.forceDevUpdateConfig = true;
      updater.updateConfigPath = root + '/app-update.yml'; await fs.writeFile(root + '/app-update.yml', JSON.stringify({ provider: 'generic', url: serverURL, updaterCacheDirName: 'test' }));
      updater.downloadedUpdateHelper = new DownloadedUpdateHelper(root + '/download-cache');
      session.fromPartition('electron-updater').webRequest.onBeforeRequest((request, callback) => {
        if (request.url.startsWith('https://ai-alliancen-org.github.io/ai-harness/updates/')) return callback({ redirectURL: serverURL + '/feed' });
        if (request.url.startsWith('https://github.com/ai-alliancen-org/ai-harness/releases/download/')) return callback({ redirectURL: serverURL + '/file' });
        callback({ cancel: !request.url.startsWith(serverURL + '/') });
      });
      global.updateTest.enabled = true; global.updateTest.connect(updater); global.updateTest.set({ phase: 'idle' });
      global.updateInstalls = 0; global.updateTest.install = () => { global.updateInstalls++; };
    }, { root, serverURL });
    await page.click('#settings-toggle'); await page.click('#updates-button'); await page.click('#updates-action');
    await page.locator('#updates-action').filter({ hasText: 'Hent opdatering' }).waitFor();
    assert.equal(downloads, 0); assert.equal(await page.isVisible('#updates-warning'), true);
    await page.click('#updates-close'); assert.equal(await page.isVisible('#updates-notice'), true);
    const project = path.join(root, 'Opdateringsprøve');
    await fs.mkdir(path.join(project, 'public'), { recursive: true });
    await fs.writeFile(path.join(project, 'public/index.html'), '<!doctype html><html lang="da"><meta charset="utf-8"><title>Opdateringsprøve</title><h1>Et projekt med bevaret kladde</h1></html>');
    await helpers.openExistingProject(app, page, project);
    await assert.rejects(fs.access(path.join(project, '.git')), { code: 'ENOENT' });
    await page.fill('#prompt', 'Denne kladde skal bevares efter genstart.');
    await page.click('#updates-notice-open');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 720));
    await page.screenshot({ path: path.join(root, 'opdatering.png'), animations: 'disabled' });
    corrupt = true; await page.click('#updates-action');
    await page.locator('#updates-error').filter({ hasText: 'kunne ikke hentes' }).waitFor();
    assert.equal(await app.evaluate(() => global.updateInstalls), 0);
    corrupt = false; await page.click('#updates-action'); await page.locator('#updates-action').filter({ hasText: 'Hent opdatering' }).waitFor();
    await page.click('#updates-action'); await page.locator('#updates-progress:not([hidden])').waitFor();
    await page.screenshot({ path: path.join(root, 'henter.png'), animations: 'disabled' });
    await page.locator('#updates-action').filter({ hasText: 'Genstart og opdatér' }).waitFor();
    const downloaded = await app.evaluate(() => global.updateTest.updater.downloadedUpdateHelper.file);
    assert.equal(createHash('sha512').update(await fs.readFile(downloaded)).digest('base64'), hash);
    await app.evaluate(() => { global.updateBusy = global.updateTest.busy; global.updateTest.busy = () => true; });
    await page.click('#updates-action'); await page.locator('#updates-error').filter({ hasText: 'igangværende' }).waitFor();
    assert.equal(await app.evaluate(() => global.updateInstalls), 0);
    await app.evaluate(() => { global.updateTest.busy = global.updateBusy; });
    await page.click('#updates-close');
    assert.equal(await page.inputValue('#prompt'), 'Denne kladde skal bevares efter genstart.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1), false);
    await page.click('#updates-notice-open'); await page.click('#updates-action');
    await page.waitForFunction(() => document.querySelector('#updates-status').textContent.includes('genstart'));
    assert.equal(await app.evaluate(() => global.updateInstalls), 1);
    assert.deepEqual(errors, []);
    await helpers.assertNoGitWrites(app);
    const key = createHash('sha256').update(project).digest('hex');
    const workspace = path.join(root, 'appdata/harness/workspaces', key);
    const record = JSON.parse(await fs.readFile(workspace + '.json', 'utf8'));
    const chat = JSON.parse(await fs.readFile(path.join(workspace + '-chats', record.active + '.json'), 'utf8'));
    assert.equal(chat.draft, 'Denne kladde skal bevares efter genstart.');
    console.log(JSON.stringify({ status: 'bestået', root, project, downloads, checks: ['ingen automatisk download', 'kritisk advarsel uden blokering', 'rigtig HTTP-download og SHA-512-afvisning', 'status og fremdrift i Electron', 'genstart venter på arbejde', 'kladde gemt før genstart', '980 × 720 uden overløb'], limitation: 'Installationskaldet er opsamlet. Filen er syntetisk; native installation testes særskilt med signerede pakker.' }));
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
