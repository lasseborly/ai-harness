// Læser de endelige Mac-filer uden at signere, staple eller starte appen.
// Brug: node scripts/verify-mac-artifacts.cjs ORIGINAL.app FINAL.dmg FINAL.zip darwin-arm64 [RAPPORT.json]
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const runFile = require('node:util').promisify(require('node:child_process').execFile);
const { verify: verifySource } = require('./verify-package-source.cjs');

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function appManifest(app) {
  const entries = [];
  async function visit(file, relative) {
    const stat = await fs.lstat(file), mode = (stat.mode & 0o7777).toString(8).padStart(4, '0');
    if (stat.isSymbolicLink()) entries.push({ path: relative, type: 'link', target: await fs.readlink(file) });
    else if (stat.isDirectory()) {
      entries.push({ path: relative, type: 'directory', mode });
      for (const name of (await fs.readdir(file)).sort()) await visit(path.join(file, name), relative === '.' ? name : relative + '/' + name);
    } else if (stat.isFile()) entries.push({ path: relative, type: 'file', mode, bytes: stat.size, sha256: await sha256(file) });
    else throw Error('Uventet filtype i appen: ' + relative);
  }
  if (!(await fs.lstat(app)).isDirectory()) throw Error('Appen skal være en rigtig mappe, ikke et symbolsk link.');
  await visit(app, '.');
  return entries;
}
function compareManifests(expected, actual, label) {
  const a = new Map(expected.map(entry => [entry.path, entry])), b = new Map(actual.map(entry => [entry.path, entry]));
  const differences = [];
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    if (JSON.stringify(a.get(name)) !== JSON.stringify(b.get(name))) differences.push({ path: name, expected: a.get(name) || null, actual: b.get(name) || null });
  }
  if (differences.length) {
    const error = Error(`${label}: ${differences.length} forskelle i filer, links eller rettigheder.`);
    error.differences = differences.slice(0, 20); throw error;
  }
}
function manifestSummary(entries) {
  return { entries: entries.length, files: entries.filter(entry => entry.type === 'file').length, links: entries.filter(entry => entry.type === 'link').length, bytes: entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0), sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
async function findApp(folder, name) {
  const apps = (await fs.readdir(folder, { withFileTypes: true })).filter(entry => entry.name.endsWith('.app'));
  if (apps.length !== 1 || apps[0].name !== name || !apps[0].isDirectory()) throw Error('Pakken skal indeholde præcis ' + name + ' som rigtig mappe i roden.');
  // Finderens .DS_Store, Applications-link og DMG-baggrund ligger uden for appen.
  // Ingen filer inde i .app udelades fra manifestet.
  return path.join(folder, name);
}
function validateZipEntries(text, appName) {
  const names = text.split('\n').filter(Boolean);
  if (!names.length || !names.some(name => name === appName + '/' || name.startsWith(appName + '/'))) throw Error('ZIP-arkivet mangler appen i roden.');
  for (const name of names) {
    if (/[\\\x00-\x1f]/.test(name) || path.posix.isAbsolute(name) || name.split('/').some(part => part === '..' || part === '.') || /^[a-z]:/i.test(name)) throw Error('ZIP-arkivet indeholder en usikker sti.');
    if (name !== appName + '/' && !name.startsWith(appName + '/') && name !== '.DS_Store' && name !== '__MACOSX/' && !name.startsWith('__MACOSX/')) throw Error('Uventet indhold uden for appen i ZIP: ' + name);
  }
}
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
async function verifyMacArtifacts(input, options = {}) {
  const { platform = process.platform, run = runFile, sourceCheck = verifySource, tempParent = os.tmpdir(), log = () => {} } = options;
  if (platform !== 'darwin') throw Error('Mac-pakkekontrollen kræver macOS.');
  if (!['darwin-arm64', 'darwin-x64'].includes(input.target)) throw Error('Angiv darwin-arm64 eller darwin-x64.');
  for (const [key, suffix] of [['app', '.app'], ['dmg', '.dmg'], ['zip', '.zip']]) if (typeof input[key] !== 'string' || !input[key].endsWith(suffix)) throw Error('Angiv en gyldig ' + suffix + '-sti.');
  const app = await fs.realpath(input.app), dmg = await fs.realpath(input.dmg), zip = await fs.realpath(input.zip);
  if (!(await fs.lstat(app)).isDirectory() || !(await fs.stat(dmg)).isFile() || !(await fs.stat(zip)).isFile()) throw Error('App, DMG og ZIP skal findes som de angivne filtyper.');
  if (inside(app, dmg) || inside(app, zip)) throw Error('Installationsfilerne skal ligge uden for appen.');
  const temp = await fs.realpath(await fs.mkdtemp(path.join(tempParent, 'aura-mac-artefakter-'))), mount = path.join(temp, 'dmg'), unpack = path.join(temp, 'zip');
  let reportFile = path.join(temp, 'rapport.json');
  if (input.reportFile) {
    const parent = await fs.realpath(path.dirname(path.resolve(input.reportFile)));
    reportFile = path.join(parent, path.basename(input.reportFile));
    if (parent.split(path.sep).some(part => part.endsWith('.app')) || inside(app, reportFile) || reportFile === dmg || reportFile === zip || inside(mount, reportFile) || inside(unpack, reportFile)) throw Error('Rapporten skal ligge uden for apps og installationsfiler.');
  }
  const report = { status: 'i gang', target: input.target, host: process.platform, startedAt: new Date().toISOString(), reportFile, temporaryDirectory: temp, inputs: { app, dmg, zip }, checks: [], apps: {}, cleanup: { detached: false, unpackRemoved: false }, limitations: ['Filindhold, symlinkmål og mode-bits kontrolleres; ejere, tider, ACL og øvrige xattrs sammenlignes ikke.', 'Signatur og staplet billet kontrolleres særskilt. ZIP-indsendelsens Apple-kvittering kontrolleres i udgivelsesforløbet.', 'Dette starter ikke appen og erstatter ikke en installations- eller opdateringsprøve.'] };
  const failures = [], abort = new AbortController(); let attemptedMount = false, attached = false, reportWritten = false;
  const interrupted = () => abort.abort();
  process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted);
  const command = async (label, executable, args, cleanup = false) => {
    log(label);
    try {
      const result = await run(executable, args, { timeout: 180000, maxBuffer: 16 * 1024 * 1024, ...(cleanup ? {} : { signal: abort.signal }) });
      report.checks.push({ name: label, status: 'bestået', output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim().slice(-2000) });
      return result.stdout || '';
    } catch (error) {
      report.checks.push({ name: label, status: 'fejlet', output: String(error.stderr || error.stdout || error.message).trim().slice(-2000) }); throw error;
    }
  };
  try {
    // Opret aldrig rapporten oven i en tidligere kontrol eller et symbolsk link.
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 }); reportWritten = true;
    await fs.mkdir(mount); await fs.mkdir(unpack);
    report.artifacts = { dmg: { sha256: await sha256(dmg) }, zip: { sha256: await sha256(zip) } };
    const original = await appManifest(app); report.apps.original = manifestSummary(original);
    attemptedMount = true;
    await command('Monter DMG skrivebeskyttet', '/usr/bin/hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, '-plist']); attached = true;
    const diskApp = await findApp(mount, path.basename(app));
    const listing = await command('Kontrollér ZIP-stier', '/usr/bin/unzip', ['-Z1', zip]);
    validateZipEntries(listing, path.basename(app));
    await command('Pak ZIP i egen testmappe', '/usr/bin/ditto', ['-x', '-k', zip, unpack]);
    const zipApp = await findApp(unpack, path.basename(app));
    const disk = await appManifest(diskApp), zipped = await appManifest(zipApp);
    report.apps.dmg = manifestSummary(disk); report.apps.zip = manifestSummary(zipped);
    compareManifests(original, disk, 'Original og DMG'); compareManifests(original, zipped, 'Original og ZIP'); compareManifests(disk, zipped, 'DMG og ZIP');
    report.checks.push({ name: 'De tre komplette apps har samme indhold, links og rettigheder', status: 'bestået' });
    for (const [name, bundle] of [['original', app], ['dmg', diskApp], ['zip', zipApp]]) {
      log('Kildekontrol: ' + name);
      report.apps[name].source = await sourceCheck(path.join(bundle, 'Contents', 'Resources'), input.target);
      await command('Kodesignatur: ' + name, '/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
      await command('Appens notarbillet: ' + name, '/usr/bin/xcrun', ['stapler', 'validate', bundle]);
      await command('Distributionskontrol: ' + name, '/usr/bin/syspolicy_check', ['distribution', bundle]);
    }
    await command('DMG-notarbillet', '/usr/bin/xcrun', ['stapler', 'validate', dmg]);
    compareManifests(original, await appManifest(app), 'Original før og efter kontrollen');
    if (await sha256(dmg) !== report.artifacts.dmg.sha256 || await sha256(zip) !== report.artifacts.zip.sha256) throw Error('En installationsfil blev ændret under kontrollen.');
  } catch (error) { failures.push({ message: String(error.message).slice(0, 4000), ...(error.differences ? { differences: error.differences } : {}) }); }
  finally {
    if (attemptedMount) {
      try {
        try { await command('Afmontér egen DMG', '/usr/bin/hdiutil', ['detach', mount], true); }
        catch { report.cleanup.forcedDetach = true; await command('Afmontér egen DMG efter afvisning', '/usr/bin/hdiutil', ['detach', '-force', mount], true); }
        report.cleanup.detached = true;
      } catch (error) { report.cleanup.detachError = error.message; if (attached) failures.push({ message: 'DMG kunne ikke afmonteres: ' + error.message }); }
    }
    if (abort.signal.aborted) failures.push({ message: 'Kontrollen blev afbrudt.' });
    report.status = failures.length ? 'fejlet' : 'bestået'; report.failures = failures; report.finishedAt = new Date().toISOString();
    try {
      if (reportWritten) {
        // Fejl og resultater er gemt, før kun vores egen ZIP-udpakning fjernes.
        await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
        await fs.rm(unpack, { recursive: true, force: true }); report.cleanup.unpackRemoved = true;
        if (!attemptedMount || report.cleanup.detached) await fs.rmdir(mount).catch(error => { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error; });
        await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
      }
    } catch (error) {
      failures.push({ message: 'Rapport eller oprydning mislykkedes: ' + error.message }); report.status = 'fejlet';
      if (reportWritten) await fs.writeFile(reportFile, JSON.stringify(report, null, 2)).catch(() => {});
    }
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
  }
  if (failures.length) { const error = Error(failures.map(item => item.message).join('\n')); error.reportFile = reportWritten ? reportFile : null; throw error; }
  return report;
}
if (require.main === module) {
  const [app, dmg, zip, target, reportFile, extra] = process.argv.slice(2);
  if (!app || !dmg || !zip || !target || extra) { console.error('Brug: node scripts/verify-mac-artifacts.cjs ORIGINAL.app FINAL.dmg FINAL.zip darwin-arm64|darwin-x64 [RAPPORT.json]'); process.exitCode = 1; }
  else verifyMacArtifacts({ app, dmg, zip, target, reportFile }, { log: message => console.error(message) }).then(report => console.log(JSON.stringify({ status: report.status, reportFile: report.reportFile, target: report.target, apps: report.apps, cleanup: report.cleanup }, null, 2))).catch(error => { console.error(error.message + (error.reportFile ? '\nRapport: ' + error.reportFile : '')); process.exitCode = 1; });
}
module.exports = { verifyMacArtifacts, appManifest, compareManifests, findApp, validateZipEntries };
