const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Deployments } = require('../core/deployments.cjs');
const { PromteDeployment, preparePromteArtifact } = require('../core/provider-promte.cjs');
const { GitHubPagesDeployment, pagesWorkflow } = require('../core/pages-publishing.cjs');
const { zip } = require('../core/komplai-publish.cjs');
const head = 'a'.repeat(40), root = '/aura-test';
const promteConfig = { provider: 'promte', host: 'https://app.promte.dk', workspaceId: 'workspace-123', directory: '.' };
const pagesConfig = { provider: 'github-pages', repository: 'organisation/blomst', branch: 'main', directory: 'public' };
function artifact(entries, version = head) {
  const files = Object.entries(entries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, content]) => {
    const data = Buffer.from(content); return { file, data, sha256: createHash('sha256').update(data).digest('hex') };
  });
  return { head: version, files, hash: createHash('sha256').update(JSON.stringify(files.map(f => [f.file, f.sha256]))).digest('hex'), bytes: files.reduce((n, f) => n + f.data.length, 0) };
}
function storeFixture() {
  const state = {}, checkpoints = [];
  return { state, checkpoints, store: { project: async () => state, saveProject: async (_root, patch) => {
    Object.assign(state, patch); if (patch.deploymentLast) checkpoints.push(structuredClone(patch.deploymentLast));
  } } };
}
const sourceEntries = {
  'package.json': '{"private":true,"scripts":{"build":"vite build"},"devDependencies":{"react":"19.2.8"}}',
  'src/main.jsx': 'document.body.textContent = "Godkendt kildekode";',
  'vite.config.js': 'local-vite-configuration',
  'dist/index.html': '<h1>Kun lokal visning</h1>',
  'package-lock.json': '{"lockfileVersion":3}'
};
function promteFixture({ fail, entries = sourceEntries } = {}) {
  const memory = storeFixture(), calls = [];
  let material = artifact(entries), upload;
  const provider = new PromteDeployment({
    lookup: async () => [{ address: '1.1.1.1', family: 4 }],
    readCredentials: async () => ({ token: 'test-login-token' }),
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/capabilities?')) return Response.json({ available: true, uploadMode: 'source' });
      if (url.endsWith('/prepare')) {
        assert.equal(memory.state.deploymentLast.state, 'SUBMITTING');
        if (fail === 'prepare') throw Error('Testforbindelsen blev afbrudt');
        return Response.json({ version: 7, uploadHost: 'same-server', uploadToken: 'test-upload-token' });
      }
      if (url.includes('/api/upload-app?')) {
        assert.equal(memory.state.deploymentLast.state, 'PREPARED');
        assert.equal(memory.state.deploymentLast.id, 'version:7');
        if (fail === 'upload') throw Error('Testforbindelsen blev afbrudt');
        upload = options.body;
        return Response.json({ status: 'reviewing' });
      }
      if (url.endsWith('/finalize')) {
        assert.equal(memory.state.deploymentLast.state, 'UPLOADED');
        if (fail === 'finalize') throw Error('Testforbindelsen blev afbrudt');
        return Response.json({ releaseId: 'release-7', status: 'reviewing' });
      }
      if (url.includes('/releases')) return Response.json({ releases: [{ id: 'release-7', version: 7, status: 'reviewing' }], release: { id: 'release-7', version: 7, status: 'reviewing' } });
      throw Error('Uventet Promte-rute i test');
    }
  });
  const deployments = new Deployments(memory.store, { providers: { promte: provider }, artifact: async () => material });
  return { ...memory, deployments, calls, material: () => material, change: value => { material = value; }, upload: () => upload };
}
test('Udgiv gennemgår og uploader præcis Promtes filudvalg med nyt fingeraftryk og viste fravalg', async () => {
  const f = promteFixture(), original = f.material(), expected = preparePromteArtifact(original);
  const review = await f.deployments.review(root, promteConfig);
  assert.deepEqual(review.files, ['package.json', 'src/main.jsx']);
  assert.deepEqual(review.excludedFiles, ['dist/index.html', 'package-lock.json', 'vite.config.js']);
  assert.equal(review.hash, expected.hash); assert.equal(review.bytes, expected.bytes);
  assert.notEqual(review.hash, original.hash); assert.equal(original.files.length, 5);
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 0);
  const receipt = await f.deployments.deploy(root, review.token);
  assert.equal(receipt.hash, expected.hash); assert.equal(receipt.state, 'REVIEWING');
  assert.equal(f.state.deploymentTrackingSource, 'manual');
  assert.deepEqual(f.checkpoints.map(checkpoint => checkpoint.state), ['SUBMITTING', 'PREPARED', 'UPLOADED', 'REVIEWING', 'REVIEWING']);
  assert.ok(f.upload().includes(zip(expected.files)));
  assert.ok(!f.upload().includes(Buffer.from('vite.config.js')));
  assert.ok(!JSON.stringify(receipt).includes('test-upload-token'));
  assert.ok(!JSON.stringify(receipt).includes('test-login-token'));
  const checked = await f.deployments.check(root);
  assert.equal(checked.state, 'REVIEWING'); assert.equal(checked.checks.site.status, 'skipped');
});
test('Udgiv beregner Promtes uploadhash igen og afviser ændret kildekode eller Git-version', async () => {
  for (const change of ['kildekode', 'version', 'privat fil']) {
    const f = promteFixture(), review = await f.deployments.review(root, promteConfig);
    if (change === 'kildekode') f.change(artifact({ ...sourceEntries, 'src/main.jsx': 'Anden kildekode' }));
    if (change === 'version') f.change(artifact(sourceEntries, 'b'.repeat(40)));
    if (change === 'privat fil') f.deployments.artifact = async () => { throw Error('Mulig hemmelighed i kildepakken.'); };
    await assert.rejects(f.deployments.deploy(root, review.token), /ændret sig|Mulig hemmelighed/);
    assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 0);
    assert.equal(f.checkpoints.length, 0);
  }
  const f = promteFixture(), review = await f.deployments.review(root, promteConfig);
  f.change(artifact({ ...sourceEntries, 'vite.config.js': 'Anden lokal byggekonfiguration' }));
  assert.equal((await f.deployments.deploy(root, review.token)).hash, review.hash);
});
test('Den oprindelige fil- og Git-kontrol udføres før Promtes fravalg og før kontakt til udbyderen', async () => {
  const f = promteFixture();
  f.deployments.artifact = async () => { throw Error('Gem eller gennemgå lokale ændringer før udgivelse.'); };
  await assert.rejects(f.deployments.review(root, promteConfig), /lokale ændringer/);
  assert.equal(f.calls.length, 0);
});
test('Udgiv bevarer PREPARED og UPLOADED uden at kalde en uafklaret handling udgivet', async () => {
  for (const [fail, state, message] of [['upload', 'PREPARED', /oprettet hos Promte.*upload er ikke bekræftet/], ['finalize', 'UPLOADED', /modtaget filerne.*videre behandling er ikke bekræftet/]]) {
    const f = promteFixture({ fail }), review = await f.deployments.review(root, promteConfig);
    const receipt = await f.deployments.deploy(root, review.token);
    assert.equal(receipt.state, state); assert.equal(receipt.id, 'version:7'); assert.equal(receipt.url, null);
    assert.match(receipt.verification, message);
    assert.equal(f.calls.filter(call => call.url.endsWith('/prepare')).length, 1);
    await assert.rejects(f.deployments.deploy(root, review.token), /igen/);
    assert.equal((await f.deployments.check(root)).state, 'REVIEWING');
  }
  const f = promteFixture({ fail: 'prepare' }), review = await f.deployments.review(root, promteConfig);
  await assert.rejects(f.deployments.deploy(root, review.token), /Udgivelsen blev ikke bekræftet/);
  assert.equal(f.state.deploymentLast.state, 'UNKNOWN'); assert.equal(f.state.deploymentLast.id, null);
});
function pagesFixture({ failDispatch = false } = {}) {
  const memory = storeFixture(), calls = [], material = artifact({ 'index.html': '<h1>Gennemgået side</h1>' });
  let requestId, remoteHead = head;
  const github = {
    state: async () => ({ connected: true }),
    api: async (route, options = {}) => {
      calls.push({ route, options });
      if (route === '/repos/organisation/blomst') return { id: 42, full_name: 'organisation/blomst', permissions: { push: true } };
      if (route.includes('/branches/')) return { commit: { sha: remoteHead } };
      if (route.includes('/contents/')) return { type: 'file', encoding: 'base64', content: Buffer.from(pagesWorkflow(pagesConfig).content).toString('base64') };
      if (route.endsWith('/pages')) return { html_url: 'https://blomst.example.org/app/', build_type: 'workflow', public: true };
      if (route.endsWith('/dispatches')) {
        const saved = memory.state.deploymentLast;
        assert.equal(saved.state, 'SUBMITTING'); assert.equal(saved.id, options.body.inputs.request_id);
        assert.equal(options.body.inputs.reviewed_sha, head); assert.equal(options.body.inputs.reviewed_hash, material.hash);
        requestId = saved.id;
        if (failDispatch) throw Error('Ukendt svar fra GitHub');
        return { workflow_run_id: 57 };
      }
      if (route.endsWith('/jobs?per_page=100')) return { jobs: [{ name: 'publish', conclusion: 'success', steps: [{ name: 'Udgiv de gennemgåede filer', conclusion: 'success' }] }] };
      const run = { id: 57, display_title: `Aura Pages ${requestId}`, head_sha: head, event: 'workflow_dispatch', path: pagesWorkflow(pagesConfig).path, status: 'completed', conclusion: 'success' };
      if (route.includes('/runs?')) return { workflow_runs: [run] };
      if (route.endsWith('/actions/runs/57')) return run;
      if (route.includes('/actions/workflows/')) return { id: 13, state: 'active' };
      throw Error('Uventet GitHub-rute i test: ' + route);
    }
  };
  const deployments = new Deployments(memory.store, { providers: { 'github-pages': new GitHubPagesDeployment(github) }, artifact: async () => material });
  return { ...memory, deployments, calls, material, remoteVersion: value => { remoteHead = value; } };
}
test('Pages startes kun efter gennemgang, gemmer korrelation før dispatch og kan genfinde tabt svar', async () => {
  const f = pagesFixture({ failDispatch: true }), review = await f.deployments.review(root, pagesConfig);
  assert.equal(f.calls.filter(call => call.options.method).length, 0);
  const receipt = await f.deployments.deploy(root, review.token);
  assert.equal(receipt.state, 'SUBMITTING'); assert.ok(receipt.id);
  assert.match(receipt.verification, /Starten af GitHub-kørslen er ikke bekræftet/);
  assert.doesNotMatch(receipt.verification, /uploadet|modtaget/);
  f.deployments.pagesFetcher = async () => new Response(f.material.files[0].data);
  const checked = await f.deployments.check(root);
  assert.equal(checked.state, 'READY'); assert.equal(checked.checks.content.status, 'matched');
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
  await assert.rejects(f.deployments.deploy(root, review.token), /igen/);
});
test('Pages stopper ændret GitHub-version før dispatch og afviser backend før GitHub-kald', async () => {
  const f = pagesFixture(), review = await f.deployments.review(root, pagesConfig);
  f.remoteVersion('b'.repeat(40));
  await assert.rejects(f.deployments.deploy(root, review.token), /ikke den gennemgåede/);
  assert.equal(f.calls.filter(call => call.options.method).length, 0);
  const backend = pagesFixture();
  backend.deployments.artifact = async () => artifact({ 'index.html': 'Forside', 'functions/private.js': 'Serverkode' });
  await assert.rejects(backend.deployments.review(root, pagesConfig), /serverkode/);
  assert.equal(backend.calls.length, 0);
});
test('Udgiv bruger DNS-fast sidekontrol for Pages med eget domæne og følger ikke viderestilling', async t => {
  const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
  let address = '1.1.1.1', requests = 0, status = 200;
  t.mock.method(require('node:dns/promises'), 'lookup', async () => [{ address, family: 4 }]);
  t.mock.method(require('node:https'), 'request', (url, options, callback) => {
    requests++;
    assert.equal(url.href, 'https://blomst.example.org/app/');
    assert.equal(options.headers.Cookie, undefined); assert.equal(options.headers.Authorization, undefined);
    options.lookup(url.hostname, {}, (error, selected) => { assert.equal(error, null); assert.equal(selected, '1.1.1.1'); });
    const req = new EventEmitter();
    req.end = () => {
      const response = new PassThrough(); response.statusCode = status; response.headers = status === 302 ? { location: 'http://127.0.0.1/private' } : {};
      callback(response); response.end('<h1>Gennemgået side</h1>');
    };
    return req;
  });
  const f = pagesFixture(), review = await f.deployments.review(root, pagesConfig);
  await f.deployments.deploy(root, review.token);
  const checked = await f.deployments.check(root);
  assert.equal(checked.checks.content.status, 'matched'); assert.equal(requests, 1);
  address = '127.0.0.1';
  assert.equal((await f.deployments.check(root)).checks.site.status, 'unreachable'); assert.equal(requests, 1);
  address = '1.1.1.1'; status = 302;
  const redirected = await f.deployments.check(root);
  assert.equal(redirected.checks.site.http, 302); assert.equal(redirected.checks.content.status, 'skipped');
  assert.equal(requests, 2);
});
test('Forsinket statuskontrol kan ikke overskrive en nyere kvittering eller en nyere kontrol', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { Store } = require('../core/store.cjs');
  const location = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-publish-store-'));
  t.after(() => fs.rm(location, { recursive: true, force: true }));
  const store = new Store(location, {}), original = {
    config: promteConfig, id: 'version:7', promteVersion: 7, head, hash: 'b'.repeat(64),
    state: 'PREPARED', startedAt: '2026-10-20T09:00:00.000Z', checks: null
  };
  for (const change of ['ny udgivelse', 'nyere uploadtrin', 'nyere kontrol']) {
    await store.saveProject(root, { deploymentLast: original });
    let complete, observed;
    const started = new Promise(resolve => { observed = resolve; }), result = new Promise(resolve => { complete = resolve; });
    let calls = 0;
    const provider = { status: async () => {
      if (++calls === 1) { observed(); return result; }
      return { state: 'BUILDING', url: null };
    } };
    const deployments = new Deployments(store, { providers: { promte: provider } });
    const pending = deployments.check(root); await started;
    let newer;
    if (change === 'nyere kontrol') newer = await deployments.check(root);
    else {
      newer = { ...original, ...(change === 'ny udgivelse' ? { id: 'version:8', promteVersion: 8, startedAt: '2026-10-20T09:01:00.000Z' } : { state: 'UPLOADED' }) };
      await store.saveProject(root, { deploymentLast: newer });
    }
    complete({ state: 'READY', url: null });
    assert.deepEqual(await pending, newer, change);
    assert.deepEqual((await store.project(root)).deploymentLast, newer, change);
  }
});
