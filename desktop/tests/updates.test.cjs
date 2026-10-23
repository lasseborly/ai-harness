const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { Updates, validateInfo, RELEASES } = require('../core/updates.cjs');
const { Store } = require('../core/store.cjs');
const { releaseBinaries, assetURL, updateFeeds, validateRelease } = require('../../scripts/release-contract.cjs');
const { buildUpdateFeeds } = require('../../scripts/build-pages.cjs');
const version = '0.3.0-beta.1';
const info = () => ({ version: '0.3.0-beta.2', files: [{ url: RELEASES + 'download/v0.3.0-beta.2/Aura-0.3.0-beta.2-mac-arm64.zip', sha512: createHash('sha512').update('test').digest('base64'), size: 4 }], critical: false, message: '' });
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-updates-test-'));
  const store = new Store(directory), updater = new EventEmitter(), events = []; let downloads = 0, installs = 0, checks = 0;
  updater.setFeedURL = value => { updater.feed = value; };
  updater.checkForUpdates = async () => { checks++; return { updateInfo: info(), isUpdateAvailable: true }; };
  updater.downloadUpdate = async () => { downloads++; updater.emit('download-progress', { percent: 57, total: 4, transferred: 2 }); return ['syntetisk']; };
  updater.quitAndInstall = () => { installs++; };
  const controller = new Updates({ updater, store, version, platform: 'darwin', arch: 'arm64', emit: event => events.push(event.value), ...options });
  t.after(async () => { controller.close(); await fs.rm(directory, { recursive: true, force: true }); });
  await controller.start();
  return { controller, updater, store, events, counts: () => ({ checks, downloads, installs }) };
}
test('Opdatering kræver to særskilte valg og bevarer automatiske installationer slået fra', async t => {
  const f = await fixture(t); await f.controller.check();
  assert.deepEqual(f.counts(), { checks: 1, downloads: 0, installs: 0 });
  assert.equal(f.updater.autoDownload, false); assert.equal(f.updater.autoInstallOnAppQuit, false); assert.equal(f.updater.allowDowngrade, false);
  assert.match(f.updater.feed.url, /beta\/darwin-arm64\/$/);
  await f.controller.download(); assert.equal(f.controller.snapshot().phase, 'ready');
  assert.equal(f.events.find(e => e.percent === 57).phase, 'downloading'); assert.equal(f.counts().installs, 0);
  await f.controller.restart(); assert.equal(f.counts().installs, 1);
});
test('En sikkerhedsadvarsel overlever genstart og netfejl uden at blokere arbejdet', async t => {
  const f = await fixture(t); const critical = { ...info(), critical: true, message: 'Opdatér for at få rettelsen til filadgang.' };
  f.updater.checkForUpdates = async () => ({ updateInfo: critical }); await f.controller.check();
  await f.controller.automatic(false); assert.equal((await f.store.read()).updates.automatic, false);
  const other = new Updates({ updater: f.updater, store: f.store, version, platform: 'darwin', arch: 'arm64' }); t.after(() => other.close());
  await other.start(); assert.equal(other.snapshot().automatic, false); assert.equal(other.snapshot().warning.version, critical.version);
  f.updater.checkForUpdates = async () => { throw Error('Privat teknisk URL'); }; await other.check();
  assert.equal(other.snapshot().warning.version, critical.version); assert.doesNotMatch(other.snapshot().error, /Privat/);
  assert.equal('blocked' in other.snapshot(), false);
  const upgraded = new Updates({ updater: f.updater, store: f.store, version: critical.version, platform: 'darwin', arch: 'arm64' }); t.after(() => upgraded.close());
  await upgraded.start(); assert.equal(upgraded.snapshot().warning, null);
});
test('Genstart afvises ved aktivt arbejde, og mislykket klargøring beholder den hentede version', async t => {
  let active = true;
  const f = await fixture(t, { busy: () => active, prepare: async () => { throw Error('Diskfejl'); } });
  await f.controller.check(); await f.controller.download(); await assert.rejects(f.controller.restart(), /igangværende/);
  assert.equal(f.controller.snapshot().phase, 'ready'); active = false; await f.controller.restart();
  assert.equal(f.controller.snapshot().phase, 'ready'); assert.equal(f.counts().installs, 0);
});
test('Parallel kontrol og download starter ikke dobbelt, og filfejl giver mulighed for nyt forsøg', async t => {
  const f = await fixture(t); let finish;
  f.updater.checkForUpdates = () => new Promise(resolve => { finish = resolve; });
  const check = f.controller.check(); assert.equal((await f.controller.check()).phase, 'checking');
  finish({ updateInfo: info() }); await check;
  f.updater.downloadUpdate = async () => { throw Error('SHA-512'); };
  await f.controller.download(); assert.equal(f.controller.snapshot().phase, 'error'); assert.equal(f.counts().installs, 0);
  f.updater.checkForUpdates = async () => ({ updateInfo: { ...info(), version: '0.2.0-beta.6' } });
  await f.controller.check(); assert.equal(f.controller.snapshot().phase, 'current'); await assert.rejects(f.controller.download());
});
test('Kilden kontakter ikke opdateringstjenesten, og stabile versioner henter ikke betaer', async t => {
  const f = await fixture(t, { enabled: false }); await f.controller.check(); assert.equal(f.counts().checks, 0);
  const options = { version, platform: 'darwin', arch: 'arm64' };
  assert.doesNotThrow(() => validateInfo(info(), options));
  for (const mutate of [i => i.version = version, i => i.files[0].sha512 = 'forkert', i => i.files[0].size = -1,
    i => i.files[0].url = i.files[0].url.replace('arm64', 'x64'), i => i.files[0].url = 'https://example.com/app.zip',
    i => i.files.push(i.files[0]), i => i.packages = {}, i => { i.critical = true; i.message = ''; }]) {
    const bad = info(); mutate(bad); assert.throws(() => validateInfo(bad, options));
  }
  assert.throws(() => validateInfo(info(), { ...options, version: '0.3.0' }));
});
function releaseFixture() {
  const content = Buffer.from('Syntetisk programfil');
  const files = releaseBinaries(version).map(name => ({ name, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex'), sha512: createHash('sha512').update(content).digest('base64'), notarized: name.includes('-mac-'), ...(name.includes('-mac-') ? { notarization: { id: '12345678-1234-1234-1234-123456789abc', checkedAt: new Date().toISOString() } } : {}) }));
  const manifest = { version, files, update: { critical: false, message: '' } }, data = Buffer.from(JSON.stringify(manifest));
  const release = { tag_name: 'v' + version, draft: false, prerelease: true, published_at: new Date().toISOString(), body: 'Prøve', assets: [...files.map(f => ({ name: f.name, size: f.bytes, digest: 'sha256:' + f.sha256 })), { name: 'release.json', size: data.length, digest: 'sha256:' + createHash('sha256').update(data).digest('hex') }, { name: 'SHA256SUMS.txt' }].map(f => ({ ...f, state: 'uploaded', browser_download_url: assetURL('v' + version, f.name) })) };
  return { manifest, data, release };
}
test('Udgivelsen binder Mac-ZIP, Windows og Linux til faktiske hashes og platforme', async t => {
  const f = releaseFixture(), output = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-feeds-')); t.after(() => fs.rm(output, { recursive: true, force: true }));
  const checksums = f.manifest.files.map(file => `${file.sha256}  ${file.name}`).join('\n');
  assert.equal(validateRelease({ ...f.release, draft: true }, f.manifest, checksums, version).files.length, 6);
  assert.equal(updateFeeds(f.manifest).length, 4);
  await buildUpdateFeeds([f.release], output, async () => new Response(f.data));
  for (const platform of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
    const feedFile = platform.startsWith('darwin') ? 'beta-mac.yml' : platform.startsWith('linux') ? 'beta-linux.yml' : 'beta.yml';
    const feed = JSON.parse(await fs.readFile(path.join(output, 'updates/beta', platform, feedFile)));
    assert.doesNotThrow(() => validateInfo(feed, { version: '0.2.0-beta.6', platform: platform.split('-')[0], arch: platform.split('-')[1] }));
  }
  await assert.rejects(buildUpdateFeeds([f.release], output, async () => new Response('ændret')), /kontrolsum/);
  const altered = structuredClone(f.manifest); altered.files.find(f => f.name.endsWith('.zip')).notarized = false;
  assert.throws(() => validateRelease({ ...f.release, draft: true }, altered, checksums, version), /kvittering/);
  await buildUpdateFeeds([{ ...f.release, draft: true }], output, () => { throw Error('Ingen netadgang for kladder'); });
  await assert.rejects(fs.access(path.join(output, 'updates')));
});
