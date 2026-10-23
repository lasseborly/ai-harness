const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DeploymentSetup } = require('../core/deployment-setup.cjs');
const { VercelSetup } = require('../core/vercel-setup.cjs');
const { AzureSetup } = require('../core/azure-setup.cjs');
const chosen = { provider: 'vercel', scope: 'mit-team', project: 'prj_test', repository: 'organisation/webside', productionBranch: 'main', name: 'webside', portal: 'https://vercel.com/mit-team/webside/settings/git' };
const remote = { id: chosen.project, name: chosen.name, link: { type: 'github', org: 'organisation', repo: 'webside', productionBranch: 'main' } };
const sha = 'a'.repeat(40);
async function fixture(t, initial = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-setup-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let value = initial;
  const store = { project: async () => value, saveProject: async (_root, patch) => { value = { ...value, ...patch }; return value; } };
  return { root, store };
}
function manual(provider, patch = {}) {
  return { id: 'udgivelse-1', startedAt: '2026-10-20T10:00:00Z', state: 'READY', config: { provider }, checks: { provider: { status: 'checked' } }, ...patch };
}
function deployments(store, check, providers = {}) {
  return { state: async root => ({ last: (await store.project(root)).deploymentLast || null }), check, providers };
}

test('Vercel-gennemgang skriver intet; bekræftelsen skriver den gennemgåede konfiguration og aktiverer sporing', async t => {
  const { root, store } = await fixture(t, { draft: 'Bevar' }); let observed = remote;
  const vercel = new VercelSetup(store, async (_exe, args) => { assert.equal(args[args.indexOf('--method') + 1], 'GET'); return JSON.stringify(observed); });
  const setup = new DeploymentSetup(store, {}, {}, { vercel });
  const review = await setup.act(root, { action: 'vercel-review', config: { ...chosen, token: 'hemmelig' } });
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal((await store.project(root)).vercelGit, undefined);
  assert.equal(review.files[0].path, '.aura/publishing/vercel.json');
  assert.doesNotMatch(review.files[0].content, /hemmelig/);
  await assert.rejects(setup.act(root, { action: 'vercel-track', config: chosen }), /Gennemgå/);
  await assert.rejects(setup.act(root, { action: 'config-save', token: review.token }), /Følg/);
  const result = await setup.act(root, { action: 'vercel-track', token: review.token });
  assert.deepEqual(result.written, ['.aura/publishing/vercel.json']);
  assert.equal(await fs.readFile(path.join(root, result.written[0]), 'utf8'), review.files[0].content);
  assert.deepEqual((await store.project(root)).vercelGit, chosen);
  assert.equal((await store.project(root)).deploymentTrackingSource, 'vercel-git');
  assert.equal((await store.project(root)).draft, 'Bevar');
  await assert.rejects(setup.act(root, { action: 'vercel-track', token: review.token }), /Gennemgå/);
  const next = await setup.act(root, { action: 'vercel-review', config: chosen });
  observed = { ...remote, link: { ...remote.link, productionBranch: 'release' } };
  await assert.rejects(setup.act(root, { action: 'vercel-track', token: next.token }), /ændret/);
  assert.deepEqual((await store.project(root)).vercelGit, chosen);
});

test('Versioneret Vercel-valg kan genlæses på en klon uden automatisk aktivering', async t => {
  const { root, store } = await fixture(t);
  const setup = new DeploymentSetup(store, {}, {}, { vercel: { state: async () => ({ status: 'login-required', teams: [] }), login: async () => ({ status: 'ready', teams: [{ id: 'team_test', slug: 'mit-team', name: 'Mit team' }] }) } });
  assert.equal((await setup.act(root, { action: 'vercel-state' })).projectConfig, null);
  await fs.mkdir(path.join(root, '.aura/publishing'), { recursive: true });
  const file = path.join(root, '.aura/publishing/vercel.json');
  await fs.writeFile(file, JSON.stringify({ ...chosen, version: 1, mode: 'git', token: 'hemmelig' }));
  const state = await setup.act(root, { action: 'vercel-state' });
  assert.deepEqual(state.projectConfig, chosen);
  assert.deepEqual((await setup.act(root, { action: 'vercel-login' })).projectConfig, chosen);
  assert.doesNotMatch(JSON.stringify(state), /hemmelig/);
  assert.equal((await store.project(root)).vercelGit, undefined);
  await fs.writeFile(file, '{ødelagt');
  assert.match((await setup.act(root, { action: 'vercel-state' })).configurationError, /kunne ikke læses/);
});

test('Vercel tracking-open bruger frisk Git-observation og ignorerer URL fra renderer', async t => {
  const { root, store } = await fixture(t, { vercelGit: chosen, deploymentTrackingSource: 'vercel-git' });
  let live = { config: chosen, latest: { id: 'dpl_test', state: 'READY', sha, branch: 'main', environment: 'production', url: 'https://ny.vercel.app' } }, reads = 0;
  const setup = new DeploymentSetup(store, {}, {}, { vercel: { saved: async () => chosen, latestStatus: async () => { reads++; return live; } } });
  assert.equal(await setup.open(root, { kind: 'tracking', provider: 'vercel', url: 'https://forkert.invalid' }), 'https://ny.vercel.app');
  assert.equal(reads, 1);
  await assert.rejects(setup.open(root, { kind: 'tracking', provider: 'azure' }), /ændret/);
  live = { config: chosen, latest: { ...live.latest, url: 'https://ny.vercel.app.evil.invalid' } };
  await assert.rejects(setup.open(root, { kind: 'tracking' }), /ukendt adresse/);
  live = { config: chosen, latest: null };
  await assert.rejects(setup.open(root, { kind: 'tracking' }), /ingen færdig/);
});

test('Vercels projektlink genkontrollerer projekt og Git-forbindelse og konstruerer selv adressen', async t => {
  const { root, store } = await fixture(t);
  let observed = remote;
  const calls = [];
  const vercel = new VercelSetup(store, async (_exe, args) => {
    calls.push(args);
    assert.deepEqual(args, ['api', '/v9/projects/prj_test', '--method', 'GET', '--raw', '--non-interactive', '--scope', 'mit-team']);
    return JSON.stringify(observed);
  });
  const setup = new DeploymentSetup(store, {}, {}, { vercel });
  const input = { provider: 'vercel', kind: 'project', url: 'https://forkert.invalid', config: { ...chosen, name: 'forkert', portal: 'https://forkert.invalid' } };
  assert.equal(await setup.open(root, input), chosen.portal);
  assert.equal(calls.length, 1);
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal((await store.project(root)).vercelGit, undefined);
  observed = { ...remote, id: 'prj_anden' };
  await assert.rejects(setup.open(root, input), /matcher ikke/);
  observed = { ...remote, link: { ...remote.link, repo: 'andet-projekt' } };
  await assert.rejects(setup.open(root, input), /matcher ikke/);
  observed = { ...remote, link: null };
  await assert.rejects(setup.open(root, input), /matcher ikke/);
  observed = { ...remote, name: 'webside/../../forkert' };
  await assert.rejects(setup.open(root, input), /Vælg et team og et projekt/);
  observed = remote;
  const reads = calls.length;
  await assert.rejects(setup.open(root, { ...input, config: { ...chosen, scope: 'mit-team@forkert.invalid' } }), /Vælg et team og et projekt/);
  assert.equal(calls.length, reads);
  assert.equal(await setup.open(root, { provider: 'vercel', kind: 'import' }), 'https://vercel.com/new');
});

test('Et nyt manuelt flow overtager topbaren; ældre Vercel-valg skjuler det ikke', async t => {
  const receipt = manual('azure', { url: 'https://app.azurestaticapps.net' });
  const { root, store } = await fixture(t, { vercelGit: chosen, deploymentTrackingSource: 'manual', deploymentLast: receipt });
  let checks = 0;
  const setup = new DeploymentSetup(store, {}, deployments(store, async () => { checks++; return receipt; }));
  assert.equal((await setup.tracking(root, true)).automatic, false);
  assert.equal(await setup.open(root, { kind: 'tracking', provider: 'azure' }), 'https://app.azurestaticapps.net');
  assert.equal(checks, 2);
  await store.saveProject(root, { deploymentTrackingSource: null });
  assert.equal((await setup.tracking(root)).automatic, false, 'Gamle projekter med en receipt bruger fortsat deres seneste udgivelse.');
});

test('Skift af flow under refresh kan hverken returnere eller åbne den fravalgte observation', async t => {
  const { root, store } = await fixture(t, { vercelGit: chosen, deploymentTrackingSource: 'vercel-git' });
  const newer = manual('azure', { url: 'https://app.azurestaticapps.net' });
  const setup = new DeploymentSetup(store, {}, deployments(store, async () => newer), { vercel: { saved: async () => chosen, latestStatus: async () => {
    await store.saveProject(root, { deploymentTrackingSource: 'manual', deploymentLast: newer });
    return { config: chosen, latest: { state: 'READY', url: 'https://gammel.vercel.app' } };
  } } });
  const result = await setup.tracking(root, true);
  assert.equal(result.automatic, false); assert.equal(result.observed, false); assert.equal(result.last.id, newer.id);
  await store.saveProject(root, { deploymentTrackingSource: 'vercel-git', deploymentLast: null });
  await assert.rejects(setup.open(root, { kind: 'tracking' }), /kunne ikke kontrolleres/);
});

test('Tracking afviser gamle statusdata, forkerte hosts og loginoplysninger i adresser', async t => {
  let receipt = manual('komplai', { url: 'https://app.komplai.run' });
  const { root, store } = await fixture(t, { deploymentLast: receipt });
  const setup = new DeploymentSetup(store, {}, deployments(store, async () => receipt));
  assert.equal(await setup.open(root, { kind: 'tracking' }), 'https://app.komplai.run');
  receipt = { ...receipt, checks: { provider: { status: 'unknown' } } };
  await assert.rejects(setup.open(root, { kind: 'tracking' }), /kunne ikke kontrolleres/);
  for (const url of ['https://app.komplai.run.evil.invalid', 'https://user:password@app.komplai.run', 'http://app.komplai.run', 'https://app.komplai.run/?token=privat']) {
    receipt = manual('komplai', { url });
    await assert.rejects(setup.open(root, { kind: 'tracking' }), /ukendt adresse/);
  }
});

test('Pages åbner præcis kontrolleret domæne eller run, også når Cloudflare giver et andet subdomæne', async t => {
  const pagesConfig = { provider: 'github-pages', repository: 'organisation/webside', branch: 'main', directory: 'public' };
  let receipt = manual('github-pages', { config: pagesConfig, url: 'https://www.eksempel.dk/' });
  const { root, store } = await fixture(t, { deploymentLast: receipt });
  let confirmedURL = receipt.url;
  const setup = new DeploymentSetup(store, {}, deployments(store, async () => receipt, { 'github-pages': { setup: async () => ({ pages: { url: confirmedURL }, repository: { fullName: pagesConfig.repository } }) } }));
  assert.equal(await setup.open(root, { kind: 'tracking' }), 'https://www.eksempel.dk/');
  confirmedURL = 'https://organisation.github.io/webside/';
  await assert.rejects(setup.open(root, { kind: 'tracking' }), /matcher ikke/);
  receipt = { ...receipt, state: 'BUILDING', url: null, workflowURL: 'https://github.com/organisation/webside/actions/runs/42', runId: 42 };
  assert.equal(await setup.open(root, { kind: 'tracking' }), receipt.workflowURL);
  receipt = { ...receipt, workflowURL: 'https://github.com/anden/webside/actions/runs/42' };
  await assert.rejects(setup.open(root, { kind: 'tracking' }), /ingen kontrolleret/);
  receipt = manual('cloudflare', { config: { ...pagesConfig, provider: 'cloudflare', project: 'blomst', accountId: 'a'.repeat(32) }, url: 'https://456789.blomst-unik.pages.dev' });
  assert.equal(await setup.open(root, { kind: 'tracking' }), receipt.url);
});

test('Promte åbner den valgte installation efter frisk status og konto-link går til kontakt', async t => {
  const receipt = manual('promte', { config: { provider: 'promte', host: 'https://app.promte.dk' }, target: { host: 'app.promte.dk' }, url: null });
  const { root, store } = await fixture(t, { deploymentLast: receipt });
  const setup = new DeploymentSetup(store, {}, deployments(store, async () => receipt));
  assert.equal(await setup.open(root, { kind: 'tracking' }), 'https://app.promte.dk');
  assert.equal(await setup.open(root, { provider: 'promte', kind: 'account' }), 'https://promte.com/kontakt');
});

test('Azure kan skelne tom app-liste fra afvist login eller adgang', async t => {
  const { root, store } = await fixture(t); let failed = false;
  const azure = new AzureSetup(async () => { if (failed) throw Error('Udløbet login'); return '[]'; });
  const setup = new DeploymentSetup(store, {}, {}, { azure });
  const input = { action: 'azure-apps', config: { subscription: '11111111-1111-1111-1111-111111111111' } };
  assert.deepEqual(await setup.act(root, input), []);
  failed = true;
  await assert.rejects(setup.act(root, input), /kunne ikke hentes/);
});

test('Udgiv spørger før Promte-login, om projektet er en Promte-app, og forklarer det i almindeligt dansk', async t => {
  const { root, store } = await fixture(t);
  const setup = new DeploymentSetup(store, {}, {}, { promte: { state: async () => { throw Error('Login må ikke læses under kontrollen'); } } });
  await fs.mkdir(path.join(root, 'public')); await fs.writeFile(path.join(root, 'public/index.html'), '<h1>Side</h1>');
  const { problem } = await setup.act(root, { action: 'promte-check' });
  assert.equal(problem.kind, 'website'); assert.match(problem.summary, /almindelig hjemmeside/); assert.match(problem.detail, /package\.json/);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true, scripts: { build: 'vite build' }, devDependencies: { react: '19.2.8' } }));
  await fs.writeFile(path.join(root, 'index.html'), '<div id="root"></div>');
  assert.deepEqual(await setup.act(root, { action: 'promte-check' }), { problem: null });
});
