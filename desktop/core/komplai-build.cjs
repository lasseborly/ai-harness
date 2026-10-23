const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { run, secretContent } = require('./git.cjs');
const { environment, nodeRuntime, cleanOutput, terminate } = require('./dev-server.cjs');
const { npmInstallPolicy, npmFailure, npmFailureCode } = require('./npm-policy.cjs');

// komplai Run modtager kun færdige filer og bygger intet. En gemt byggemappe med index.html bruges direkte. Ellers kan
// Aura bygge appen på brugerens egen computer, efter brugerens ja, i en midlertidig kopi af den gemte version og med den
// Node og npm, der følger med Aura. Intet installeres globalt, projektmappen røres ikke, og der kræves ingen
// administratorrettigheder. Pakkernes installationsscripts køres ikke, ligesom ved forhåndsvisningens installation.
const OUTPUTS = ['dist', 'build', 'out'];
const LIMITS = { files: 2000, file: 2 * 1024 * 1024, total: 20 * 1024 * 1024 };
const STEP_TIMEOUT = 10 * 60 * 1000;
const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Hvad en ny komplai-udgivelse bruger fra den gemte version: en gemt byggemappe, en lokal bygning eller public. */
async function komplaiSource(root, { read = run } = {}) {
  const listing = await read(root, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']).catch(() => Buffer.alloc(0));
  const names = new Set(listing.toString('utf8').split('\0').filter(Boolean));
  const saved = OUTPUTS.find(directory => names.has(directory + '/index.html'));
  if (saved) return { directory: saved, build: false };
  if (names.has('package.json')) {
    try {
      const script = JSON.parse((await read(root, ['show', 'HEAD:package.json'])).toString('utf8')).scripts?.build;
      if (typeof script === 'string' && script.trim()) return { directory: 'dist', build: true, script: script.trim().slice(0, 200) };
    } catch { /* Uden et læsbart byggescript bruges public som hidtil. */ }
  }
  return { directory: 'public', build: false };
}

async function collect(base) {
  const files = [], excluded = []; let bytes = 0;
  async function walk(relative) {
    const entries = await fs.readdir(path.join(base, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw Error(`Den byggede app indeholder et link: ${file}. Byg appen uden links.`);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile()) continue;
      // Kildekort viser projektets kildekode og hører ikke til i en udgivelse.
      if (/\.map$/i.test(file)) { excluded.push(file); continue; }
      const data = await fs.readFile(path.join(base, file));
      bytes += data.length;
      if (files.length >= LIMITS.files || data.length > LIMITS.file || bytes > LIMITS.total) throw Error('Den byggede app overstiger 2.000 filer, 2 MB pr. fil eller 20 MB samlet.');
      if (secretContent(data.toString())) throw Error(`Mulig hemmelighed i den byggede fil ${file}. Gennemgå projektet før udgivelse.`);
      files.push({ file, data, sha256: sha256(data) });
    }
  }
  await walk('');
  return { files, bytes, excluded };
}

/** Bygger den gemte version i en midlertidig mappe og giver de byggede filer som en udgivelse. */
async function buildSaved(source, { runtime = nodeRuntime, timeout = STEP_TIMEOUT } = {}) {
  const pkgFile = source.files.find(f => f.file === 'package.json');
  let pkg = null;
  try { pkg = pkgFile && JSON.parse(pkgFile.data.toString('utf8')); } catch { throw Error('package.json i den gemte version kan ikke læses.'); }
  const script = typeof pkg?.scripts?.build === 'string' ? pkg.scripts.build.trim() : '';
  if (!script) throw Error('Projektet har intet byggescript i package.json. Gem den færdige app i en mappe med index.html.');
  const names = new Set(source.files.map(f => f.file));
  if ((pkg.packageManager && !/^npm@/.test(pkg.packageManager)) || ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].some(name => names.has(name))) throw Error('Aura bygger kun projekter, der bruger npm. Byg appen selv, og gem byggemappen med index.html.');
  if (pkg.workspaces) throw Error('Projektet har flere arbejdsområder. Byg appen selv, og gem byggemappen med index.html.');
  const executables = await runtime();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-byg-'));
  const policy = npmInstallPolicy(pkg, Object.fromEntries(source.files.filter(file => ['package-lock.json', 'npm-shrinkwrap.json', '.npmrc'].includes(file.file)).map(file => [file.file, file.data.toString('utf8')])));
  const step = (args, failure, installing = false) => new Promise((resolve, reject) => {
    let log = '';
    const env = environment(); env.PATH = [path.dirname(executables.node), env.PATH || ''].join(path.delimiter);
    const child = spawn(executables.node, [executables.npm, ...args], { cwd: directory, env, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { void terminate(child); reject(Error(`${failure} Det tog over ${Math.round(timeout / 60000)} minutter.`)); }, timeout);
    const output = chunk => { log = cleanOutput(log + chunk.toString()).slice(-16000); };
    child.stdout.on('data', output); child.stderr.on('data', output);
    child.once('error', () => { clearTimeout(timer); reject(Error('npm kunne ikke startes. Hent installationspakken igen.')); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const conflict = installing && npmFailureCode(log) === 'ERESOLVE' ? log.split('\n').filter(line => /Found:|peer .+ from /i.test(line)).slice(0, 3) : [];
      const tail = (conflict.length ? conflict : log.trim().split('\n').slice(-3)).join(' ').slice(-500);
      const message = installing ? npmFailure(log) : failure;
      reject(Error(`${message}${tail ? ` Sidste besked: ${tail}` : ''}`));
    });
  });
  try {
    for (const file of source.files) {
      const target = path.join(directory, ...file.file.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.data);
    }
    const install = names.has('package-lock.json') || names.has('npm-shrinkwrap.json') ? 'ci' : 'install';
    await step([install, '--no-audit', '--no-fund', '--include=dev', '--ignore-scripts', ...policy.args], 'Pakkeinstallationen blev ikke færdig.', true);
    await step(['run', 'build'], 'Bygningen fejlede. Ret fejlen i projektet, og gem en ny version.');
    let output = null;
    for (const candidate of OUTPUTS) { try { await fs.access(path.join(directory, candidate, 'index.html')); output = candidate; break; } catch {} }
    if (!output) throw Error('Bygningen gav ingen mappe med index.html. Aura leder i dist, build og out.');
    const built = await collect(path.join(directory, output));
    const hash = sha256(JSON.stringify(built.files.map(f => [f.file, f.sha256])));
    return { root: source.root, directory: output, head: source.head, hash, bytes: built.bytes, files: built.files, version: source.version, excludedFiles: built.excluded, built: { script: script.slice(0, 200), install: [`npm ${install}`, ...policy.args].join(' '), output, ...(policy.reason ? { installNote: policy.reason } : {}) } };
  } finally { await fs.rm(directory, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { komplaiSource, buildSaved, OUTPUTS };
