// Forhåndsvisningen af en komplai Run-app i den rigtige app: Auras statiske forhåndsvisning serverer
// /_komplai/run/v1.js med Auras bro foran komplais rigtige app-SDK, læst fra komplai.dk under prøven.
// Integrationen er slået fra som standard. Slået til tilbyder Aura login og derefter at oprette appen,
// og SDK'ets kald går gennem Aura til Hubs forhåndsvisning, her erstattet af en lokal adapter.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const helpers = require('./ui-test-helpers.cjs');
const page = `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>Mødebooking</title><script src="/_komplai/run/v1.js"></script></head><body><h1 id="status">Venter</h1><script>
(async () => {
  const status = document.getElementById('status');
  if (typeof komplai === 'undefined') { status.textContent = 'Uden SDK'; return; }
  try {
    const me = await komplai.me();
    const noter = komplai.data.collection('noter');
    await noter.add({ tekst: 'Fra forhåndsvisningen' });
    const list = await noter.list();
    status.textContent = 'Forbundet · ' + me.name + ' · ' + list.items.length + ' note';
  } catch (error) { status.textContent = 'Fejl · ' + error.code; }
})();
</script></body></html>`;
const manifest = { sdk: 1, uses: { identity: { fields: ['name'], reason: 'Viser, hvem der booker.' }, data: { noter: { scope: 'person', reason: 'Dine noter.' } } } };

(async () => {
  const komplai = process.env.AURA_KOMPLAI_ROOT || path.resolve(__dirname, '../../../komplai.dk');
  const sdk = await fs.readFile(path.join(komplai, 'packages/run/src/run.js'), 'utf8');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-komplai-preview-'))), project = path.join(root, 'moedebooking');
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), page);
  await fs.writeFile(path.join(project, 'public/komplai.json'), JSON.stringify(manifest));
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const window = await app.firstWindow(), errors = [];
    window.on('pageerror', error => errors.push(error.message));
    await helpers.forbidGitWrites(app);
    await app.evaluate(({ dialog }, { project, modulePath, sdk }) => {
      const require = process.getBuiltinModule('module').createRequire(modulePath), { KomplaiDeployment } = require(modulePath);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      // Hubs forhåndsvisning er erstattet; Auras bro, IPC, statiske server og projektkobling kører uændret.
      const calls = globalThis.komplaiPreviewCalls = [], id = '11111111-2222-4333-8444-555555555555', docs = [];
      KomplaiDeployment.prototype.sdkScript = async () => { calls.push(['sdk']); return sdk; };
      KomplaiDeployment.prototype.createApp = async name => { calls.push(['create', name]); return { id, name }; };
      KomplaiDeployment.prototype.preview = async (appId, manifest) => {
        calls.push(['preview', appId, manifest]);
        const expiresAt = Date.now() + 900000;
        return { session: 'session-1', expiresAt: new Date(expiresAt).toISOString(), app: { protocol: 1, app: { id: appId, name: 'Moedebooking', address: 'https://moedebooking.komplai.run', visibility: 'private', version: null }, signIn: null, declared: ['identity', 'data'], session: { expiresAt, theme: null, locale: null } } };
      };
      KomplaiDeployment.prototype.previewCall = async (appId, request) => {
        calls.push(['call', appId, request.capability, request.operation, request.method, request.session, request.input]);
        if (request.capability === 'identity') return { status: 200, body: { memberId: 'm-1', name: 'Rigtig Person' } };
        if (request.operation === 'add') { const doc = { id: '22222222-3333-4444-8555-666666666666', version: 1, createdBy: 'm-1', data: request.input.data }; docs.push(doc); return { status: 200, body: doc }; }
        if (request.operation === 'list') return { status: 200, body: { items: docs, next: null } };
        return { status: 404, body: { error: 'not_found' } };
      };
    }, { project, modulePath: path.resolve(__dirname, '../core/komplai-publish.cjs'), sdk });
    const calls = () => app.evaluate(() => globalThis.komplaiPreviewCalls);
    const status = () => window.frameLocator('#preview').locator('#status');
    const reload = () => window.evaluate(() => { const frame = document.querySelector('#preview'); frame.src = frame.src; });
    const capture = async name => { const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64')); await fs.writeFile(path.join(root, name), Buffer.from(png, 'base64')); };
    await helpers.skipIntroduction(window); await window.click('#open'); await window.waitForSelector('#workspace:not([hidden])');
    // 1. Integrationen er slået fra: SDK-filen findes ikke, og Aura kontakter ikke komplai.
    await status().filter({ hasText: 'Uden SDK' }).waitFor();
    assert.equal(await window.locator('#komplai-preview').isHidden(), true);
    assert.deepEqual(await calls(), [], 'ingen kontakt til komplai, før integrationen er slået til');
    // 2. Slået til uden login: SDK'et indlæses, kaldet afvises, og Aura tilbyder login.
    const saved = await window.evaluate(() => window.harness.featuresSave({ scope: 'alle', values: { 'integration-komplai-run': true } }));
    assert.equal(saved.ok, true, saved.error);
    await reload();
    await window.locator('#komplai-preview').filter({ hasText: 'Log ind med komplai' }).waitFor();
    assert.equal(await status().textContent(), 'Fejl · unavailable');
    assert.deepEqual((await calls()).map(c => c[0]), ['sdk'], 'kun SDK-filen er hentet');
    // 3. Med login men uden app: Aura opretter først appen, når brugeren vælger det.
    await app.evaluate(async ({ app, safeStorage }, { storePath }) => {
      const require = process.getBuiltinModule('module').createRequire(storePath), { Store } = require(storePath);
      const store = new Store(require('node:path').join(app.getPath('userData'), 'harness'), safeStorage);
      await store.update(state => { state.hosting = { ...state.hosting, komplai: { secret: store.encrypt('komp_publish_grant_' + 'a'.repeat(64)), grantId: 'g-1', organisationId: 'o-1', organisationName: 'Syntetisk kommune', address: 'komplai.run', expiresAt: new Date(Date.now() + 86400000).toISOString() } }; });
    }, { storePath: path.resolve(__dirname, '../core/store.cjs') });
    await window.evaluate(() => window.dispatchEvent(new Event('harness:komplai-connected')));
    await window.locator('#komplai-preview').filter({ hasText: 'Opret appen Moedebooking i komplai' }).waitFor();
    assert.equal((await calls()).some(c => c[0] === 'create'), false, 'ingen app uden brugerens valg');
    await capture('komplai-opret.png');
    // 4. Efter oprettelsen svarer Hubs forhåndsvisning med rigtig identitet og forhåndsvisningens egne data.
    await window.click('#komplai-preview');
    await status().filter({ hasText: 'Forbundet' }).waitFor();
    assert.equal(await status().textContent(), 'Forbundet · Rigtig Person · 1 note');
    await window.locator('#komplai-preview').filter({ hasText: 'komplai · Moedebooking · forhåndsvisning' }).waitFor();
    const log = await calls();
    assert.deepEqual(log.filter(c => c[0] === 'create'), [['create', 'Moedebooking']]);
    assert.deepEqual(log.filter(c => c[0] === 'preview').map(c => c[2]), [manifest], 'det lokale komplai.json sendes');
    assert.deepEqual(log.filter(c => c[0] === 'call').map(c => c.slice(2, 6)), [['identity', 'me', 'GET', 'session-1'], ['data', 'add', 'POST', 'session-1'], ['data', 'list', 'POST', 'session-1']]);
    assert.deepEqual(log.find(c => c[3] === 'add')[6], { collection: 'noter', data: { tekst: 'Fra forhåndsvisningen' } });
    assert.deepEqual((await window.evaluate(() => window.harness.komplaiPreviewState())).value.link, { appId: '11111111-2222-4333-8444-555555555555', name: 'Moedebooking' });
    assert.deepEqual(errors, []);
    await helpers.assertNoGitWrites(app);
    await capture('komplai-forhaandsvisning.png');
    console.log(JSON.stringify({ status: 'bestået', root, calls: log.map(c => c[0] === 'call' ? `${c[2]}/${c[3]}` : c[0]), limitations: ['Hubs forhåndsvisning erstattet af lokal adapter', 'komplais rigtige SDK fra komplai.dk', 'login lagt ind i lageret, ikke gennem browseren'] }, null, 2));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
