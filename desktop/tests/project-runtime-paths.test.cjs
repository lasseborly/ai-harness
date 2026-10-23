const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { normalizeRuntimeConfig, serviceDirectory } = require('../core/project-runtime.cjs');

test('runtime kræver relative portable mapper og afviser Windows-drevstier', () => {
  const service = { id: 'web', label: 'App', command: ['node', 'server.cjs'] };
  for (const cwd of ['C:/andet', 'C:andet', 'C:', 'c:/', String.raw`C:\andet`, String.raw`\\server\share`, '//server/share', String.raw`\\?\C:\projekt`]) {
    assert.throws(() => normalizeRuntimeConfig({ services: [{ ...service, cwd }] }), /mappe.*projektet/, cwd);
  }
  assert.equal(normalizeRuntimeConfig({ services: [{ ...service, cwd: 'Apps/Prøve med mellemrum' }] }).services[0].cwd, 'Apps/Prøve med mellemrum');
});

test('en faktisk undermappe af filsystemets rod accepteres, og et link ud af projektet afvises', async t => {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-runtime-stier-')));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'Projekt Æ'), outside = path.join(temp, 'Andet');
  await fs.mkdir(project); await fs.mkdir(outside);
  const root = path.parse(project).root;
  assert.equal(await serviceDirectory(root, path.relative(root, project)), project);
  await fs.symlink(outside, path.join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(serviceDirectory(project, 'link'), /uden for projektet/);
});

test('produktionsafgrænsningen håndterer Windows-drev, UNC, case og skift til andre drev', async () => {
  const sourcePath = path.join(__dirname, '../core/project-runtime.cjs'), source = await fs.readFile(sourcePath, 'utf8');
  const nativeRequire = createRequire(sourcePath);
  const cases = [
    ['C:\\', String.raw`C:\backend`, true],
    [String.raw`\\server\share` + '\\', String.raw`\\server\share\backend`, true],
    [String.raw`C:\Projekter\App`, String.raw`c:\projekter\app\Backend`, true],
    [String.raw`\\SERVER\Fælles\App`, String.raw`\\server\fælles\app\Backend`, true],
    [String.raw`C:\Projekter\App`, String.raw`C:\Projekter\App2`, false],
    [String.raw`C:\Projekter\App`, String.raw`C:\Projekter\APP\backend`, false, true],
    [String.raw`C:\Projekter\App`, String.raw`D:\Projekter\App`, false],
    [String.raw`\\server\share\App`, String.raw`\\anden\share\App`, false],
  ];
  for (const [base, target, allowed, caseSensitive = false] of cases) {
    const module = { exports: {} }; let reads = 0;
    const files = {
      realpath: async value => {
        if (++reads === 1) return base;
        if (reads === 2) return target;
        // Samme canonical ancestor ved et almindeligt Windows-casealias;
        // case-sensitive NTFS beholder den særskilte APP-mappe.
        return !caseSensitive && value.toLowerCase() === base.toLowerCase() ? base : value;
      },
      stat: async () => ({ isDirectory: () => true }),
    };
    new Function('require', 'module', 'exports', source)(name => name === 'node:path' ? path.win32 : name === 'node:fs/promises' ? files : nativeRequire(name), module, module.exports);
    const result = module.exports.serviceDirectory(base, 'backend');
    if (allowed) assert.equal(await result, target); else await assert.rejects(result, /uden for projektet/);
  }
});
