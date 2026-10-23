// Afprøv den signerede pakkes Node og Vite-runner på en kopi af et rigtigt projekt.
// Appen og projektkilden ændres ikke. Ingen modelkald, Git-skrivninger eller upload.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { environment, terminate } = require('../core/dev-server.cjs');
const run = promisify(execFile);
(async () => {
  const [bundle, source] = process.argv.slice(2);
  if (process.platform !== 'darwin' || !bundle?.endsWith('.app') || !source) throw Error('Angiv den signerede Mac-app og et eksisterende Vite-projekt.');
  const app = await fs.realpath(bundle), resources = path.join(app, 'Contents/Resources');
  const node = path.join(resources, 'runtime/node/bin/node');
  const runner = path.join(resources, 'app.asar.unpacked/core/dev-server-runner.cjs');
  await run('codesign', ['--verify', '--deep', '--strict', app]);
  const details = await run('codesign', ['--display', '--verbose=4', '--entitlements', ':-', node]);
  assert.match(details.stderr, /TeamIdentifier=2UX98897JW/);
  assert.match(details.stdout + details.stderr, /com\.apple\.security\.cs\.disable-library-validation/);
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-signeret-runtime-')));
  const project = path.join(root, 'Projektkopi');
  await run('/bin/cp', ['-cR', await fs.realpath(source), project]);
  const addon = path.join(project, `node_modules/@rollup/rollup-darwin-${process.arch}/rollup.darwin-${process.arch}.node`);
  assert.equal((await run(node, ['-e', 'console.log(typeof require(process.argv[1]).parse)', addon], { env: environment(), timeout: 20000 })).stdout.trim(), 'function');
  let child, log = '';
  try {
    child = spawn(node, [runner, project, 'vite'], { cwd: project, env: environment(), detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Vite blev ikke klar: ' + log)), 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error(`Vite stoppede (${code}): ${log}`)); });
      child.on('message', message => { if (message?.type === 'ready') { clearTimeout(timer); resolve(message.url); } });
    });
    assert.equal((await fetch(url, { signal: AbortSignal.timeout(15000) })).status, 200);
    const jsx = await fetch(new URL('/src/main.jsx', url), { signal: AbortSignal.timeout(15000) });
    assert.equal(jsx.status, 200); assert.match(await jsx.text(), /React|createRoot/);
    assert.doesNotMatch(log, /CJS build of Vite|createServer is not a function|ERR_DLOPEN/);
  } finally { await terminate(child); }
  await run('codesign', ['--verify', '--deep', '--strict', app]);
  const report = { status: 'bestået', app, source: await fs.realpath(source), platform: process.platform, architecture: process.arch, checks: ['Developer ID-signeret Node indlæser faktisk native Rollup', 'pakkens runner serverer Vite-projekt og kompileret JSX', 'appens signatur består før og efter'], limitation: 'Projektkopi på denne Mac; ingen eksterne login- eller datakald.' };
  await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: path.join(root, 'rapport.json') }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
