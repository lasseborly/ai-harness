// Forhåndsvisningen af en Promte-app i den rigtige app: Aura svarer kun appens init med integrationen slået til,
// beder om login, opretter appen efter brugerens klik og sender appens kald videre. Promtes netværk er erstattet af lokale adaptere.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const helpers = require('./ui-test-helpers.cjs');
// Siden opfører sig som @promte/app-library: init, indstillinger og kald gennem forælderen.
const page = `<!doctype html><meta charset="utf-8"><h1 id="status">Venter på Promte</h1><script>
let settings = null;
window.previewResults = {};
const waiting = new Map();
window.probePromte = id => new Promise(resolve => {
  waiting.set(id, resolve);
  parent.postMessage({ type: 'promte-fetch-request', id, path: 'app-api/models?type=llm', method: 'GET', headers: [['accept', 'application/json']], body: null }, '*');
});
const ask = setInterval(() => { if (!settings) parent.postMessage({ type: 'init', fetchProxy: true }, '*'); }, 300);
addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'set-settings' && event.source === parent) {
    settings = data.value; clearInterval(ask);
    parent.postMessage({ type: 'promte-fetch-request', id: 'm1', path: 'app-api/models?type=llm', method: 'GET', headers: [['accept', 'application/json']], body: null }, event.origin);
  }
  if (data.type === 'promte-fetch-response') {
    const result = data.error ? { error: data.error } : JSON.parse(new TextDecoder().decode(data.body));
    window.previewResults[data.id] = result; waiting.get(data.id)?.(result); waiting.delete(data.id);
    if (data.id === 'm1' && !result.error) document.getElementById('status').textContent = 'Forbundet · ' + settings.workspaceId + ' · ' + settings.backendUrl + ' · ' + result.models.map(m => m.label).join(', ');
  }
});
</script>`;
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-promte-preview-'))), project = path.join(root, 'moedereferat'); let app, server;
  await fs.mkdir(project); await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'moedereferat', private: true, devDependencies: { '@promte/app-library': '^0.1.6' } }));
  server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const window = await app.firstWindow(), errors = [];
    await helpers.forbidGitWrites(app);
    window.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ dialog }, { project, modulePath }) => {
      const require = process.getBuiltinModule('module').createRequire(modulePath), { PromtePreview } = require(modulePath);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      // Kun browser og HTTP-transport kontrolleres. Login, krypteret lager, oprettelse,
      // token-cache, API-proxy og rendererens bro er produktionskoden.
      const calls = globalThis.promtePreviewCalls = [];
      const fixture = globalThis.promteFixture = { flows: [], autoApprove: true, nextAccount: 'initial', appTokens: new Map() };
      const token = account => 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ uid: account, exp: 4070908800 })).toString('base64url') + '.syntetisk';
      const approved = account => ({ state: 'approved', token: token(account), email: account + '@example.invalid' });
      fixture.approve = account => fixture.flows.find(flow => flow.account === account).resolve(approved(account));
      const transport = async (url, options) => {
        const target = new URL(url), host = target.origin, route = target.pathname;
        const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
        if (route === '/api/extension-auth/start') {
          const flow = { id: 'flow-' + fixture.flows.length, account: fixture.nextAccount };
          flow.status = new Promise(resolve => { flow.resolve = resolve; });
          fixture.flows.push(flow); calls.push(['login', host]);
          if (fixture.autoApprove) flow.resolve(approved(flow.account));
          return json({ flowId: flow.id, flowSecret: 'syntetisk', approveUrl: host + '/extension-connect?flow=' + flow.id, pollIntervalMs: 1000 });
        }
        if (route === '/api/extension-auth/status') {
          const flow = fixture.flows.find(flow => flow.id === target.searchParams.get('flowId'));
          flow.polling = true; return json(await flow.status);
        }
        if (route === '/api/addDoc') { const data = JSON.parse(options.body).data; calls.push(['create', host, data.name]); return json({ id: 'ws-ny' }); }
        if (route === '/api/functions/generateToken') {
          const account = JSON.parse(Buffer.from(options.headers.Authorization.split('.')[1], 'base64url').toString()).uid;
          const value = 'app-token-' + fixture.appTokens.size;
          fixture.appTokens.set(value, account); calls.push(['token', account]); return json({ token: value });
        }
        if (route === '/api/app-api/models') {
          const account = fixture.appTokens.get(options.headers.Authorization.replace(/^Bearer /, ''));
          if (!account) throw Error('Ukendt syntetisk app-token');
          calls.push(['fetch', target.pathname.slice('/api/'.length) + target.search, options.method]);
          return json({ models: [{ label: 'GPT test' }, { label: 'Claude test' }], account });
        }
        throw Error('Uventet Promte-kald: ' + route);
      };
      const connect = PromtePreview.prototype.connect;
      PromtePreview.prototype.connect = async function (root, options) {
        if (!fixture.setup) {
          fixture.preview = this; fixture.setup = this.setup;
          this.setup.reader = this.setup.client.reader = async () => null;
          this.lookup = this.setup.client.lookup = async () => [{ address: '93.184.215.14', family: 4 }];
          this.fetcher = this.setup.client.fetcher = transport;
          this.setup.sleep = async () => {};
          this.setup.openBrowser = async url => { calls.push(['browser', new URL(url).origin]); };
        }
        calls.push(['connect', root]); return connect.call(this, root, options);
      };
    }, { project, modulePath: path.resolve(__dirname, '../core/promte-preview.cjs') });
    const calls = () => app.evaluate(() => globalThis.promtePreviewCalls);
    const waitFlow = async account => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (await app.evaluate((_electron, account) => globalThis.promteFixture.flows.some(flow => flow.account === account && flow.polling), account)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw Error('Loginforsøget blev ikke startet: ' + account);
    };
    const capture = async name => { const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64')); await fs.writeFile(path.join(root, name), Buffer.from(png, 'base64')); };
    await helpers.skipIntroduction(window); await window.click('#open'); await window.waitForSelector('#workspace:not([hidden])');
    await helpers.menuClick(window, '#attach-preview'); await window.fill('#preview-url', `http://127.0.0.1:${server.address().port}/`); await window.click('#preview-form button[type="submit"]');
    // 1. Promte-integrationen er slået fra som standard: Aura svarer ikke appen og kontakter ikke Promte.
    for (let i = 0; i < 50 && !(await calls()).some(c => c[0] === 'connect'); i++) await new Promise(resolve => setTimeout(resolve, 100));
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.ok((await calls()).some(c => c[0] === 'connect'), 'appen spurgte om forbindelse');
    assert.deepEqual((await calls()).filter(c => c[0] !== 'connect'), [], 'ingen kontakt til Promte, før integrationen er slået til');
    assert.equal(await window.locator('#promte-preview').isHidden(), true);
    assert.equal(await window.frameLocator('#preview').locator('#status').textContent(), 'Venter på Promte');
    // 2. Med integrationen slået til tilbyder Aura login i forhåndsvisningen.
    const saved = await window.evaluate(() => window.harness.featuresSave({ scope: 'alle', values: { 'integration-promte': true } }));
    assert.equal(saved.ok, true, saved.error);
    await window.locator('#promte-preview').filter({ hasText: 'Log ind med Promte' }).waitFor();
    // Udgiv er altid synlig; udgivelse er endnu ikke slået til.
    assert.equal(await window.locator('#deploy-button').isVisible(), true); assert.equal(await window.evaluate(() => window.sharingOn()), false);
    assert.equal(await window.frameLocator('#preview').locator('#status').textContent(), 'Venter på Promte');
    // 3. Login opretter ingen app. Aura spørger først, og appen oprettes med ét klik.
    await window.click('#promte-preview');
    await window.locator('#promte-preview').filter({ hasText: 'Opret appen Moedereferat i Promte' }).waitFor();
    // Integrationen er slået til i Funktioner, så udgivelse følger brugerens eget valg; Udgiv er fortsat synlig (PR 14).
    assert.equal(await window.locator('#deploy-button').isVisible(), true);
    assert.equal((await calls()).some(c => c[0] === 'create'), false, 'login opretter ingen app');
    await capture('promte-opret.png');
    await window.click('#promte-preview');
    await window.frameLocator('#preview').locator('#status').filter({ hasText: 'Forbundet' }).waitFor();
    assert.equal(await window.frameLocator('#preview').locator('#status').textContent(), 'Forbundet · ws-ny · https://kodning.promte.dk/api · GPT test, Claude test');
    assert.equal(await window.textContent('#promte-preview'), 'Promte · Moedereferat (ny app oprettet)');
    const log = await calls();
    assert.deepEqual(log.filter(c => ['login', 'create', 'fetch'].includes(c[0])), [['login', 'https://kodning.promte.dk'], ['create', 'https://kodning.promte.dk', 'Moedereferat'], ['fetch', 'app-api/models?type=llm', 'GET']]);
    assert.ok(log.filter(c => c[0] === 'connect').every(c => c[1] === project));
    // Projektet husker appen, så Udgiv forvælger den samme.
    assert.deepEqual((await window.evaluate(() => window.harness.deploymentSetup({ action: 'promte-link', config: {} }))).value.link, { host: 'https://kodning.promte.dk', workspaceId: 'ws-ny', name: 'Moedereferat' });
    const probe = id => window.frameLocator('#preview').locator('#status').evaluate((_element, id) => window.probePromte(id), id);
    const tokenCount = () => calls().then(log => log.filter(call => call[0] === 'token').length);
    assert.equal((await probe('cached-initial')).account, 'initial'); assert.equal(await tokenCount(), 1, 'samme konto genbruger app-tokenet');
    // Rigtige samtidige PromteSetup.login-kald: A venter, B godkendes, derefter ankommer A.
    await app.evaluate(() => {
      const f = globalThis.promteFixture; f.autoApprove = false; f.nextAccount = 'a';
      f.loginA = f.setup.login({ host: 'https://kodning.promte.dk', owner: 'projekt-a' }).then(value => ({ value }), error => ({ error: error.message }));
    });
    await waitFlow('a');
    await app.evaluate(() => {
      const f = globalThis.promteFixture; f.nextAccount = 'b';
      f.loginB = f.setup.login({ host: 'https://kodning.promte.dk', owner: 'projekt-b' }).then(value => ({ value }), error => ({ error: error.message }));
    });
    await waitFlow('b');
    const accountB = await app.evaluate(async () => { const f = globalThis.promteFixture; f.approve('b'); return (await f.loginB).value; });
    assert.equal(accountB.email, 'b@example.invalid');
    const afterLateA = await app.evaluate(async () => { const f = globalThis.promteFixture; f.approve('a'); return { login: await f.loginA, state: await f.setup.state({ host: 'https://kodning.promte.dk' }) }; });
    assert.match(afterLateA.login.error, /afbrudt/); assert.equal(afterLateA.state.email, 'b@example.invalid');
    assert.equal((await probe('after-account-switch')).account, 'b'); assert.equal(await tokenCount(), 2, 'konto B får et nyt app-token');
    const beforeLogout = (await calls()).filter(call => call[0] === 'fetch').length;
    await app.evaluate(() => globalThis.promteFixture.setup.logout({ host: 'https://kodning.promte.dk' }));
    assert.match((await probe('after-logout')).error, /Log ind med Promte igen/);
    assert.equal((await calls()).filter(call => call[0] === 'fetch').length, beforeLogout, 'logud forhindrer kald med tidligere cached app-token');
    assert.equal(await app.evaluate(() => globalThis.promteFixture.preview.tokens.size), 0);
    // Logud afbryder også et login, hvis browsersvaret først kommer bagefter.
    await app.evaluate(() => {
      const f = globalThis.promteFixture; f.nextAccount = 'c';
      f.loginC = f.setup.login({ host: 'https://kodning.promte.dk', owner: 'projekt-c' }).then(value => ({ value }), error => ({ error: error.message }));
    });
    await waitFlow('c');
    const lateLogout = await app.evaluate(async () => { const f = globalThis.promteFixture; await f.setup.logout({ host: 'https://kodning.promte.dk' }); f.approve('c'); return { login: await f.loginC, state: await f.setup.state({ host: 'https://kodning.promte.dk' }) }; });
    assert.match(lateLogout.login.error, /afbrudt/); assert.equal(lateLogout.state.connected, false);
    assert.deepEqual(errors, []);
    await helpers.assertNoGitWrites(app);
    await capture('promte-forhaandsvisning.png');
    const report = { status: 'bestået', root, checks: ['rigtig PromteSetup-login, krypteret lager og appoprettelse via preview-UI', 'rigtig PromtePreview-token/proxy gennem renderer og IPC', 'konto A → konto B → sent A-svar bevarer B', 'kontoskift udsteder nyt app-token', 'logud afviser cached app-token før HTTP-kald', 'sent login efter logud afvises'], calls: (await calls()).map(c => c[0]), limitations: ['kontrolleret browser og HTTP-transport, ingen rigtig Promte-konto', 'testside i stedet for app-biblioteket'] };
    await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await app?.close(); server?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
