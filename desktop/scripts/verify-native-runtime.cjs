// Lokal regression: kopier af den installerede Node og projektets faktiske pakker.
// Kun kopien signeres ad hoc; ingen app-pakke, brugerfil eller installation ændres.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { environment, terminate } = require('../core/dev-server.cjs');
const { signingOptions } = require('./sign-mac.cjs');
const run = promisify(execFile);
const digest = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');

(async () => {
  const [installedApp, projectSource] = process.argv.slice(2);
  if (process.platform !== 'darwin' || !installedApp || !projectSource) throw Error('Angiv den installerede Mac-app og projektmappen.');
  const installedNode = path.join(installedApp, 'Contents/Resources/runtime/node/bin/node');
  const addonSource = path.join(projectSource, `node_modules/@rollup/rollup-darwin-${process.arch}/rollup.darwin-${process.arch}.node`);
  const before = [await digest(installedNode), await digest(addonSource)];
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-native-runtime-'))), appCopy = path.join(root, 'Aura.app');
  const node = path.join(appCopy, 'Contents/Resources/runtime/node/bin/node'), project = path.join(root, 'Projektkopi'), addon = path.join(root, path.basename(addonSource));
  await fs.mkdir(path.dirname(node), { recursive: true }); await fs.mkdir(project);
  await fs.copyFile(installedNode, node); await fs.copyFile(addonSource, addon);
  const load = ['-e', 'const native=require(process.argv[1]); console.log(typeof native.parse)', addon];
  let beforeError = '';
  try { await run(node, load, { env: environment(), timeout: 20000 }); } catch (error) { beforeError = error.stderr || error.message; }
  assert.match(beforeError, /not valid for use in process|different Team IDs|no Team ID|library validation|code signature/i, 'den signerede originale Node skal ramme den faktiske native-blokering');
  console.log('Original Node: native-blokeringen er reproduceret.');
  const options = signingOptions({ app: appCopy }).optionsForFile(node);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', options.entitlements, node]);
  await run('/usr/bin/codesign', ['--verify', '--strict', node]);
  assert.equal((await run(node, load, { env: environment(), timeout: 20000 })).stdout.trim(), 'function');
  console.log('Node-kopi: den faktiske Rollup-pakke kan indlæses med de specifikke tilladelser.');
  for (const name of ['package.json', 'package-lock.json', 'index.html', 'src', 'public', 'node_modules']) {
    try { await fs.cp(path.join(projectSource, name), path.join(project, name), { recursive: true, verbatimSymlinks: true, errorOnExist: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // Vis den gamle importfejl med præcis projektets Vite-installation.
  const oldImport = `const {createRequire}=require('node:module');const{pathToFileURL}=require('node:url');(async()=>{const r=createRequire(process.argv[1]+'/package.json'),m=await import(pathToFileURL(r.resolve('vite')).href);await m.createServer()})().catch(e=>{console.error(e.message);process.exitCode=1})`;
  let oldError = '';
  try { await run(node, ['-e', oldImport, project], { env: environment(), timeout: 20000 }); } catch (error) { oldError = error.stderr || error.message; }
  assert.match(oldError, /createServer is not a function/);
  console.log('Projektkopi: Vite-fejlen er reproduceret med den gamle import.');
  let child, log = '';
  try {
    child = spawn(node, [path.resolve(__dirname, '../core/dev-server-runner.cjs'), project, 'vite'], { cwd: project, env: environment(), detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Vite blev ikke klar: ' + log)), 30000);
      child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(Error(`Vite stoppede (${code}): ${log}`)); });
      child.on('message', message => { if (message?.type === 'ready') { clearTimeout(timer); resolve(message.url); } });
    });
    assert.equal((await fetch(url, { signal: AbortSignal.timeout(15000) })).status, 200);
    const jsx = await fetch(new URL('/src/main.jsx', url), { signal: AbortSignal.timeout(15000) }); assert.equal(jsx.status, 200); assert.match(await jsx.text(), /React|createRoot/);
    assert.doesNotMatch(log, /CJS build of Vite|createServer is not a function|ERR_DLOPEN/);
  } finally { await terminate(child); }
  assert.deepEqual([await digest(installedNode), await digest(addonSource)], before, 'installeret app og brugerens native pakke er uændrede');
  await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify({ status: 'bestået', beforeError, oldError, checks: ['original signeret Node rammer native-fejlen', 'Node-kopi med per-file entitlements indlæser faktisk Rollup', 'original Vite 5 CJS-fejl reproduceret', 'rettet runner serverer faktisk app og kompileret JSX'], limitations: ['ad hoc-signering af isoleret Node-kopi', 'ny Developer ID-signeret/notariseret app endnu ikke bygget', 'ingen modelkald, Git-ændringer eller eksterne providerkald'] }, null, 2));
  console.log(JSON.stringify({ status: 'bestået', root, rapport: path.join(root, 'rapport.json') }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
