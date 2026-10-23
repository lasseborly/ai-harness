// Udgivelsesforløbet til Promte i den rigtige app: login i browseren, valg eller oprettelse af app og gennemgang.
// Promtes netværk erstattes af lokale adaptere. Prøven opretter et isoleret Git-projekt og udgiver intet på nettet.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../core/git.cjs');
const helpers = require('./ui-test-helpers.cjs');
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-del-promte-'))), project = path.join(root, 'projekt'); let app;
  const files = {
    'package.json': JSON.stringify({ name: 'promte-test', private: true, scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { '@promte/app-library': '^0.1.6', react: '19.2.8', 'react-dom': '19.2.8', vite: '^5.4.10' } }),
    'index.html': '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
    'src/main.jsx': 'document.getElementById("root").textContent = "Syntetisk Promte-prøve";',
    'vite.config.js': 'export default {};'
  };
  for (const [file, data] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(project, file)), { recursive: true }); await fs.writeFile(path.join(project, file), data); }
  await run(project, ['init']); await run(project, ['add', '.']);
  await run(project, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Testbruger', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Gem Promte-prøve']);
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(), errors = [];
    await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ dialog, shell, session }, { project, modulePath }) => {
      const require = process.getBuiltinModule('module').createRequire(modulePath), { PromteSetup, PromteDeployment, promteConfiguration } = require(modulePath);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      globalThis.openedLinks = []; shell.openExternal = async url => { globalThis.openedLinks.push(url); };
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      const calls = globalThis.promteCalls = [];
      let connected = false;
      PromteSetup.prototype.state = async ({ host }) => { calls.push(['state', host]); return { host, installed: true, connected, email: connected ? 'test@example.invalid' : '', loginSource: connected ? 'aura' : null, accountRequired: 'Kræver konto og betalt aftale' }; };
      PromteSetup.prototype.login = async function ({ host }) { calls.push(['login', host]); connected = true; return this.state({ host }); };
      PromteSetup.prototype.logout = async function ({ host }) { calls.push(['logout', host]); connected = false; return this.state({ host }); };
      PromteSetup.prototype.workspaces = async ({ host }) => { calls.push(['workspaces', host]); return [{ id: 'ws-budget', name: 'Budget', activeAppVersion: 2 }]; };
      PromteSetup.prototype.createWorkspace = async ({ host, name }) => { if (!name?.trim()) throw Error('Giv appen et navn på højst 100 tegn.'); calls.push(['create', host, name.trim()]); return { id: 'ws-ny', name: name.trim(), activeAppVersion: null }; };
      PromteDeployment.prototype.inspect = async input => { const c = promteConfiguration(input); calls.push(['inspect', c.host, c.workspaceId]); return { id: c.workspaceId, name: { 'ws-ny': 'Mødebooking', 'ws-budget': 'Budget' }[c.workspaceId] || c.workspaceId, owner: new URL(c.host).hostname, host: new URL(c.host).hostname, portal: `${c.host}/workspaces/${c.workspaceId}`, region: 'Syntetisk', settings: { uploadMode: 'source' }, environmentKeys: [], access: 'Syntetisk adgang', accountRequired: 'Kræver konto og betalt aftale', uploadDestinations: [c.host], materialNote: 'Syntetisk Promte-prøve.' }; };
      PromteDeployment.prototype.deploy = async (input, artifact) => { calls.push(['deploy', input.workspaceId, artifact.files.map(f => f.file).sort()]); return { id: 'release-1', promteVersion: 1, state: 'REVIEWING', url: null }; };
      PromteDeployment.prototype.status = async () => ({ id: 'release-1', promteVersion: 1, state: 'REVIEWING', url: null });
    }, { project, modulePath: path.resolve(__dirname, '../core/provider-promte.cjs') });
    const idle = () => page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    const calls = () => app.evaluate(() => globalThis.promteCalls);
    await helpers.skipIntroduction(page); await helpers.enableSharing(page); await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    await page.click('#deploy-button'); await idle(); await page.click('#deployment-other');
    if (!await page.locator('[data-provider="promte"]').isVisible()) await page.click('#deployment-more-providers');
    await page.click('[data-provider="promte"]'); await idle();
    // 1. Adressen er forudfyldt med Promtes forslag til hackathonen og kan ændres. Der kræves ingen CLI.
    assert.equal(await page.inputValue('#deploy-promte-host'), 'https://kodning.promte.dk');
    await page.fill('#deploy-promte-host', 'https://staging.promte.dk'); await page.click('#deployment-promte-host-next'); await idle();
    assert.equal(await page.locator('[data-deploy-step="setupConnection"]').isVisible(), true);
    assert.equal(await page.locator('#deployment-connect').isVisible(), true);
    assert.equal(await page.locator('#deployment-install').isHidden(), true, 'Promte kræver ikke et installeret værktøj.');
    // 2. Login i browseren fører direkte til brugerens apps.
    await page.click('#deployment-connect'); await idle();
    await page.waitForSelector('[data-deploy-step="promteWorkspace"]:not([hidden])');
    assert.equal(await page.textContent('#deploy-promte-account'), 'Logget ind som test@example.invalid.');
    assert.deepEqual(await page.locator('#deploy-promte-workspace option').evaluateAll(items => items.map(item => [item.value, item.textContent])), [['ws-budget', 'Budget · version 2'], ['__new__', 'Ny app …'], ['__id__', 'Indtast ID …']]);
    // 3. Et projekt uden Promte-app får en ny app med projektets navn som forslag.
    assert.equal(await page.inputValue('#deploy-promte-workspace'), '__new__');
    assert.equal(await page.locator('#deploy-promte-new').isVisible(), true);
    assert.equal(await page.inputValue('#deploy-promte-name'), 'Projekt');
    await page.fill('#deploy-promte-name', ''); await page.click('#deployment-promte-workspace-next'); await idle();
    assert.match(await page.textContent('#deployment-feedback'), /navn|ID/);
    await page.fill('#deploy-promte-name', 'Mødebooking'); await page.click('#deployment-promte-workspace-next'); await idle();
    await page.waitForSelector('[data-deploy-step="files"]:not([hidden])');
    // 4. Gennemgang og udgivelse sender kun kildekoden fra den gemte version.
    await page.click('#deployment-next'); await idle(); await page.waitForSelector('#deployment-review:not([hidden])');
    await page.click('#deployment-send'); await idle(); await page.waitForSelector('#deployment-result:not([hidden])');
    const log = await calls();
    assert.deepEqual(log.filter(c => c[0] === 'login'), [['login', 'https://staging.promte.dk']]);
    assert.deepEqual(log.filter(c => c[0] === 'create'), [['create', 'https://staging.promte.dk', 'Mødebooking']]);
    assert.deepEqual(log.find(c => c[0] === 'deploy'), ['deploy', 'ws-ny', ['index.html', 'package.json', 'src/main.jsx']]);
    assert.ok(log.every(c => c[1] !== 'https://kodning.promte.dk' || c[0] === 'state'), 'Den valgte adresse bruges hele vejen.');
    const receipt = (await page.evaluate(() => window.harness.deploymentState())).value.last;
    // Projektet husker appen, så forhåndsvisning og næste udgivelse bruger den samme.
    assert.deepEqual((await page.evaluate(() => window.harness.deploymentSetup({ action: 'promte-link', config: {} }))).value.link, { host: 'https://staging.promte.dk', workspaceId: 'ws-ny', name: 'Mødebooking' });
    assert.equal(receipt.config.workspaceId, 'ws-ny'); assert.equal(receipt.state, 'REVIEWING');
    assert.match(await page.locator('#deployment-result').innerText(), /Mødebooking/, 'Resultatet viser appens navn.');
    // Knappen åbner appen i Promte, hvor den kører med login og data (PR 14).
    assert.equal(await page.textContent('#deployment-portal'), 'Åbn appen i Promte');
    if (!await page.locator('#deployment-portal').isVisible()) await page.locator('#deployment-receipt-details > summary').click();
    await page.click('#deployment-portal'); await idle();
    assert.deepEqual(await app.evaluate(() => globalThis.openedLinks), ['https://staging.promte.dk/workspaces/ws-ny']);
    assert.deepEqual(errors, []);
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64'));
    await fs.writeFile(path.join(root, 'promte-resultat.png'), Buffer.from(png, 'base64'));
    console.log(JSON.stringify({ status: 'bestået', root, calls: log.map(c => c[0]), limitations: ['lokale Promte-adaptere', 'ingen rigtig upload'] }, null, 2));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
