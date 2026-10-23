const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DevServer, inspect, environment, cleanOutput, nodeRuntime } = require('../core/dev-server.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 200; i++) { if (await check()) return; await wait(50); } throw new Error('Tilstanden blev ikke nået.'); }
async function fixture(t, pkg = { scripts: { dev: 'vite' }, devDependencies: { vite: '8.3.1' } }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-server-test-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg));
  await fs.writeFile(path.join(root, '.npmrc'), `cache=${path.join(root, '.npm-cache')}\n`);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('genkendelse skriver intet og udfører aldrig package-scripts eller konfiguration', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'vite.config.js'), 'throw new Error("MÅ IKKE KØRES")');
  const before = await fs.readdir(root);
  const found = await inspect(root);
  assert.equal(found.kind, 'vite'); assert.equal(found.supported, true); assert.equal(found.installed, false);
  assert.deepEqual(await fs.readdir(root), before);
  await fs.writeFile(path.join(root, 'yarn.lock'), '');
  assert.match((await inspect(root)).reason, /anden pakkehåndtering/);
  await fs.unlink(path.join(root, 'yarn.lock'));
  await fs.writeFile(path.join(root, 'package.json'), '{');
  assert.equal((await inspect(root)).supported, false);
});
test('npm-kommandoer kommer til gennemgang; ukendte arbejdsområder starter ikke automatisk', async t => {
  for (const script of ['vite && echo slut', 'next dev']) {
    const project = await inspect(await fixture(t, { scripts: { dev: script } }));
    assert.equal(project.supported, true); assert.equal(project.kind, 'services'); assert.equal(project.services[0].declaredScript, script);
  }
  assert.equal((await inspect(await fixture(t, { workspaces: ['apps/*'], scripts: { dev: 'vite' }, dependencies: { vite: '8' } }))).supported, false);
});
test('godkendelse binder handlingen til uændret opsætning og kan ikke genbruges', async t => {
  const root = await fixture(t), manager = new DevServer();
  await manager.activate(root); const review = await manager.prepare('install');
  await fs.writeFile(path.join(root, '.npmrc'), 'registry=https://example.invalid/');
  await assert.rejects(manager.execute(review.token), /opsætning er ændret/);
  await assert.rejects(manager.execute(review.token), /Gennemgå/);
  const second = await manager.prepare('install');
  await manager.activate(await fixture(t));
  await assert.rejects(manager.execute(second.token), /Gennemgå/);
  assert.equal(manager.child, null);
});
test('manglende installation og links ud af projektet afvises', async t => {
  const root = await fixture(t), manager = new DevServer(); await manager.activate(root);
  await assert.rejects(manager.prepare('start'), /Installér/);
  const other = await fixture(t); await fs.symlink(other, path.join(root, 'node_modules'), 'junction');
  await assert.rejects(inspect(root), /anden mappe/);
});
test('barnets miljø udelader modelnøgler og kodeinjektion; almindelige nøgler maskeres i log', () => {
  const env = environment({ PATH: '/bin', HOME: '/home/test', OPENROUTER_API_KEY: 'private', NODE_OPTIONS: '--require evil', NPM_TOKEN: 'private', AWS_SECRET_ACCESS_KEY: 'private', ELECTRON_RUN_AS_NODE: '1' });
  assert.equal(env.HOME, '/home/test');
  for (const key of ['OPENROUTER_API_KEY', 'NODE_OPTIONS', 'NPM_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'ELECTRON_RUN_AS_NODE']) assert.equal(env[key], undefined);
  assert.ok(!cleanOutput('\x1b[31mapi_key=private token: private https://user:password@example.com sk-or-v1-abcdefghijklmnop').includes('private'));
  assert.ok(!cleanOutput('https://user:password@example.com').includes('password'));
});
test('manglende Node fører til en konkret fejl uden automatisk installation', async () => {
  const saved = process.env.PATH; process.env.PATH = path.join(os.tmpdir(), 'harness-nonexistent-path');
  try { await assert.rejects(nodeRuntime(), /Node.js 22.12/); } finally { process.env.PATH = saved; }
});
test('rigtig npm-fejl bevarer projektet og kan gennemgås igen', async t => {
  const root = await fixture(t, { name: 'harness-fejl', scripts: { dev: 'vite' }, dependencies: { vite: 'file:./findes-ikke.tgz' } });
  const manager = new DevServer(); await manager.activate(root); t.after(() => manager.stop());
  const original = await fs.readFile(path.join(root, 'package.json'), 'utf8');
  await manager.execute((await manager.prepare('install')).token);
  await until(() => manager.state === 'error');
  assert.match(manager.message, /Installationen/); assert.match(manager.output, /ENOENT/);
  assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), original);
  assert.ok((await manager.prepare('install')).token);
});
test('npm med en manglende lokal pakkemappe erklæres ikke klar trods exitkode nul', async t => {
  const root = await fixture(t, { name: 'harness-tom-pakke', scripts: { dev: 'vite' }, dependencies: { vite: 'file:./findes-ikke' } });
  const manager = new DevServer(); await manager.activate(root); t.after(() => manager.stop());
  await manager.execute((await manager.prepare('install')).token);
  await until(() => manager.state === 'error');
  assert.match(manager.message, /frameworkets pakke mangler/);
});
test('stop under rigtig installation lukker også pakkescriptets underproces', async t => {
  const root = await fixture(t, { name: 'harness-stop', scripts: { dev: 'vite', postinstall: 'node slow.cjs' }, dependencies: { vite: 'file:./fixture-vite' } });
  await fs.mkdir(path.join(root, 'fixture-vite'));
  await fs.writeFile(path.join(root, 'fixture-vite/package.json'), JSON.stringify({ name: 'vite', version: '1.0.0' }));
  await fs.writeFile(path.join(root, 'slow.cjs'), `const{spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('underproces.json',JSON.stringify({pid:child.pid}));setInterval(()=>{},1000);`);
  const manager = new DevServer(); await manager.activate(root); t.after(() => manager.stop());
  const review = await manager.prepare('install', true); assert.equal(review.scripts, true);
  await manager.execute(review.token);
  await until(async () => { try { await fs.access(path.join(root, 'underproces.json')); return true; } catch { return false; } });
  const { pid } = JSON.parse(await fs.readFile(path.join(root, 'underproces.json'), 'utf8'));
  await manager.stop(); assert.equal(manager.state, 'stopped');
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
  await wait(100); assert.equal(manager.state, 'stopped'); assert.equal(manager.url, null);
});
