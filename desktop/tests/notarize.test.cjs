const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { notarize } = require('../scripts/notarize.cjs');
const { generate } = require('../scripts/release-site.cjs');
const skip = process.platform === 'win32' && 'Den falske xcrun er et script med shebang';
// Downloadsiden kræver, at opdateringsmeddelelsen gælder samme version som filerne.
const { version } = require('../packaging/update-notice.json');
const name = `Aura-${version}-mac-arm64.dmg`;

// Falsk xcrun: simulerer upload, afbrydelse, netudfald, ventende og godkendt status. Intet sendes til Apple.
const fakeXcrun = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const statePath = process.env.FAKE_APPLE, state = JSON.parse(fs.readFileSync(statePath, 'utf8')), plan = state.plan;
const args = process.argv.slice(2); state.calls.push(args);
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 1));
const fail = (text, code = 1) => { save(); process.stderr.write(text + '\\n'); process.exit(code); };
const done = (text = '') => { save(); process.stdout.write(text); process.exit(0); };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const status = s => s.uploaded ? (plan.finalStatus || 'Accepted') : 'In Progress';
const [tool, command, ...rest] = args, sub = state.submissions.find(s => s.id === rest[0]);
if (tool === 'notarytool') {
 if (!args.includes('--keychain-profile')) fail('Error: No authentication provided');
 if (command === 'submit') {
  const file = rest[0], behavior = (plan.submit || []).shift() || 'ok';
  if (behavior === 'ingen-id') fail('Error: The Internet connection appears to be offline.');
  const s = { id: crypto.randomUUID(), name: path.basename(file), sha256: sha(file), path: file, uploaded: !['afbryd', 'langsom'].includes(behavior), createdDate: new Date().toISOString() };
  state.submissions.push(s);
  process.stdout.write('Conducting pre-submission checks for ' + s.name + ' and initiating connection to the Apple notary service...\\nSubmission ID received\\n  id: ' + s.id + '\\n');
  if (behavior === 'langsom') {
   // Uploaden holdes i gang, indtil prøven har set ventefilen.
   save(); const until = Date.now() + 10000;
   while (!fs.existsSync(statePath + '.fortsæt') && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
   s.uploaded = true;
  }
  if (behavior.startsWith('afbryd')) fail('Error: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost.")');
  done('Upload progress: 100.00% (1 KB of 1 KB)\\nSuccessfully uploaded file\\n  id: ' + s.id + '\\n  path: ' + file + '\\n');
 }
 if (command === 'history') done(JSON.stringify({ history: state.submissions.map(s => ({ id: s.id, name: s.name, status: status(s), createdDate: s.createdDate })), message: 'Successfully received submission history.' }));
 if (!sub) fail('Error: Submission not found', 69);
 if (command === 'wait') {
  if (plan.waitFailures > 0) { plan.waitFailures--; fail('Error: The Internet connection appears to be offline.'); }
  if (!sub.uploaded) fail('Error: Timeout reached before processing completed');
  try { state.pendingAtWait = JSON.parse(fs.readFileSync(sub.path + '.notarization-pending.json', 'utf8')); } catch { state.pendingAtWait = null; }
  done(JSON.stringify({ id: sub.id, message: 'Processing complete', status: status(sub) }));
 }
 if (command === 'info') done(JSON.stringify({ id: sub.id, name: sub.name, status: status(sub), createdDate: sub.createdDate, message: 'Successfully received submission info' }));
 if (command === 'log') {
  if (!sub.uploaded) fail('Error: Submission log is not yet available or submissionId does not exist.');
  fs.writeFileSync(rest[rest.length - 1], JSON.stringify({ logFormatVersion: 1, jobId: sub.id, status: status(sub), archiveFilename: sub.name, sha256: plan.logSha || sub.sha256, issues: null }));
  done('Successfully downloaded submission log\\n');
 }
}
if (tool === 'stapler') {
 const file = rest[0];
 if (command === 'staple') {
  if (plan.stapleFailures > 0) { plan.stapleFailures--; fail('CloudKit query for ' + path.basename(file) + ' failed due to "Network Unavailable".', 68); }
  fs.appendFileSync(file, '\\nBILLET'); done('The staple and validate action worked!\\n');
 }
 if (command === 'validate') {
  if (plan.validateFailures > 0) { plan.validateFailures--; fail('CloudKit query failed due to "Network Unavailable".', 68); }
  if (fs.statSync(file).isDirectory() || fs.readFileSync(file, 'utf8').endsWith('\\nBILLET')) done('The validate action worked!\\n');
  fail(path.basename(file) + ' does not have a ticket stapled to it.', 65);
 }
}
fail('Ukendt kald: ' + args.join(' '));
`;

async function setup(t, { plan = {}, submissions = [], file = name } = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-notarize-test-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const bin = path.join(root, 'bin'), release = path.join(root, 'release'), state = path.join(root, 'apple.json');
 await fs.mkdir(bin); await fs.mkdir(release);
 const tools = { xcrun: fakeXcrun, ditto: '#!/bin/sh\nmkdir -p "$4/Aura.app"\n', codesign: '#!/bin/sh\nexit 0\n', syspolicy_check: '#!/bin/sh\nexit 0\n' };
 for (const [tool, source] of Object.entries(tools)) await fs.writeFile(path.join(bin, tool), source, { mode: 0o755 });
 await fs.writeFile(state, JSON.stringify({ plan, submissions, calls: [] }));
 const target = path.join(release, file);
 await fs.writeFile(target, 'Syntetisk installationsfil. Ikke et program.');
 const env = { ...process.env, PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter), FAKE_APPLE: state };
 const messages = [];
 const options = { env, attempts: 3, retryDelayMs: 0, out: { write: text => messages.push(String(text)) } };
 const apple = async () => JSON.parse(await fs.readFile(state, 'utf8'));
 const calls = async command => (await apple()).calls.filter(args => args.slice(0, 2).join(' ') === command);
 const read = async suffix => JSON.parse(await fs.readFile(target + suffix, 'utf8'));
 const exists = suffix => fs.access(target + suffix).then(() => true, () => false);
 return { root, release, target, env, options, messages, apple, calls, read, exists, sha: async () => createHash('sha256').update(await fs.readFile(target)).digest('hex') };
}

test('godkendt DMG får billet og en kvittering i det kendte format, som downloadsiden accepterer', { skip }, async t => {
 const f = await setup(t), before = await f.sha();
 const result = await notarize(f.target, 'ai-harness-notary', f.options);
 const receipt = await f.read('.notarized.json');
 assert.deepEqual(Object.keys(receipt), ['file', 'sha256', 'status', 'id', 'checkedAt']);
 assert.deepEqual(receipt, result);
 assert.equal(receipt.file, name); assert.equal(receipt.status, 'Accepted');
 assert.equal(receipt.sha256, await f.sha(), 'Kvitteringen gælder filen med billet');
 assert.notEqual(receipt.sha256, before);
 const apple = await f.apple();
 assert.deepEqual(apple.pendingAtWait && { file: apple.pendingAtWait.file, sha256: apple.pendingAtWait.sha256, id: apple.pendingAtWait.id }, { file: name, sha256: before, id: receipt.id }, 'Id og SHA-256 er gemt, før der ventes');
 assert.equal((await f.calls('notarytool submit')).length, 1);
 assert.ok(!(await f.calls('notarytool submit'))[0].includes('--wait'));
 assert.equal(await f.exists('.notarization-pending.json'), false);
 const [listed] = await generate(f.release);
 assert.equal(listed.notarized, true); assert.deepEqual(listed.notarization, { id: receipt.id, checkedAt: receipt.checkedAt });
 await notarize(f.target, 'ai-harness-notary', f.options);
 assert.equal((await f.apple()).calls.length, apple.calls.length, 'En gyldig kvittering kalder ikke Apple igen');
});

test('netudfald under ventetiden genoptages fra det gemte id uden ny indsendelse', { skip }, async t => {
 const f = await setup(t, { plan: { waitFailures: 5 } }), sent = await f.sha();
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), /Ventetiden på Apple mislykkedes: Error: The Internet connection appears to be offline\. Indsendelse [0-9a-f-]{36} er gemt .*filen sendes ikke igen/);
 const pending = await f.read('.notarization-pending.json');
 assert.equal(pending.file, name); assert.equal(pending.sha256, sent); assert.equal(pending.upload, 'fuldført');
 assert.equal(await f.exists('.notarized.json'), false);
 assert.equal((await f.calls('notarytool wait')).length, 3, 'Ventetiden prøves igen automatisk');
 const receipt = await notarize(f.target, 'ai-harness-notary', f.options);
 assert.equal(receipt.id, pending.id);
 assert.equal((await f.calls('notarytool submit')).length, 1, 'Filen sendes ikke igen');
 assert.ok(f.messages.some(text => text.includes(`Genoptager indsendelse ${pending.id}`)));
});

test('afbrudt upload sendes kun igen med --send-igen', { skip }, async t => {
 const f = await setup(t, { plan: { submit: ['afbryd', 'ok'] } });
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), /Uploaden af indsendelse [0-9a-f-]{36} blev afbrudt: .*--send-igen/);
 const first = await f.read('.notarization-pending.json');
 assert.equal(first.upload, 'afbrudt'); assert.match(first.id, /^[0-9a-f-]{36}$/);
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), /stadig In Progress.*--send-igen/);
 assert.equal((await f.calls('notarytool submit')).length, 1);
 assert.equal((await f.calls('notarytool info')).length, 1, 'Uden --send-igen kontrolleres kun status');
 const receipt = await notarize(f.target, 'ai-harness-notary', { ...f.options, sendAgain: true });
 assert.equal((await f.calls('notarytool submit')).length, 2);
 assert.notEqual(receipt.id, first.id);
 assert.equal(await f.exists('.notarization-pending.json'), false);
});

test('afbrudt upload, som Apple alligevel modtog, bruges uden at sende igen', { skip }, async t => {
 const f = await setup(t, { plan: { submit: ['afbryd-men-modtaget'] } });
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), /blev afbrudt/);
 const { id } = await f.read('.notarization-pending.json');
 assert.equal((await notarize(f.target, 'ai-harness-notary', f.options)).id, id);
 assert.equal((await f.calls('notarytool submit')).length, 1);
});

test('id gemmes, mens uploaden stadig kører', { skip }, async t => {
 const f = await setup(t, { plan: { submit: ['langsom'] } });
 const running = notarize(f.target, 'ai-harness-notary', f.options);
 let pending = null;
 for (let i = 0; i < 200 && !pending?.id; i++) { await new Promise(resolve => setTimeout(resolve, 25)); pending = await f.read('.notarization-pending.json').catch(() => null); }
 assert.equal(pending?.upload, 'i gang', 'Ventefilen findes, før uploaden er færdig');
 assert.match(pending.id, /^[0-9a-f-]{36}$/);
 await fs.writeFile(f.env.FAKE_APPLE + '.fortsæt', '');
 assert.equal((await running).id, pending.id);
});

test('ventefil fra et script, der stoppede under uploaden, kontrolleres uden ny indsendelse', { skip }, async t => {
 const f = await setup(t), sha = await f.sha();
 const hanging = { id: '55555555-5555-4555-8555-555555555555', name, sha256: sha, uploaded: false, createdDate: new Date().toISOString() };
 await fs.writeFile(f.env.FAKE_APPLE, JSON.stringify({ plan: {}, submissions: [hanging], calls: [] }));
 await fs.writeFile(f.target + '.notarization-pending.json', JSON.stringify({ file: name, sha256: sha, upload: 'i gang', startedAt: new Date().toISOString(), id: hanging.id }));
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), new RegExp(`indsendelse ${hanging.id} blev ikke fuldført.*--send-igen`));
 assert.equal((await f.calls('notarytool info')).length, 1);
 assert.equal((await f.calls('notarytool wait')).length, 0, 'En hængende indsendelse ventes der ikke på');
 assert.equal((await f.calls('notarytool submit')).length, 0);
});

test('fejl før Apple giver et id efterlader ingen ventefil', { skip }, async t => {
 const f = await setup(t, { plan: { submit: ['ingen-id', 'ok'] } });
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), /kom ikke i gang: Error: The Internet connection appears to be offline\. Apple har ikke givet et indsendelses-id/);
 assert.equal(await f.exists('.notarization-pending.json'), false);
 const receipt = await notarize(f.target, 'ai-harness-notary', f.options);
 assert.equal(receipt.status, 'Accepted');
 assert.equal((await f.calls('notarytool submit')).length, 2);
});

test('uden ventefil genbruges Apples godkendelse med samme SHA-256', { skip }, async t => {
 const f = await setup(t), sha = await f.sha(), created = new Date().toISOString();
 const earlier = { id: '11111111-1111-4111-8111-111111111111', name, sha256: 'a'.repeat(64), uploaded: true, createdDate: created };
 const match = { id: '22222222-2222-4222-8222-222222222222', name, sha256: sha, uploaded: true, createdDate: created };
 const other = { id: '33333333-3333-4333-8333-333333333333', name: `Aura-${version}-mac-x64.dmg`, sha256: sha, uploaded: true, createdDate: created };
 await fs.writeFile(f.env.FAKE_APPLE, JSON.stringify({ plan: {}, submissions: [earlier, other, match], calls: [] }));
 const receipt = await notarize(f.target, 'ai-harness-notary', f.options);
 assert.equal(receipt.id, match.id);
 assert.equal((await f.calls('notarytool submit')).length, 0);
 assert.ok(f.messages.some(text => text.includes(`allerede godkendt ${name} i indsendelse ${match.id}`)));
});

test('en uafsluttet indsendelse af samme fil hos Apple stopper en ny indsendelse', { skip }, async t => {
 const f = await setup(t);
 const hanging = { id: '44444444-4444-4444-8444-444444444444', name, sha256: await f.sha(), uploaded: false, createdDate: new Date().toISOString() };
 await fs.writeFile(f.env.FAKE_APPLE, JSON.stringify({ plan: {}, submissions: [hanging], calls: [] }));
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), new RegExp(`ikke er færdig: ${hanging.id}.*--send-igen`));
 assert.equal((await f.calls('notarytool submit')).length, 0);
 assert.equal(await f.exists('.notarization-pending.json'), false);
 const receipt = await notarize(f.target, 'ai-harness-notary', { ...f.options, sendAgain: true });
 assert.notEqual(receipt.id, hanging.id);
 assert.equal((await f.calls('notarytool submit')).length, 1);
});

test('forkert SHA-256 i Apples log stopper før billetten hæftes på', { skip }, async t => {
 const f = await setup(t, { plan: { logSha: '0'.repeat(64) } }), before = await f.sha();
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), /angiver SHA-256 0{64}, men den sendte fil har [0-9a-f]{64}\. Billetten hæftes ikke på/);
 assert.equal(await f.sha(), before);
 assert.equal((await f.calls('stapler staple')).length, 0);
 assert.equal(await f.exists('.notarized.json'), false);
});

test('afvist indsendelse giver id og sendes ikke igen uden --send-igen', { skip }, async t => {
 const f = await setup(t, { plan: { finalStatus: 'Invalid' } });
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), /Status: Invalid; indsendelse: [0-9a-f-]{36}/);
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), /Status: Invalid/);
 assert.equal((await f.calls('notarytool submit')).length, 1);
 assert.equal(await f.exists('.notarized.json'), false);
});

test('netudfald efter vedhæftning af billetten fortsætter uden ny billet eller indsendelse', { skip }, async t => {
 const f = await setup(t, { plan: { stapleFailures: 1, validateFailures: 4 } });
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), /Kontrollen af billetten mislykkedes/);
 const pending = await f.read('.notarization-pending.json');
 assert.equal(pending.stapledSha256, await f.sha());
 assert.notEqual(pending.sha256, pending.stapledSha256);
 const receipt = await notarize(f.target, 'ai-harness-notary', f.options);
 assert.equal(receipt.sha256, pending.stapledSha256);
 assert.equal((await fs.readFile(f.target, 'utf8')).split('BILLET').length - 1, 1, 'Billetten hæftes kun på én gang');
 assert.equal((await f.calls('stapler staple')).length, 2, 'Én mislykket og én vellykket vedhæftning');
 assert.equal((await f.calls('notarytool submit')).length, 1);
});

test('ændret fil efter en afbrudt upload behandles som en ny fil', { skip }, async t => {
 const f = await setup(t, { plan: { submit: ['afbryd', 'ok'] } });
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), /blev afbrudt/);
 const { id } = await f.read('.notarization-pending.json');
 await fs.writeFile(f.target, 'En ny bygning af den syntetiske fil.');
 // Apples hængende indsendelse har samme filnavn, men kan ikke sammenlignes; den kræver et udtrykkeligt valg.
 await assert.rejects(notarize(f.target, 'ai-harness-notary', f.options), new RegExp(`ikke er færdig: ${id}.*--send-igen`));
 assert.ok(f.messages.some(text => text.includes(`Den gemte indsendelse ${id} gjaldt en anden udgave`)));
 const receipt = await notarize(f.target, 'ai-harness-notary', { ...f.options, sendAgain: true });
 assert.equal(receipt.sha256, await f.sha());
 assert.notEqual(receipt.id, id);
 assert.equal((await f.calls('notarytool submit')).length, 2);
});

test('ZIP kontrolleres uden stapling, og kvitteringen gælder den uændrede fil', { skip }, async t => {
 const f = await setup(t, { file: `Aura-${version}-mac-arm64.zip` }), before = await f.sha();
 const receipt = await notarize(f.target, 'ai-harness-notary', f.options);
 assert.equal(receipt.sha256, before);
 assert.equal((await f.calls('stapler staple')).length, 0);
 assert.equal((await f.calls('stapler validate')).length, 1);
});

test('kommandolinjen bruger den falske xcrun og afviser ukendte valg', { skip: process.platform !== 'darwin' && 'Scriptet kører kun på macOS' }, async t => {
 const f = await setup(t), script = path.join(__dirname, '../scripts/notarize.cjs'), node = promisify(execFile);
 await assert.rejects(node(process.execPath, [script, f.target, 'ai-harness-notary', '--wait'], { env: f.env }), e => /Brug:/.test(e.stderr));
 assert.equal((await f.apple()).calls.length, 0);
 const { stdout } = await node(process.execPath, [script, f.target, 'ai-harness-notary'], { env: f.env });
 assert.match(stdout, /Apple har godkendt filen/);
 assert.equal((await f.read('.notarized.json')).sha256, await f.sha());
});
