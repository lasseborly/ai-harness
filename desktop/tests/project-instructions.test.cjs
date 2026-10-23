const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { projectInstructions, instructionText, MAX_BYTES } = require('../core/project-instructions.cjs');
const { appRules, guidanceFor } = require('../core/project-guidance.cjs');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');
async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-regler-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }

test('projektregler læses fuldt med kilde og hash; manglende fil er tilladt, links og afkortning afvises', async t => {
  const root = await temp(t), file = path.join(root, 'AGENTS.md');
  assert.equal(await projectInstructions(root), null);
  await fs.writeFile(file, '# Regler\r\nAfklar konflikten før ændring.\r\n');
  const first = await projectInstructions(root);
  assert.equal(first.content, await fs.readFile(file, 'utf8'));
  assert.match(instructionText(first), /Kilde: AGENTS.md/);
  assert.match(instructionText(first), /Ved modstrid/);
  await fs.writeFile(file, 'Nye regler'); assert.notEqual((await projectInstructions(root)).hash, first.hash);
  await fs.writeFile(file, 'æ'.repeat(MAX_BYTES)); await assert.rejects(projectInstructions(root), /32 KiB/);
  await fs.writeFile(file, Buffer.from([255])); await assert.rejects(projectInstructions(root), /UTF-8/);
  await fs.rm(file); await fs.symlink(path.join(root, 'andet.md'), file);
  await assert.rejects(projectInstructions(root), /almindelig fil/);
});

test('desktop og CLI får kun henvisninger til deres egne forbindelser, versioner og deling', () => {
  const features = { versioner: true, deling: true };
  const desktop = appRules(features) + guidanceFor();
  const cli = appRules(features, { surface: 'cli' }) + guidanceFor('cli');
  assert.match(desktop, /Udgiv-knap/); assert.match(desktop, /forbindelsesindstillinger/);
  for (const command of ['/save', '/versions', '/deploy', '/preview', '/server', 'aura login']) assert.ok(cli.includes(command), command);
  assert.doesNotMatch(cli, /appens Udgiv-knap|Auras knap Udgiv|Start forhåndsvisning|appens forbindelses/);
  assert.match(appRules({ versioner: false, deling: false }, { surface: 'cli' }), /Udgivelse er slået fra/);
});

test('ændrede projektregler stopper afsendelse før motorstart, også når filen oprettes efter gennemgangen', async t => {
  const root = await temp(t); let starts = 0;
  const bench = new Workbench({ directory: await temp(t), profiles, emit: () => {}, safeStorage: {}, engineFactory: () => { starts++; throw Error('Må ikke starte'); } });
  await bench.activate({ root, name: 'Prøve' });
  const context = { rules: '', skills: [], titles: [], features: {}, projectInstructions: null };
  bench.chat.prepared = { root, context, connection: { kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' }, disclosure: { fingerprint: 'prøve' } };
  await fs.writeFile(path.join(root, 'AGENTS.md'), 'Ny regel');
  await assert.rejects(bench.send({ text: 'Byg', fingerprint: 'prøve' }), /har ændret sig/);
  assert.equal(starts, 0); assert.equal(bench.running, false);
  await bench.close();
});

test('tilpassede skills kontrollerer referencer og andre skills før lagring og før indlæsning', async t => {
  const { Skills } = require('../core/skills.cjs'), { Store } = require('../core/store.cjs');
  const store = new Store(await temp(t), {}), name = 'harness-proeve';
  const original = '---\nname: harness-proeve\ndescription: Brug den ved prøven.\n---\nLæs references/detaljer.md.\n';
  const library = async () => ({ rules: 'Regler', features: [{ id: 'proeve', skills: [name] }], skills: [{ name, title: 'Prøve', summary: 'Prøve', files: [{ path: 'SKILL.md', content: original }, { path: 'references/detaljer.md', content: 'Detaljer' }] }] });
  const skills = new Skills(library, store, { get: async () => ({ effective: { proeve: true } }) });
  const save = content => skills.save('/projekt', { id: name, content });
  await save(original + 'En gyldig tilpasning.');
  await assert.rejects(save(original + 'Læs references/findes-ikke.md.'), /findes ikke/);
  await assert.rejects(save(original + 'Læs references/UNDERMAPPE/andet.md.'), /findes ikke/);
  await assert.rejects(save(original.replace('references/detaljer.md', 'en anden fil')), /Bevar henvisningen/);
  await assert.rejects(save(original + '`harness-ukendt`, hvis den er installeret.'), /ukendt skill/);
  assert.match((await skills.context('/projekt')).skills[0].files[0].content, /gyldig tilpasning/);
  await store.saveProject('/projekt', { skills: { [name]: { content: original + 'Læs references/gammel-fejl.md.' } } });
  await assert.rejects(skills.context('/projekt'), /findes ikke/);
  await skills.save('/projekt', { id: name, reset: true, content: original });
  assert.equal((await skills.context('/projekt')).skills[0].files[0].content, original);
});

test('projektregler kontrolleres igen efter motoropstart, før modellen modtager en opgave', async t => {
  const root = await temp(t); let sends = 0;
  const bench = new Workbench({ directory: await temp(t), profiles, emit: () => {}, safeStorage: {}, engineFactory: () => ({ active: false, start: async () => fs.writeFile(path.join(root, 'AGENTS.md'), 'Ændret under opstart'), send: async () => sends++, abort: async () => {}, close: async () => {} }) });
  await bench.activate({ root, name: 'Prøve' });
  bench.chat.prepared = { mode: 'free', root, disclosure: { fingerprint: 'prøve' }, connection: { kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' }, model: { id: 'model' }, references: [], context: { rules: '', skills: [], titles: [], features: {}, projectInstructions: null } };
  await assert.rejects(bench.send({ text: 'Undersøg projektet', fingerprint: 'prøve' }), /ændret sig under opstart/);
  assert.equal(sends, 0); await bench.close();
});
