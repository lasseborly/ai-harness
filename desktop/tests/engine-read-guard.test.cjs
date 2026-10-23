const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createReadGuard, writeReadGuard, writeSkills } = require('../core/engine.cjs');

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-read-guard-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'), directory = path.join(base, 'motor');
  await fs.mkdir(root); await fs.mkdir(directory);
  await fs.writeFile(path.join(root, 'normal.txt'), 'Offentlig');
  await fs.writeFile(path.join(root, '.env'), 'Syntetisk privat');
  await fs.mkdir(path.join(root, 'references'));
  await fs.writeFile(path.join(root, 'references', 'valgt.txt'), 'Valgt materiale');
  await fs.writeFile(path.join(root, 'references', 'privat.txt'), 'Ikke valgt');
  const guard = createReadGuard({ fs, path, root, references: ['references/valgt.txt'] });
  const read = async file => { const output = { args: { filePath: file } }; await guard({ tool: 'read' }, output); return output.args.filePath; };
  return { base, root, directory, guard, read };
}

test('læsebeskyttelsen afviser beskyttede navne, casevarianter, streams og navnealiaser før læsning', async t => {
  const { root, read } = await fixture(t);
  for (const name of ['.env', '.ENV', '.env.local', 'api.KEY::$DATA', 'api.pem:stream', 'api.key.', 'api.key ', 'Secrets/value.txt', '.GIT/config', 'REFERENCES/privat.txt']) {
    await assert.rejects(read(path.join(root, name)), /Aura beskytter denne fil/, name);
  }
  assert.equal(await read('normal.txt'), path.join(root, 'normal.txt'));
  assert.equal(await read('references/valgt.txt'), path.join(root, 'references', 'valgt.txt'));
});

test('en neutral symlink til en beskyttet fil afvises; et almindeligt link bliver kanoniseret', { skip: process.platform === 'win32' }, async t => {
  const { root, read } = await fixture(t);
  await fs.symlink(path.join(root, '.env'), path.join(root, 'offentligt-navn.txt'));
  await fs.symlink(path.join(root, 'normal.txt'), path.join(root, 'normalt-link.txt'));
  await assert.rejects(read('offentligt-navn.txt'), /Aura beskytter denne fil/);
  assert.equal(await read('normalt-link.txt'), path.join(root, 'normal.txt'));
  await fs.rm(path.join(root, 'references', 'valgt.txt'));
  await fs.symlink(path.join(root, 'normal.txt'), path.join(root, 'references', 'valgt.txt'));
  await assert.rejects(read('references/valgt.txt'), /Aura beskytter denne fil/, 'En reference må ikke skifte til et andet mål');
});

test('den genererede plugin kvitterer for indlæsning og bevarer aktive skills referencefiler', async t => {
  const { root, directory } = await fixture(t);
  const skills = [{ name: 'harness-test', files: [{ path: 'SKILL.md', content: '# Prøve' }, { path: 'references/proeve.md', content: 'Offentlig skillreference' }] }];
  await writeSkills(directory, skills);
  const configured = await writeReadGuard(directory, root, ['references/valgt.txt'], skills);
  const plugin = await import(configured.pluginURL), hooks = await plugin.AuraReadProtection();
  assert.equal(JSON.parse(await fs.readFile(configured.readyPath, 'utf8')).token, configured.token);
  const skill = path.join(directory, 'config', 'skills', 'harness-test', 'references', 'proeve.md');
  const output = { args: { filePath: skill } };
  await hooks['tool.execute.before']({ tool: 'read' }, output); assert.equal(output.args.filePath, skill);
  await assert.rejects(hooks['tool.execute.before']({ tool: 'read' }, { args: { filePath: path.join(root, '.env') } }), /Aura beskytter/);
  const otherTool = { args: { filePath: path.join(root, '.env') } };
  await hooks['tool.execute.before']({ tool: 'write' }, otherTool);
  assert.equal(otherTool.args.filePath, path.join(root, '.env'), 'Andre værktøjer beholder deres eksisterende tilladelsesvej');
});
