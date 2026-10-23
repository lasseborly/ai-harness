// Læser tidligere udgivelsers faktiske klient. Ingen installation, netkald eller Git-skrivning.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const asar = require('@electron/asar');
const semver = require('semver');
const { releaseBinaries, updateFeeds } = require('../../scripts/release-contract.cjs');

async function verify(resources) {
  const candidate = require('../package.json').version;
  const lock = require('../package-lock.json');
  const notice = require('../packaging/update-notice.json');
  assert.equal(lock.version, candidate); assert.equal(lock.packages[''].version, candidate);
  assert.equal(notice.version, candidate);
  const archive = path.join(resources, 'app.asar');
  await fs.access(archive);
  const previous = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert(semver.lt(previous.version, candidate), 'Prøven kræver en faktisk tidligere version.');
  const source = asar.extractFile(archive, 'core/updates.cjs');
  const module = { exports: {} };
  vm.runInNewContext(source.toString(), {
    module, exports: module.exports,
    require: name => { assert.equal(name, 'semver'); return semver; },
    process: { platform: 'win32', arch: 'x64' },
    structuredClone, setTimeout, clearTimeout, setInterval, clearInterval,
  }, { filename: archive + '/core/updates.cjs' });
  const { Updates, validateInfo } = module.exports;
  const payload = Buffer.from('Syntetisk opdateringsfil til protokolkontrol. Ikke et program.');
  const manifest = { version: candidate, update: notice, files: releaseBinaries(candidate).map(name => ({
    name, bytes: payload.length, sha512: createHash('sha512').update(payload).digest('base64'),
  })) };
  const checks = [];
  for (const feed of updateFeeds(manifest)) {
    const target = feed.path.split('/')[2], [platform, arch] = target.split('-');
    const options = { version: previous.version, platform, arch };
    assert.equal(validateInfo(feed.info, options).version, candidate);
    for (const change of [
      info => { info.files[0].url = info.files[0].url.replace(`-${arch}.`, arch === 'x64' ? '-arm64.' : '-x64.'); },
      info => { info.files[0].sha512 = 'forkert'; },
      info => { info.version = previous.version; },
      info => { info.files[0].url = 'https://example.invalid/ukendt.exe'; },
    ]) {
      const bad = structuredClone(feed.info); change(bad);
      assert.throws(() => validateInfo(bad, options));
    }
    let downloads = 0, installs = 0, prepared = 0, busy = true;
    const updater = new EventEmitter();
    updater.setFeedURL = value => { updater.feed = value; };
    updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: feed.info });
    updater.downloadUpdate = async () => { downloads++; updater.emit('download-progress', { percent: 50 }); };
    const saved = { updates: { automatic: false }, privateMarker: 'Bevares' };
    const controller = new Updates({ ...options, updater,
      store: { read: async () => saved, update: async change => change(saved) },
      busy: () => busy, prepare: async () => { prepared++; }, install: () => { installs++; },
    });
    try {
      await controller.start();
      assert.equal(controller.snapshot().automatic, false);
      assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
      assert.equal(updater.allowDowngrade, false); assert.equal(updater.channel, 'beta');
      assert.equal(updater.feed.url, `https://ai-alliancen-org.github.io/ai-harness/updates/beta/${target}/`);
      await controller.check(); assert.equal(controller.snapshot().phase, 'available');
      assert.equal(downloads, 0); assert.equal(installs, 0);
      await controller.download(); assert.equal(controller.snapshot().phase, 'ready');
      assert.equal(downloads, 1); assert.equal(installs, 0);
      await assert.rejects(controller.restart(), /igangværende/);
      busy = false; await controller.restart();
      assert.equal(installs, 1); assert.equal(prepared, 1); assert.equal(saved.privateMarker, 'Bevares');
      checks.push({ target, status: 'bestået' });
    } finally { controller.close(); }
  }
  return { previous: previous.version, candidate, archive,
    oldClientSHA256: createHash('sha256').update(source).digest('hex'), checks,
    limitation: 'Den gamle pakkes JavaScript-klient og nye feedformat er kørt med syntetiske opdateringsfiler. Download/installation er kontrollerede kald; NSIS, DPAPI og Windows er ikke kørt.' };
}
if (require.main === module) (async () => {
  const inputs = process.argv.slice(2);
  assert(inputs.length, 'Angiv mindst én tidligere pakkes Resources/resources-mappe.');
  const reports = [];
  for (const input of inputs) reports.push(await verify(path.resolve(input)));
  console.log(JSON.stringify({ status: 'bestået', reports }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
