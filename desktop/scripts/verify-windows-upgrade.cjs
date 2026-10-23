// Kør gammel Windows-pakkes faktiske lagermoduler på isolerede, syntetiske data,
// og læs dem gennem den nye kode. Dette er ikke en Windows-/DPAPI-/NSIS-kørsel.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { createRequire } = require('node:module');
const asar = require('@electron/asar');
const { Store } = require('../core/store.cjs');
const { WorkspaceHistory } = require('../core/workspace-history.cjs');
const { Copies } = require('../core/copies.cjs');
const { Deployments } = require('../core/deployments.cjs');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const { readPreviewAsset } = require('../core/preview.cjs');
const { staticPreview } = require('../core/preview-session.cjs');
const { appIdentity } = require('../core/app-identity.cjs');
const { validateInfo } = require('../core/updates.cjs');
const { normalizeRuntimeConfig, detectServices, serviceDirectory } = require('../core/project-runtime.cjs');
const digest = data => createHash('sha256').update(data).digest('hex');

function oldModules(archive) {
  const loaded = new Map(), sources = new Map(), localRequire = createRequire(__filename);
  function load(file) {
    if (loaded.has(file)) return loaded.get(file).exports;
    const source = asar.extractFile(archive, file).toString('utf8'), module = { exports: {} };
    sources.set(file, digest(source)); loaded.set(file, module);
    const requireOld = name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name))) : localRequire(name);
    new Function('require', 'module', 'exports', '__filename', '__dirname', 'process', source)(requireOld, module, module.exports, archive + '/' + file, archive + '/' + path.posix.dirname(file), { ...process, platform: 'win32' });
    return module.exports;
  }
  return { load, sources };
}
// Samme safeStorage-grænseflade med rigtig AES-kryptering, men ingen Windows-nøglering.
// Formålet er at bevise, at de gamle bytes og dekrypteringskald bevares gennem opgraderingen.
function isolatedEncryption() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]); },
    decryptString(value) { const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(-16)); return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString('utf8'); },
  };
}
async function verifyWindowsUpgrade(archive, targetVersion = '0.6.0-beta.1') {
  archive = path.resolve(archive);
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-windows-opgradering-')));
  const old = oldModules(archive), oldPackage = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(oldPackage.version, '0.5.0-beta.3', 'prøven kræver den faktiske beta.3-pakke');
  const { Store: OldStore } = old.load('core/store.cjs');
  const { WorkspaceHistory: OldHistory } = old.load('core/workspace-history.cjs');
  const { Copies: OldCopies } = old.load('core/copies.cjs');
  const safeStorage = isolatedEncryption(), directory = path.join(root, 'appdata', 'harness');
  const before = new OldStore(directory, safeStorage, 'win32'), oldHistory = new OldHistory(before);
  const key = 'syntetisk-opgraderingsnoegle', secret = before.encrypt(key);
  await before.update(state => {
    state.connections = [{ id: 'bevaret', kind: 'compatible', name: 'Bevaret forbindelse', baseURL: 'https://example.invalid/v1', secret }, { id: 'tidligere-komplai', kind: 'komplai', name: 'Tidligere AI', secret }];
    state.hosting = { promte: { 'https://kodning.promte.dk': { secret, email: 'test@example.invalid', expiresAt: '2099-01-01T00:00:00Z' } }, komplai: { secret, organizationId: 'syntetisk' } };
    state.updates = { automatic: false }; state.unknownFutureField = { preserved: true };
  });
  const roots = [String.raw`C:\Users\Prøve\Documents\Aura\Projekt med mellemrum`, String.raw`c:\Users\Prøve\Documents\Aura\Projekt med mellemrum`, String.raw`\\FILSERVER\Fælles\Projekt Å`, String.raw`\\?\C:\Users\Prøve\Documents\Aura\Langt projekt`, String.raw`\\?\UNC\FILSERVER\Fælles\Projekt Å`];
  const receipt = { id: 'bevaret-udgivelse', provider: 'azure', state: 'READY', config: { provider: 'azure', directory: 'dist' }, url: 'https://syntetisk.azurestaticapps.net', checks: { provider: { status: 'checked' } } };
  const recorded = [];
  for (const [index, projectRoot] of roots.entries()) {
    const data = await oldHistory.open({ root: projectRoot, name: 'Projekt ' + index });
    await oldHistory.draft(projectRoot, data.active, { text: 'Bevar min kladde æøå ' + index, mode: 'plan' });
    await oldHistory.saveRun(projectRoot, data.active, { messages: [{ id: 'u', role: 'user', text: 'Bevar mine beskeder' }, { id: 'a', role: 'assistant', text: 'Bevaret svar' }], plan: null, planConversation: [], status: 'completed', mode: 'chat', usage: { input: 17, output: 23 } });
    await before.saveProject(projectRoot, { selection: { connectionID: 'bevaret', modelID: 'syntetisk' }, deploymentConfig: receipt.config, deploymentLast: receipt, promteApp: { host: 'https://kodning.promte.dk', workspaceId: 'ws-bevaret' }, komplaiPreviewApp: { id: 'bevaret-app' } });
    recorded.push({ root: projectRoot, key: before.projectKey(projectRoot), chat: data.active, settings: await before.project(projectRoot), data: await oldHistory.readChat(projectRoot, data.active) });
  }
  // Et fysisk projekt og en uflettet kopi skrives af den gamle pakkes egne klasser.
  const project = path.join(root, 'Projekt Æ med mellemrum');
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  const html = '<!doctype html><meta charset="utf-8"><h1>Bevaret app æøå</h1>';
  await fs.writeFile(path.join(project, 'public', 'index.html'), html);
  const opened = await oldHistory.open({ root: project, name: 'Bevaret projekt' });
  await oldHistory.draft(project, opened.active, { text: 'Kladde i bevaret kopi', mode: 'chat' });
  const oldCopy = await new OldCopies(before).create(project, opened.active);
  await fs.writeFile(path.join(oldCopy.root, 'public', 'index.html'), html + '<p>Uflettet ændring</p>');
  await oldHistory.updateChat(project, opened.active, chat => { chat.copy = { id: oldCopy.id }; chat.sessionID = 'ses_bevaret'; });
  const copyBytes = await fs.readFile(path.join(directory, 'copies', oldCopy.id, 'copy.json'));
  const after = new Store(directory, safeStorage, 'win32'), history = new WorkspaceHistory(after);
  const state = await after.read();
  assert.equal(state.version, 1); assert.equal(state.connections[0].secret, secret);
  assert.equal(after.decrypt(state.connections[0]), key); assert.equal(after.decrypt(state.hosting.promte['https://kodning.promte.dk']), key);
  assert.equal(after.publicConnection(state.connections[0]).secret, undefined);
  assert.throws(() => new Store(directory, isolatedEncryption(), 'win32').decrypt(state.connections[0]), /kan ikke dekrypteres/);
  for (const saved of recorded) {
    assert.equal(after.projectKey(saved.root), saved.key, 'opgradering må ikke omdøbe gamle hashmapper');
    assert.deepEqual(await after.project(saved.root), saved.settings);
    assert.deepEqual(await history.readChat(saved.root, saved.chat), saved.data);
    assert.equal((await history.open({ root: saved.root, name: 'Bevaret' })).active, saved.chat);
    assert.equal(normalizeRuntimeConfig((await after.project(saved.root)).runtime).mode, 'auto');
  }
  assert.equal((await history.recent()).length, roots.length + 1);
  await Promise.all([after.saveProject(roots[0], { runtime: { mode: 'static' } }), after.saveProject(roots[1], { runtime: { mode: 'auto' } })]);
  const reopened = new Store(directory, safeStorage, 'win32');
  assert.equal((await reopened.project(roots[0])).runtime.mode, 'static');
  assert.equal((await reopened.project(roots[1])).runtime.mode, 'auto');
  assert.deepEqual((await reopened.project(roots[0])).deploymentLast, receipt);
  assert.deepEqual((await new Deployments(reopened, { providers: {} }).state(roots[0])).last, receipt);
  assert.equal((await reopened.read()).connections[0].secret, secret); assert.deepEqual((await reopened.read()).unknownFutureField, { preserved: true });
  const loadedCopy = await new Copies(after).load(oldCopy.id, project);
  assert.equal(loadedCopy.root, oldCopy.root); assert.deepEqual(await fs.readFile(path.join(directory, 'copies', oldCopy.id, 'copy.json')), copyBytes);
  const registry = new WorkspaceRegistry({ directory, store: after, safeStorage, profiles: path.resolve(__dirname, '../../profiles'), emit: () => {}, engineFactory: () => { throw Error('Opgradering må ikke starte en model'); } });
  try {
    const bench = await registry.select({ root: project, name: 'Bevaret projekt' });
    assert.ok(bench.chat, bench.historyWarning);
    assert.equal(bench.chat.id, opened.active); assert.equal(bench.chat.data.draft, 'Kladde i bevaret kopi'); assert.equal(bench.chat.root, oldCopy.root);
    assert.equal(bench.chat.data.sessionID, 'ses_bevaret'); assert.equal(registry.running, false);
    const visible = await bench.state();
    assert.deepEqual(visible.connections.map(connection => connection.id), ['bevaret']);
    assert.deepEqual(visible.retiredConnections.map(connection => connection.id), ['tidligere-komplai']);
    assert.equal(JSON.stringify(visible).includes(key), false);
  } finally { await registry.close(); }
  assert.equal((await readPreviewAsset(project, '/index.html')).data.toString(), html);
  assert.match((await readPreviewAsset(loadedCopy.root, '/index.html')).data.toString(), /ændring/);
  assert.equal((await detectServices(project)).services.length, 0, 'gammel HTML må ikke udløse en pakkeinstallation');
  const preview = staticPreview({ key: after.projectKey(project) });
  assert.equal(preview.url, staticPreview({ key: new Store(directory, safeStorage, 'win32').projectKey(project) }).url);
  assert.notEqual(preview.url, staticPreview({ key: after.projectKey(loadedCopy.root) }).url);
  // Samme grænsetilfælde som et Windows-drev eller en UNC-share-rod, afprøvet på værtsfilsystemet.
  const volumeRoot = path.parse(project).root;
  assert.equal(await serviceDirectory(volumeRoot, path.relative(volumeRoot, project)), project);
  // De gamle identitetsregler køres med Windows-stier og samme kontrollerede filkort.
  const oldIdentitySource = asar.extractFile(archive, 'core/app-identity.cjs').toString();
  const newIdentitySource = await fs.readFile(path.join(__dirname, '../core/app-identity.cjs'), 'utf8');
  assert.equal(oldIdentitySource, newIdentitySource);
  const identitySource = code => { const module = { exports: {} }; new Function('require', 'module', 'exports', code)(name => name === 'node:path' ? path.win32 : require(name), module, module.exports); return module.exports; };
  for (const legacy of [false, true]) for (const custom of [false, true]) {
    const appData = String.raw`C:\Users\Prøve\AppData\Roaming`, userData = path.win32.join(appData, 'Aura'), sessionData = userData;
    const files = { existsSync: file => legacy && (file === path.win32.join(appData, 'AI Harness') || file.endsWith('\\harness')), readFileSync: () => { throw Error('ingen markør'); } };
    const options = { appData, userData, sessionData, packaged: true, customUserData: custom, files };
    assert.deepEqual(identitySource(newIdentitySource).appIdentity(options), identitySource(oldIdentitySource).appIdentity(options));
  }
  const marker = appIdentity({ appData: root, userData: path.join(root, 'appdata'), sessionData: path.join(root, 'appdata'), packaged: true, customUserData: true });
  assert.equal(marker.userData, path.join(root, 'appdata'));
  const feed = await fs.readFile(path.join(path.dirname(archive), 'app-update.yml'), 'utf8');
  assert.match(feed, /updaterCacheDirName: aura-desktop-updater/); assert.match(feed, /channel: beta/);
  assert.equal(require('../package.json').name, oldPackage.name); assert.equal(require('../package.json').productName, oldPackage.productName);
  const info = { version: targetVersion, files: [{ url: `https://github.com/ai-alliancen-org/ai-harness/releases/download/v${targetVersion}/Aura-${targetVersion}-win-x64.exe`, sha512: Buffer.alloc(64, 7).toString('base64'), size: 100 }] };
  const options = { version: oldPackage.version, platform: 'win32', arch: 'x64' };
  assert.deepEqual(validateInfo(info, options), old.load('core/updates.cjs').validateInfo(info, options));
  assert.throws(() => validateInfo({ ...info, files: [{ ...info.files[0], url: info.files[0].url.replace('win-x64', 'mac-arm64') }] }, options), /matcher ikke/);
  const oldIframe = asar.extractFile(archive, 'ui/index.html').toString().match(/<iframe[^>]*id="preview"[^>]*>/)?.[0];
  assert.match(oldIframe, /sandbox="allow-scripts"/);
  const report = { status: 'bestået', root, archive, oldVersion: oldPackage.version, targetVersion, host: process.platform, moduleHashes: Object.fromEntries(old.sources), checks: ['gamle faktiske Store/WorkspaceHistory/Copies skriver syntetisk krypteret materiale', 'Windows-drev, bogstavvarianter, UNC og lange stier beholder eksisterende hashnøgler', 'forbindelser, hostingadgang, kladder, beskeder, forbrug, kvitteringer og ukendte felter bevares', 'uflettet kopi og sessions-ID åbnes gennem den nye WorkspaceRegistry uden modelstart', 'HTML og kopiens ændringer læses gennem produktionspreview; origin er stabil og særskilt', 'drevrodsfejl reproducerbar på værtsfilsystem og rettet', 'appnavn, datamapperegler og beta-opdateringskontrakt bevares'], limitations: ['ingen Windows-maskine: ingen native DPAPI, UNC-share, NTFS-case, NSIS-installation eller automatisk genstart', 'kryptering er en kontrolleret AES-adapter til safeStorage-grænsefladen, ikke Windows DPAPI', 'previewindhold læst gennem produktionskode; browserlager på Windows ikke kørt', 'gammel preview brugte tilfældig localhost-origin og opaque sandbox; ingen migration af tidligere browserlager er påvist', 'gamle case-varianter har hver sin historiske hash; prøven ændrer eller sammenfletter dem ikke', 'updaterens metadata kontrolleret uden HTTP-download, NSIS-eksekvering eller udgivelse'] };
  await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2));
  return report;
}
if (require.main === module) {
  const archive = process.argv[2];
  if (!archive) { console.error('Angiv stien til beta.3 Windows-pakkens resources/app.asar.'); process.exitCode = 1; }
  else verifyWindowsUpgrade(archive, process.argv[3]).then(report => console.log(JSON.stringify({ status: report.status, root: report.root, checks: report.checks, limitations: report.limitations }, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verifyWindowsUpgrade };
