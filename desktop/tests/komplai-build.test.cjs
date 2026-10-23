const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { komplaiSource, buildSaved } = require('../core/komplai-build.cjs');
const { Deployments, configuration } = require('../core/deployments.cjs');
const sha256 = data => createHash('sha256').update(data).digest('hex');

function savedFiles(files) {
  return { read: async (_root, args) => {
    if (args[0] === 'ls-tree') return Buffer.from(Object.keys(files).join('\0'));
    assert.deepEqual(args, ['show', 'HEAD:package.json']);
    return Buffer.from(files['package.json']);
  } };
}
// Opdigtet npm, der opfører sig som npm ci og npm run build i den midlertidige kopi. Ingen netværk.
async function fakeNpm(t, behaviour) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-falsk-npm-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const npm = path.join(dir, 'npm-cli.js');
  await fs.writeFile(npm, `const fs = require('node:fs'), path = require('node:path'), args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(dir, 'kald.log'))}, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
const behaviour = ${JSON.stringify(behaviour)};
if (args[0] === 'run' && args[1] === 'build') {
  if (behaviour.build === 'fail') { console.error('src/App.jsx: Unexpected token'); process.exit(1); }
  fs.mkdirSync('dist/assets', { recursive: true });
  fs.writeFileSync('dist/index.html', '<!doctype html><title>Bygget</title><script src="assets/app.js"></script>');
  fs.writeFileSync('dist/assets/app.js', 'document.title = "Bygget";');
  fs.writeFileSync('dist/assets/app.js.map', '{"sources":["src/App.jsx"]}');
  if (behaviour.secret) fs.writeFileSync('dist/assets/secret.js', 'const key = "ghp_' + 'a'.repeat(36) + '";');
} else if (behaviour.install === 'fail') { console.error(behaviour.installError || 'npm ERR! network request failed'); process.exit(1); }
`);
  return { runtime: async () => ({ node: process.execPath, npm }), calls: async () => (await fs.readFile(path.join(dir, 'kald.log'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse) };
}
function source(files) {
  const list = Object.entries(files).map(([file, content]) => ({ file, data: Buffer.from(content), sha256: sha256(content) }));
  return { root: '/projekt', head: 'a'.repeat(40), hash: 'kilde', files: list, version: { name: 'Prøve', at: null } };
}
const vite = { 'package.json': JSON.stringify({ private: true, scripts: { build: 'vite build' }, devDependencies: { vite: '5.4.10' } }), 'package-lock.json': '{}', 'index.html': '<div id="root"></div>', 'src/main.jsx': 'console.log(1)' };

test('komplai bruger en gemt byggemappe, tilbyder bygning ved et byggescript og ellers public som hidtil', async () => {
  assert.deepEqual(await komplaiSource('/projekt', savedFiles({ ...vite, 'dist/index.html': '<h1>Bygget</h1>' })), { directory: 'dist', build: false });
  assert.deepEqual(await komplaiSource('/projekt', savedFiles(vite)), { directory: 'dist', build: true, script: 'vite build' });
  assert.deepEqual(await komplaiSource('/projekt', savedFiles({ 'public/index.html': '<h1>Statisk</h1>' })), { directory: 'public', build: false });
  assert.deepEqual(await komplaiSource('/projekt', savedFiles({ 'README.md': 'x' })), { directory: 'public', build: false });
});

test('den lokale bygning sker i en midlertidig kopi med medfølgende npm og uden installationsscripts', async t => {
  const npm = await fakeNpm(t, {});
  const built = await buildSaved(source(vite), { runtime: npm.runtime });
  assert.deepEqual(built.files.map(f => f.file), ['assets/app.js', 'index.html']);
  assert.deepEqual(built.excludedFiles, ['assets/app.js.map'], 'kildekort udgives ikke');
  assert.deepEqual(built.built, { script: 'vite build', install: 'npm ci', output: 'dist' });
  assert.equal(built.head, 'a'.repeat(40));
  const calls = await npm.calls();
  assert.deepEqual(calls.map(c => c.args), [['ci', '--no-audit', '--no-fund', '--include=dev', '--ignore-scripts'], ['run', 'build']]);
  assert.ok(path.basename(calls[0].cwd).startsWith('aura-byg-'), 'bygningen sker uden for projektmappen');
  await assert.rejects(fs.access(calls[0].cwd), 'den midlertidige kopi slettes bagefter');
  const { 'package-lock.json': _lock, ...withoutLock } = vite;
  await buildSaved(source(withoutLock), { runtime: npm.runtime });
  assert.equal((await npm.calls()).at(-2).args[0], 'install', 'uden låsefil bruges npm install');
});

test('fejl i installation, bygning og indhold stopper med en forståelig besked', async t => {
  await assert.rejects(buildSaved(source(vite), { runtime: (await fakeNpm(t, { install: 'fail' })).runtime }), /Pakkerne kunne ikke hentes.*forbindelsen.*network request failed/);
  await assert.rejects(buildSaved(source(vite), { runtime: (await fakeNpm(t, { install: 'fail', installError: 'npm error code ERESOLVE\nnpm error peer react@^18.2.0 from @promte/app-library@0.1.8' })).runtime }), error => /Pakkeversionerne.*ERESOLVE/.test(error.message) && !/netværk|forbindelse/.test(error.message));
  await assert.rejects(buildSaved(source(vite), { runtime: (await fakeNpm(t, { install: 'fail', installError: 'npm warn ERESOLVE overriding peer dependency\nnpm warn peer react@^18.2.0 from @promte/app-library@0.1.8\nnpm error code ENOTCACHED\nnpm error cache miss\nnpm error offline request failed' })).runtime }), error => /pakkecache.*ENOTCACHED/.test(error.message) && !/ERESOLVE|peer react/.test(error.message));
  await assert.rejects(buildSaved(source(vite), { runtime: (await fakeNpm(t, { build: 'fail' })).runtime }), /Bygningen fejlede.*Unexpected token/);
  await assert.rejects(buildSaved(source(vite), { runtime: (await fakeNpm(t, { secret: true })).runtime }), /Mulig hemmelighed i den byggede fil assets\/secret\.js/);
  await assert.rejects(buildSaved(source({ ...vite, 'pnpm-lock.yaml': '' }), { runtime: (await fakeNpm(t, {})).runtime }), /kun projekter, der bruger npm/);
  await assert.rejects(buildSaved(source({ 'index.html': '<h1>Uden pakke</h1>' }), { runtime: (await fakeNpm(t, {})).runtime }), /intet byggescript/);
});

test('Udgiv bygger kun efter valg, og gennemgang og upload bruger samme bygning af samme version', async () => {
  assert.equal(configuration({ provider: 'komplai', visibility: 'private', name: 'App' }).build, undefined, 'ingen bygning uden brugerens valg');
  assert.equal(configuration({ provider: 'komplai', visibility: 'private', name: 'App', build: true }).build, true);
  let state = {}, builds = 0, head = 'a'.repeat(40);
  const store = { project: async () => state, saveProject: async (_root, patch) => Object.assign(state, patch) };
  const page = Buffer.from('<h1>Bygget</h1>'), uploaded = [];
  const provider = { inspect: async () => ({ id: null, created: true, name: 'App', owner: 'Prøvekommune', region: 'EU' }), deploy: async (_c, a) => { uploaded.push(a.files.map(f => f.file)); return { id: 'app', state: 'READY', url: 'https://app.komplai.run' }; } };
  const deployments = new Deployments(store, { providers: { komplai: provider }, artifact: async () => ({ ...source(vite), head, hash: 'kilde-' + head }), builder: async src => { builds++; return { root: src.root, directory: 'dist', head: src.head, hash: 'bygget-' + src.head, bytes: page.length, files: [{ file: 'index.html', data: page, sha256: sha256(page) }], version: src.version, built: { script: 'vite build', install: 'npm ci', output: 'dist' } }; } });
  const review = await deployments.review('/projekt', { provider: 'komplai', visibility: 'private', name: 'App', build: true });
  assert.deepEqual(review.built, { script: 'vite build', install: 'npm ci', output: 'dist' });
  assert.equal(review.config.directory, 'dist');
  assert.match(review.build, /byggede appen på din computer.*npm ci og vite build, uden pakkernes installationsscripts/);
  assert.match(review.material, /bygget fra denne Git-version/);
  await deployments.deploy('/projekt', review.token);
  assert.equal(builds, 1, 'upload genbruger den gennemgåede bygning'); assert.deepEqual(uploaded, [['index.html']]);
  assert.deepEqual(await deployments.source('/projekt'), { directory: 'dist', build: true, saved: true }, 'projektet husker valget');
  // En ny gemt version bygges igen; en gammel opsætning med public beholder sin mappe.
  head = 'b'.repeat(40); await deployments.review('/projekt', { provider: 'komplai', visibility: 'private', name: 'App', build: true }); assert.equal(builds, 2);
  state = { deploymentConfig: { provider: 'komplai', directory: 'public', visibility: 'private', appId: '11111111-2222-4333-8444-555555555555' } };
  assert.deepEqual(await deployments.source('/projekt'), { directory: 'public', build: false, saved: true });
});
