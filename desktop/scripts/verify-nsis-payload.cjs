// Udpakker kun til en ny midlertidig mappe. Starter ikke installationsprogrammet.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);
async function hash(file) { const sum = createHash('sha256'); for await (const chunk of createReadStream(file)) sum.update(chunk); return sum.digest('hex'); }
async function files(directory, prefix = '') {
  const found = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) found.push(...await files(directory, name + '/'));
    else { assert.ok(entry.isFile(), 'Uventet link eller specialfil i installationspayload: ' + name); found.push(name); }
  }
  return found.sort();
}
async function verify(installer, unpacked, sevenZip) {
  installer = await fs.realpath(installer); unpacked = await fs.realpath(unpacked); sevenZip = await fs.realpath(sevenZip);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-nsis-payload-'));
  const envelope = path.join(root, 'envelope'), payload = path.join(root, 'payload');
  console.log('Testmateriale: ' + root);
  const invoke = args => run(sevenZip, args, { maxBuffer: 10 * 1024 * 1024, timeout: 300000 });
  const listing = (await invoke(['l', '-slt', installer])).stdout.replaceAll('\\', '/').replaceAll('\r', '');
  assert.match(listing, /Type = Nsis/);
  const archives = [...listing.matchAll(/^Path = (\$PLUGINSDIR\/app-(?:64|arm64)\.7z)$/gm)].map(match => match[1]);
  assert.equal(archives.length, 1, 'Prøven kræver præcis én x64- eller ARM64-payload i NSIS.');
  await invoke(['e', '-y', '-o' + envelope, installer, archives[0]]);
  await invoke(['x', '-y', '-o' + payload, path.join(envelope, path.basename(archives[0]))]);
  const actual = await files(payload), expected = await files(unpacked); assert.deepEqual(actual, expected, 'NSIS og den kontrollerede udpakkede pakke indeholder forskellige filer.');
  const manifest = [];
  for (const name of actual) {
    const digest = await hash(path.join(payload, name));
    assert.equal(digest, await hash(path.join(unpacked, name)), 'NSIS indeholder andre bytes: ' + name);
    manifest.push({ path: name, bytes: (await fs.stat(path.join(payload, name))).size, sha256: digest });
  }
  const manifestPath = path.join(root, 'payload-files.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const report = { status: 'bestået', installer, installerSha256: await hash(installer), unpacked, files: actual.length, identical: true, manifest: path.basename(manifestPath), manifestSha256: await hash(manifestPath), checkedAt: new Date().toISOString(), limitation: 'NSIS-payload udtrukket og sammenlignet byte for byte; installationsprogrammet er ikke kørt.' };
  await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2));
  // Kun egne genererede ekstrakter fjernes. Rapporten og begge inputpakker bevares.
  await fs.rm(envelope, { recursive: true }); await fs.rm(payload, { recursive: true });
  return { ...report, root };
}
if (require.main === module) {
  const [installer, unpacked, sevenZip] = process.argv.slice(2);
  if (!installer || !unpacked || !sevenZip) { console.error('Angiv NSIS-fil, win-unpacked-mappe og lokal 7-Zip-binær. Intet downloades.'); process.exitCode = 1; }
  else verify(installer, unpacked, sevenZip).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verify };
