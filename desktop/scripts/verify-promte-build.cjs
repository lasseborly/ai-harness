// Byg den faktiske projektkilde i en isoleret kopi med rigtig npm og Vite.
// Kun offentlige npm-cacheposter fra projektets lockfil læses. Intet netværk eller Git.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { buildSaved } = require('../core/komplai-build.cjs');
const { environment, inspect } = require('../core/dev-server.cjs');
const run = promisify(execFile), hash = data => createHash('sha256').update(data).digest('hex');

(async () => {
  const [project, nodeDirectory, cacheSource] = process.argv.slice(2);
  if (!project || !nodeDirectory || !cacheSource) throw Error('Angiv projekt, Node-mappe og npm-cache.');
  const node = path.join(nodeDirectory, 'bin/node'), npm = path.join(nodeDirectory, 'lib/node_modules/npm/bin/npm-cli.js');
  const npmRequire = createRequire(npm), cacache = npmRequire('cacache');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-promte-byg-'))), cache = path.join(root, 'cache');
  const files = [];
  async function copySource(name) {
    const file = path.join(project, name); let stat;
    try { stat = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw Error('Kildekopien må ikke indeholde links.');
    if (stat.isDirectory()) { for (const entry of await fs.readdir(file)) await copySource(name + '/' + entry); return; }
    const data = await fs.readFile(file); files.push({ file: name, data, sha256: hash(data) });
  }
  for (const name of ['package.json', 'package-lock.json', 'index.html', 'src', 'public']) await copySource(name);
  const lock = JSON.parse(files.find(f => f.file === 'package-lock.json').data);
  let cached = 0;
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name || !entry.integrity || !entry.resolved?.startsWith('https://registry.npmjs.org/')) continue;
    try {
      const data = await cacache.get.byDigest(path.join(cacheSource, '_cacache'), entry.integrity);
      await cacache.put(path.join(cache, '_cacache'), `make-fetch-happen:request-cache:${entry.resolved}`, data, { integrity: entry.integrity, metadata: { time: Date.now(), url: entry.resolved, reqHeaders: {}, resHeaders: { 'content-type': 'application/octet-stream' }, options: { compress: true } } });
      cached++;
    } catch (error) { if (!['ENOENT', 'ENOTCACHED'].includes(error.code)) throw error; }
  }
  // npm undersøger peer-versioner i Reacts offentlige katalog før ERESOLVE.
  for (const name of ['react', 'react-dom', '@promte%2fapp-library']) {
    const url = `https://registry.npmjs.org/${name}`, key = `make-fetch-happen:request-cache:${url}`;
    try {
      const { data } = await cacache.get(path.join(cacheSource, '_cacache'), key);
      // npm varierer katalogets Accept-header. Begge formater kan læses fra det fulde katalog.
      for (const accept of ['application/json', 'application/vnd.npm.install-v1+json']) await cacache.put(path.join(cache, '_cacache'), key, data, { metadata: { time: Date.now(), url, reqHeaders: { accept }, resHeaders: { 'content-type': 'application/json', vary: 'accept' }, options: { compress: true } } });
    } catch (error) { if (!['ENOENT', 'ENOTCACHED'].includes(error.code)) throw error; }
  }
  const wrapper = path.join(root, 'npm-isoleret.cjs'), calls = path.join(root, 'npm-kald.jsonl');
  for (const name of ['user.npmrc', 'global.npmrc']) await fs.writeFile(path.join(root, name), '');
  await fs.writeFile(wrapper, `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');Object.assign(process.env,${JSON.stringify({ npm_config_cache: cache, npm_config_offline: 'true', npm_config_userconfig: path.join(root, 'user.npmrc'), npm_config_globalconfig: path.join(root, 'global.npmrc'), npm_config_update_notifier: 'false' })});require(${JSON.stringify(npm)});`);
  const before = path.join(root, 'foer'); await fs.mkdir(before);
  for (const file of files) { const target = path.join(before, file.file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.data); }
  let errorBefore = '';
  try { await run(node, [wrapper, 'ci', '--no-audit', '--no-fund', '--include=dev', '--ignore-scripts'], { cwd: before, env: environment(), timeout: 60000, maxBuffer: 2e6 }); }
  catch (error) { errorBefore = (error.stderr || '') + (error.stdout || ''); }
  assert.match(errorBefore, /^npm (?:error|ERR!) code ERESOLVE\s*$/m, 'rigtig npm skal afslutte med ERESOLVE; en advarsel er ikke nok');
  console.log(`Den faktiske peer-konflikt er reproduceret. ${cached} låste pakker er kopieret fra lokal cache.`);
  const source = { root: project, head: 'lokal-kildekopi', hash: hash(JSON.stringify(files.map(f => [f.file, f.sha256]))), files, version: { name: 'Isoleret prøve' } };
  const built = await buildSaved(source, { runtime: async () => ({ node, npm: wrapper }), timeout: 60000 });
  assert.match(built.built.install, /--legacy-peer-deps/);
  assert.ok(built.files.some(f => f.file === 'index.html'));
  assert.ok(built.files.some(f => f.file.endsWith('.js') && f.data.toString().includes('waiting_for_token')), 'den faktiske Promte-klient er stadig i appen');
  const inspected = await inspect(before); assert.deepEqual(inspected.installPolicy.args, ['--legacy-peer-deps']);
  const args = (await fs.readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(args[1], ['ci', '--no-audit', '--no-fund', '--include=dev', '--ignore-scripts', '--legacy-peer-deps']);
  assert.deepEqual(args[2], ['run', 'build']);
  for (const file of files) assert.equal(hash(await fs.readFile(path.join(project, file.file))), file.sha256, 'brugerens kilde er uændret');
  const report = { status: 'bestået', cachedPackages: cached, install: built.built.install, files: built.files.map(f => f.file), bytes: built.bytes, checks: ['faktisk npm ERESOLVE før rettelsen', 'produktionsbygger bruger den snævre Promte-policy', 'faktisk Vite bygger kildekopien', 'lokal preview-install genbruger samme policy', 'originale kildefiler er uændrede'], limitations: ['ingen upload eller providerkald', 'Promte-login og data kræver fortsat Promte-vært', 'offlinepakker fra eksisterende cache'], errorBefore };
  await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, root, rapport: path.join(root, 'rapport.json') }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
