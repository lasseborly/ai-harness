const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { appManifest, compareManifests, validateZipEntries, verifyMacArtifacts } = require('../scripts/verify-mac-artifacts.cjs');

async function fixture(t, { failCheck = false, wrongZip = false, failDetach = false, failAttach = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-artefakt-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'Prøve med mellemrum.app'), dmg = path.join(root, 'Prøve.dmg'), zip = path.join(root, 'Prøve.zip');
  await fs.mkdir(path.join(app, 'Contents', 'Resources'), { recursive: true });
  await fs.writeFile(path.join(app, 'Contents', 'Resources', 'fil.txt'), 'Appindhold æøå');
  await fs.writeFile(path.join(app, 'Contents', 'program'), 'syntetisk'); await fs.chmod(path.join(app, 'Contents', 'program'), 0o755);
  await fs.symlink('Resources/fil.txt', path.join(app, 'Contents', 'link'));
  await fs.writeFile(dmg, 'syntetisk DMG'); await fs.writeFile(zip, 'syntetisk ZIP');
  const calls = [], sources = []; let mount, unpack;
  const run = async (command, args) => {
    calls.push({ command, args });
    if (command === '/usr/bin/hdiutil' && args[0] === 'attach') {
      assert.equal(args[1], dmg); assert.ok(args.includes('-readonly')); assert.ok(args.includes('-nobrowse')); assert.ok(args.includes('-noautoopen'));
      mount = args[args.indexOf('-mountpoint') + 1];
      await fs.cp(app, path.join(mount, path.basename(app)), { recursive: true, verbatimSymlinks: true });
      await fs.writeFile(path.join(mount, '.DS_Store'), 'uden for appen');
      await fs.symlink('/Applications', path.join(mount, 'Applications'));
      if (failAttach) throw Error('simuleret fejl efter delvis montering');
    } else if (command === '/usr/bin/hdiutil' && args[0] === 'detach') {
      assert.equal(args.at(-1), mount);
      if (failDetach) throw Error('simuleret afmonteringsfejl');
      await fs.rm(mount, { recursive: true, force: true }); await fs.mkdir(mount);
    } else if (command === '/usr/bin/unzip') return { stdout: path.basename(app) + '/\n' + path.basename(app) + '/Contents/Resources/fil.txt\n.DS_Store\n', stderr: '' };
    else if (command === '/usr/bin/ditto') {
      assert.deepEqual(args.slice(0, 3), ['-x', '-k', zip]); unpack = args[3];
      await fs.cp(app, path.join(unpack, path.basename(app)), { recursive: true, verbatimSymlinks: true });
      if (wrongZip) await fs.writeFile(path.join(unpack, path.basename(app), 'Contents', 'Resources', 'fil.txt'), 'Forkert');
    } else if (failCheck && command === '/usr/bin/codesign') throw Error('simuleret ugyldig signatur');
    return { stdout: 'kontrolleret testsvar', stderr: '' };
  };
  const input = { app, dmg, zip, target: 'darwin-arm64' }, options = { platform: 'darwin', tempParent: root, run, sourceCheck: async (...args) => { sources.push(args); return { status: 'syntetisk kildekontrol' }; } };
  return { root, app, input, options, calls, sources, paths: () => ({ mount, unpack }) };
}

test('manifestet medtager alle appfiler, linkmål og relevante mode-bits', async t => {
  const f = await fixture(t), baseline = await appManifest(f.app);
  assert.ok(baseline.some(entry => entry.type === 'link' && entry.target === 'Resources/fil.txt'));
  const program = path.join(f.app, 'Contents', 'program');
  await fs.chmod(program, 0o644);
  assert.throws(() => compareManifests(baseline, baseline.map(entry => entry.path === 'Contents/link' ? { ...entry, target: '/andet' } : entry), 'links'), /forskelle/);
  assert.throws(() => compareManifests(baseline, baseline.filter(entry => entry.path !== 'Contents/program'), 'manglende'), /forskelle/);
  assert.throws(() => compareManifests(baseline, [{ path: 'ekstra', type: 'file' }, ...baseline], 'ekstra'), /forskelle/);
  const changed = await appManifest(f.app); assert.throws(() => compareManifests(baseline, changed, 'rettigheder'), /forskelle/);
  await fs.writeFile(path.join(f.app, '.DS_Store'), 'inde i appen');
  assert.ok((await appManifest(f.app)).some(entry => entry.path === '.DS_Store'));
});

test('alle tre apps kontrolleres, DMG udenomsfiler ignoreres, og kun egen udpakning fjernes', async t => {
  const f = await fixture(t), before = await appManifest(f.app), report = await verifyMacArtifacts(f.input, f.options);
  assert.equal(report.status, 'bestået'); assert.equal(f.sources.length, 3);
  assert.equal(f.calls.filter(call => call.command === '/usr/bin/codesign').length, 3);
  assert.equal(f.calls.filter(call => call.command === '/usr/bin/syspolicy_check').length, 3);
  assert.equal(f.calls.filter(call => call.command === '/usr/bin/xcrun').length, 4);
  assert.ok(f.calls.every(call => !call.args.includes('staple') && !call.args.includes('--sign')));
  assert.equal(report.apps.original.sha256, report.apps.dmg.sha256); assert.equal(report.apps.dmg.sha256, report.apps.zip.sha256);
  assert.deepEqual(await appManifest(f.app), before); assert.equal(await fs.readFile(f.input.zip, 'utf8'), 'syntetisk ZIP');
  assert.deepEqual(report.cleanup, { detached: true, unpackRemoved: true });
  await assert.rejects(fs.access(f.paths().unpack), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(report.reportFile, 'utf8')).status, 'bestået');
});

for (const scenario of [{ wrongZip: true }, { failCheck: true }, { failDetach: true }]) test('fejl bevares i rapporten, og oprydning er afgrænset: ' + JSON.stringify(scenario), async t => {
  const f = await fixture(t, scenario); let error;
  await assert.rejects(verifyMacArtifacts(f.input, f.options), value => { error = value; return true; });
  const report = JSON.parse(await fs.readFile(error.reportFile, 'utf8'));
  assert.equal(report.status, 'fejlet'); assert.ok(report.failures.length);
  assert.ok(f.calls.some(call => call.command === '/usr/bin/hdiutil' && call.args[0] === 'detach'));
  await assert.rejects(fs.access(f.paths().unpack), { code: 'ENOENT' });
  await fs.access(f.app); await fs.access(f.input.dmg); await fs.access(f.input.zip);
  if (scenario.failDetach) { assert.equal(report.cleanup.detached, false); await fs.access(path.join(f.paths().mount, path.basename(f.app))); }
});

test('opadgående ZIP-navne og en anden app afvises før udpakning', () => {
  validateZipEntries('Aura.app/\nAura.app/Contents/fil\n.DS_Store\n__MACOSX/._Aura.app\n', 'Aura.app');
  for (const name of ['../udenfor', '/absolut', 'Aura.app/../udenfor', 'Aura.app\\fil', 'Anden.app/fil']) assert.throws(() => validateZipEntries('Aura.app/\n' + name + '\n', 'Aura.app'));
});

test('en delvis montering afmonteres også, når attach-processen fejler', async t => {
  const f = await fixture(t, { failAttach: true }); let error;
  await assert.rejects(verifyMacArtifacts(f.input, f.options), value => { error = value; return true; });
  const report = JSON.parse(await fs.readFile(error.reportFile, 'utf8'));
  assert.equal(report.status, 'fejlet'); assert.equal(report.cleanup.detached, true);
  assert.ok(f.calls.some(call => call.args[0] === 'detach'));
  await assert.rejects(fs.access(path.join(path.dirname(error.reportFile), 'zip')), { code: 'ENOENT' });
  await fs.access(f.app);
});

test('en afbrydelse af kontrollen går stadig gennem afmontering og fejlrapport', async t => {
  const f = await fixture(t), run = f.options.run, listeners = process.listenerCount('SIGINT'); let interrupted = false, error;
  f.options.run = async (command, args, options) => {
    if (command === '/usr/bin/codesign' && !interrupted) { interrupted = true; process.emit('SIGINT'); process.emit('SIGINT'); }
    if (options.signal?.aborted) throw Error('syntetisk afbrydelse');
    return run(command, args, options);
  };
  await assert.rejects(verifyMacArtifacts(f.input, f.options), value => { error = value; return true; });
  const report = JSON.parse(await fs.readFile(error.reportFile, 'utf8'));
  assert.equal(report.status, 'fejlet'); assert.equal(report.cleanup.detached, true); assert.equal(report.cleanup.unpackRemoved, true);
  assert.equal(process.listenerCount('SIGINT'), listeners);
});

test('en eksisterende rapport eller en rapport inde i appen overskrives aldrig', async t => {
  const f = await fixture(t), file = path.join(f.root, 'rapport.json'); await fs.writeFile(file, 'BEVAR');
  await assert.rejects(verifyMacArtifacts({ ...f.input, reportFile: file }, f.options), /EEXIST/);
  assert.equal(await fs.readFile(file, 'utf8'), 'BEVAR'); assert.equal(f.calls.length, 0);
  await assert.rejects(verifyMacArtifacts({ ...f.input, reportFile: path.join(f.app, 'rapport.json') }, f.options), /uden for apps/);
});
