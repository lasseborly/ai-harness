const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { command, windowsLaunch } = require('../core/deployment-providers.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-cli-start-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'Program Files (test) & æøå');
  await fs.mkdir(bin);
  return { root, bin, env: { PATH: `"${bin}"` }, options: { paths: path, node: process.execPath, cwd: root } };
}
async function npmLauncher(bin, name, target) {
  await fs.writeFile(path.join(bin, `${name}.cmd`), [
    '@ECHO off',
    'SET dp0=%~dp0',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\${target}" %*`,
    ''
  ].join('\r\n'));
  const script = path.join(bin, ...target.split('\\'));
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  return script;
}

test('Windows npm-start bevarer argumenter til Vercel, SWA og Promte uden en shell', async t => {
  const f = await fixture(t);
  const args = ['/v6/deployments?projectId=prj_1&target=production&state=READY', '--resource-group=Afdeling_(Øst)', '" & echo forkert', '%PATH%', 'flere\nlinjer', 'C:\\mappe med mellemrum\\'];
  for (const [name, target] of [
    ['vercel', 'node_modules\\vercel\\dist\\index.js'],
    ['swa', 'node_modules\\@azure\\static-web-apps-cli\\dist\\cli\\index.js'],
    ['promte-app-upload', 'node_modules\\@promte\\app-upload\\dist\\cli.js']
  ]) {
    const script = await npmLauncher(f.bin, name, target);
    const launch = await windowsLaunch(name, args, f.env, f.options);
    assert.equal(launch.executable, process.execPath);
    assert.deepEqual(launch.args, [script, ...args]);
    assert.deepEqual(JSON.parse(await command(launch.executable, launch.args)), args);
  }
});

test('Windows starter Azure CLI med dens egen Python og uændrede argumenter', async t => {
  const f = await fixture(t), wbin = path.join(f.bin, 'wbin');
  await fs.mkdir(wbin);
  await fs.writeFile(path.join(f.bin, 'python.exe'), 'lokal prøve');
  await fs.writeFile(path.join(wbin, 'az.cmd'), '@IF EXIST "%~dp0\\..\\python.exe" (\r\n SET AZ_INSTALLER=MSI\r\n "%~dp0\\..\\python.exe" -IBm azure.cli %*\r\n) ELSE (\r\n exit /b 1\r\n)\r\n');
  const args = ['staticwebapp', 'show', '--resource-group=Kommune_(Øst)', '--subscription', 'sub-1'];
  const launch = await windowsLaunch('az', args, { PATH: wbin }, f.options);
  assert.equal(launch.executable, path.join(f.bin, 'python.exe'));
  assert.deepEqual(launch.args, ['-IBm', 'azure.cli', ...args]);
  assert.deepEqual(launch.extra, { AZ_INSTALLER: 'MSI' });
});

test('Windows bruger den tilstødende Node eller finder en native Node i PATH', async t => {
  const f = await fixture(t);
  await npmLauncher(f.bin, 'vercel', 'node_modules\\vercel\\index.js');
  const adjacent = path.join(f.bin, 'node.exe');
  await fs.writeFile(adjacent, 'lokal prøve');
  assert.equal((await windowsLaunch('vercel.cmd', [], f.env, f.options)).executable, adjacent);
  await fs.rm(adjacent);
  const tools = path.join(f.root, 'tools');
  await fs.mkdir(tools);
  await fs.writeFile(path.join(tools, 'node.exe'), 'lokal prøve');
  assert.equal((await windowsLaunch('vercel', [], { PATH: `${f.bin};${tools}` }, { ...f.options, node: null })).executable, path.join(tools, 'node.exe'));
});

test('Windows accepterer native værktøjer og en eksplicit fuld sti', async t => {
  const f = await fixture(t), exe = path.join(f.bin, 'gh.exe');
  await fs.writeFile(exe, 'lokal prøve');
  assert.deepEqual(await windowsLaunch(exe, ['auth', 'token'], {}, f.options), { executable: exe, args: ['auth', 'token'], extra: {} });
});

test('Ukendte batchfiler og npm-wrappers med ekstra fortolkning afvises', async t => {
  const f = await fixture(t), file = path.join(f.bin, 'custom.cmd');
  await fs.writeFile(file, '@echo off\r\necho skulle ikke køres\r\n');
  await assert.rejects(windowsLaunch(file, [], f.env, f.options), /startfil understøttes ikke/);
  await npmLauncher(f.bin, 'vercel', 'node_modules\\vercel\\index.js');
  const vercel = path.join(f.bin, 'vercel.cmd');
  await fs.writeFile(vercel, (await fs.readFile(vercel, 'utf8')).replace('"%_prog%"  ', '"%_prog%" --eval "forkert" '));
  await assert.rejects(windowsLaunch(vercel, [], f.env, f.options), /startfil understøttes ikke/);
});

test('Manglende script, Node eller Azure-Python afvises uden batchfallback', async t => {
  const f = await fixture(t), script = await npmLauncher(f.bin, 'vercel', 'node_modules\\vercel\\index.js');
  await assert.rejects(windowsLaunch('vercel', [], f.env, { ...f.options, node: null }), /blev ikke fundet/);
  await fs.rm(script);
  await assert.rejects(windowsLaunch('vercel', [], f.env, f.options), /blev ikke fundet/);
  await fs.writeFile(path.join(f.bin, 'az.cmd'), '"%~dp0..\\python.exe" -IBm azure.cli %*\r\n');
  await assert.rejects(windowsLaunch('az', [], f.env, f.options), /blev ikke fundet/);
});

test('Ældre npm-wrapper peger direkte på samme script i begge grene', async t => {
  const f = await fixture(t), script = await npmLauncher(f.bin, 'swa', 'node_modules\\swa\\index.js');
  await fs.writeFile(path.join(f.bin, 'swa.cmd'), '@IF EXIST "%~dp0\\node.exe" (\r\n "%~dp0\\node.exe" "%~dp0\\node_modules\\swa\\index.js" %*\r\n) ELSE (\r\n node "%~dp0\\node_modules\\swa\\index.js" %*\r\n)\r\n');
  assert.deepEqual((await windowsLaunch('swa', [], f.env, f.options)).args, [script]);
});

test('Native kommandostart bevarer standardinput og afviser fejl uden at vise hemmeligheder', async () => {
  const input = '{"token":"lokal-prøve","tekst":"& | %PATH%"}';
  assert.equal(await command(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input }), input);
  await assert.rejects(command(process.execPath, ['-e', 'console.error("hemmelig-prøve");process.exit(1)']), error => !error.message.includes('hemmelig-prøve') && /kunne ikke gennemføre/.test(error.message));
});
