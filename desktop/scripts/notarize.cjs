// Kør kun efter udtrykkeligt tilvalg med en lokal notarytool-profil.
// Indsendelsens id gemmes i FIL.notarization-pending.json, før der ventes. Falder forbindelsen ud, genoptager
// samme kommando fra det gemte id. Filen sendes aldrig igen, mens Apple har en ventende eller godkendt
// indsendelse af den; kun --send-igen sender på ny efter en afbrudt upload eller en afvisning.
const fs = require('node:fs/promises');
const { createReadStream, writeFileSync, renameSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { submissionIdPattern } = require('../../scripts/release-contract.cjs');
const run = promisify(execFile);
const usage = 'Brug: node scripts/notarize.cjs sti/til/pakke.dmg-eller-zip profilnavn [--send-igen]';
const idInOutput = /\bid:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = text => { try { return JSON.parse(text); } catch { return null; } };
const reasonOf = e => (String(e?.stderr || e?.stdout || e?.message || e).trim().split('\n').filter(Boolean).pop() || 'ukendt fejl').replace(/[.\s]+$/, '');
async function sha256(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
// Ventefilen skrives helt eller slet ikke, så et afbrudt script aldrig efterlader en halv fil.
function save(file, value) { writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); renameSync(file + '.tmp', file); }

async function notarize(target, profile, { sendAgain = false, env = process.env, attempts = 4, retryDelayMs = 30000, out = process.stdout } = {}) {
 const file = path.resolve(target || ''), zip = file.endsWith('.zip'), name = path.basename(file);
 if ((!file.endsWith('.dmg') && !zip) || !profile) throw new Error(usage);
 await fs.access(file);
 const log = text => out.write(text + '\n');
 const pendingFile = file + '.notarization-pending.json', receiptFile = file + '.notarized.json', auth = ['--keychain-profile', profile];
 const local = (command, args) => run(command, args, { timeout: 180000, env });
 // Kun opslag og kontroller gentages automatisk. En ny indsendelse kræver altid en ny kørsel.
 async function ask(what, args, timeout = 600000) {
  for (let attempt = 1; ; attempt++) {
   try { return (await run('xcrun', args, { timeout, maxBuffer: 16 * 1024 * 1024, env })).stdout; }
   catch (e) {
    if (json(e.stdout)?.status) return e.stdout;
    const reason = e.killed ? 'tidsgrænsen blev nået' : reasonOf(e);
    if (e.killed || attempt >= attempts || /\b40[13]\b|password item/i.test(reason)) throw new Error(`${what} mislykkedes: ${reason}`);
    log(`${what} mislykkedes: ${reason}. Prøver igen (${attempt}/${attempts - 1}).`);
    await sleep(retryDelayMs * attempt);
   }
  }
 }
 const keep = (id, promise) => promise.catch(e => { throw new Error(`${e.message}. Indsendelse ${id} er gemt i ${path.basename(pendingFile)}. Kør samme kommando igen, når forbindelsen er stabil; filen sendes ikke igen.`); });
 const rejected = (id, state) => new Error(`Apple godkendte ikke pakken. Status: ${state || 'ukendt'}; indsendelse: ${id}. Hent Apples log til fejlsøgning med xcrun notarytool log ${id} --keychain-profile ${profile}. Ret fejlen og byg en ny fil; --send-igen sender den samme fil igen.`);
 const info = async id => json(await ask('Statusopslaget hos Apple', ['notarytool', 'info', id, ...auth, '--output-format', 'json']))?.status;
 async function waitFor(id) {
  log(`Venter på Apples svar på indsendelse ${id}. Afbrydes ventetiden, genoptager samme kommando fra det gemte id.`);
  return json(await ask('Ventetiden på Apple', ['notarytool', 'wait', id, ...auth, '--output-format', 'json'], 4 * 3600000))?.status || info(id);
 }
 async function appleLog(id) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-notary-log-'));
  try { await ask('Hentningen af Apples log', ['notarytool', 'log', id, ...auth, path.join(folder, 'log.json')]); return json(await fs.readFile(path.join(folder, 'log.json'), 'utf8')) || {}; }
  finally { await fs.rm(folder, { recursive: true, force: true }); }
 }
 // Uden gemt id: genbrug en godkendt indsendelse af samme fil, og send ikke, mens Apple har en uafsluttet af samme navn.
 async function findAtApple(sha) {
  const listing = await ask('Opslaget i Apples indsendelser', ['notarytool', 'history', ...auth, '--output-format', 'json']).catch(e => { throw new Error(`${e.message}. Intet er sendt til Apple. Kør samme kommando igen, når forbindelsen er stabil.`); });
  const history = json(listing)?.history || [];
  const same = history.filter(entry => entry.name === name && submissionIdPattern.test(entry.id || ''));
  for (const entry of same.filter(entry => entry.status === 'Accepted')) if ((await appleLog(entry.id)).sha256 === sha) return entry.id;
  const open = same.filter(entry => entry.status === 'In Progress').map(entry => entry.id);
  if (open.length && !sendAgain) throw new Error(`Apple har allerede ${open.length === 1 ? 'en indsendelse' : open.length + ' indsendelser'} af ${name}, som ikke er færdig: ${open.join(', ')}. Den er ikke gemt her og kan først sammenlignes med filen, når Apple er færdig. Vent, og kør samme kommando igen. Hænger den efter en afbrudt upload, så kør med --send-igen på en fast forbindelse for at sende filen på ny.`);
  return null;
 }
 async function submit(sha) {
  const record = { file: name, sha256: sha, upload: 'i gang', startedAt: new Date().toISOString() };
  save(pendingFile, record);
  log(`Sender ${name} til Apple. Send én fil ad gangen på en fast forbindelse.`);
  const child = spawn('xcrun', ['notarytool', 'submit', file, ...auth], { env });
  let output = '';
  const read = chunk => {
   out.write(chunk); output += chunk;
   const id = !record.id && output.match(idInOutput)?.[1];
   if (id) { record.id = id; save(pendingFile, record); }
  };
  child.stdout.setEncoding('utf8').on('data', read); child.stderr.setEncoding('utf8').on('data', read);
  const timer = setTimeout(() => child.kill(), 2 * 3600000);
  const code = await new Promise(resolve => { child.on('error', e => { output += e.message; resolve(-1); }); child.on('close', resolve); });
  clearTimeout(timer);
  if (code === 0 && record.id) { record.upload = 'fuldført'; record.uploadedAt = new Date().toISOString(); save(pendingFile, record); return record; }
  const reason = reasonOf(output);
  if (!record.id) { await fs.rm(pendingFile, { force: true }); throw new Error(`Indsendelsen kom ikke i gang: ${reason}. Apple har ikke givet et indsendelses-id. Kør samme kommando igen, når forbindelsen er stabil.`); }
  record.upload = 'afbrudt'; save(pendingFile, record);
  throw new Error(`Uploaden af indsendelse ${record.id} blev afbrudt: ${reason}. Apple har sandsynligvis ikke fået hele filen, og indsendelsen bliver stående som In Progress. Kør samme kommando med --send-igen på en fast forbindelse for at sende filen på ny. Uden --send-igen kontrollerer scriptet kun, om Apple alligevel har godkendt den.`);
 }

 let sha = await sha256(file);
 const receipt = json(await fs.readFile(receiptFile, 'utf8').catch(() => ''));
 let pending = json(await fs.readFile(pendingFile, 'utf8').catch(() => ''));
 if (receipt?.status === 'Accepted' && receipt.sha256 === sha && submissionIdPattern.test(receipt.id || '') && Number.isFinite(Date.parse(receipt.checkedAt))) {
  if (pending?.id === receipt.id) await fs.rm(pendingFile, { force: true });
  log(`${name} har allerede en kvittering fra indsendelse ${receipt.id}. Intet er sendt til Apple.`);
  return receipt;
 }
 // Efter vedhæftningen af billetten har en DMG en ny SHA-256; den gemmes som stapledSha256.
 if (pending && pending.sha256 !== sha && pending.stapledSha256 !== sha) {
  if (pending.id) log(`Den gemte indsendelse ${pending.id} gjaldt en anden udgave af ${name}. Filen er ændret siden og behandles som en ny fil.`);
  pending = null;
 }
 if (pending && !submissionIdPattern.test(pending.id || '')) pending = null;
 if (pending) {
  log(`Genoptager indsendelse ${pending.id} fra ${path.basename(pendingFile)}.`);
  const state = await keep(pending.id, pending.upload === 'fuldført' && !sendAgain ? waitFor(pending.id) : info(pending.id));
  if (state !== 'Accepted') {
   if (sendAgain) { log(`Indsendelse ${pending.id} har status ${state || 'ukendt'}. Filen sendes igen, fordi --send-igen er angivet.`); pending = null; }
   else if (state === 'In Progress' && pending.upload !== 'fuldført') throw new Error(`Uploaden af indsendelse ${pending.id} blev ikke fuldført, og Apple viser stadig In Progress. Apple har sandsynligvis aldrig fået hele filen. Kør samme kommando med --send-igen på en fast forbindelse for at sende filen på ny.`);
   else if (state === 'In Progress') throw new Error(`Apple behandler stadig indsendelse ${pending.id}. Kør samme kommando igen senere; filen sendes ikke igen.`);
   else throw rejected(pending.id, state);
  }
 }
 if (!pending) {
  const known = await findAtApple(sha);
  if (known) {
   log(`Apple har allerede godkendt ${name} i indsendelse ${known}. Filen sendes ikke igen.`);
   pending = { file: name, sha256: sha, id: known, upload: 'fuldført' };
   save(pendingFile, pending);
  } else {
   pending = await submit(sha);
   const state = await keep(pending.id, waitFor(pending.id));
   if (state !== 'Accepted') throw rejected(pending.id, state);
  }
 }
 const report = await keep(pending.id, appleLog(pending.id));
 if (report.status !== 'Accepted' || (report.jobId && report.jobId !== pending.id)) throw new Error(`Apples log for indsendelse ${pending.id} bekræfter ikke godkendelsen (status ${report.status || 'mangler'}). Billetten hæftes ikke på, og der skrives ingen kvittering.`);
 if (report.sha256 !== pending.sha256) throw new Error(`Apples log for indsendelse ${pending.id} angiver SHA-256 ${report.sha256 || '(mangler)'}, men den sendte fil har ${pending.sha256}. Billetten hæftes ikke på, og der skrives ingen kvittering. Kontrollér, at det er den rigtige fil.`);
 if (!zip) {
  if (sha === pending.sha256) {
   await keep(pending.id, ask('Vedhæftningen af billetten', ['stapler', 'staple', file], 180000));
   sha = await sha256(file); pending.stapledSha256 = sha; save(pendingFile, pending);
  }
  await keep(pending.id, ask('Kontrollen af billetten', ['stapler', 'validate', file], 180000));
 } else {
  // ZIP kan ikke staples. Appen skal have sin billet, inden det endelige arkiv oprettes.
  const unpack = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-notary-zip-'));
  try {
   await local('ditto', ['-x', '-k', file, unpack]);
   const bundle = path.join(unpack, 'Aura.app');
   await local('codesign', ['--verify', '--deep', '--strict', bundle]);
   await local('xcrun', ['stapler', 'validate', bundle]);
   await local('syspolicy_check', ['distribution', bundle]);
  } finally { await fs.rm(unpack, { recursive: true, force: true }); }
 }
 const result = { file: name, sha256: await sha256(file), status: 'Accepted', id: pending.id, checkedAt: new Date().toISOString() };
 await fs.writeFile(receiptFile, JSON.stringify(result, null, 2));
 await fs.rm(pendingFile, { force: true });
 log('Apple har godkendt filen; billet og indhold er kontrolleret. Genbyg downloadoversigten med npm run release:site.');
 return result;
}

if (require.main === module) {
 const args = process.argv.slice(2), sendAgain = args.includes('--send-igen'), positional = args.filter(arg => arg !== '--send-igen');
 (async () => {
  if (process.platform !== 'darwin' || positional.length !== 2 || positional.some(arg => arg.startsWith('-'))) throw new Error(usage);
  await notarize(positional[0], positional[1], { sendAgain });
 })().catch(e => { console.error(e.message); process.exitCode = 1; });
}

module.exports = { notarize };
