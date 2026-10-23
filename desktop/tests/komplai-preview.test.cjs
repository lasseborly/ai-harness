const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { KomplaiPreview, localManifest, BRIDGE } = require('../core/komplai-preview.cjs');
const { startPreview } = require('../core/preview.cjs');
const APP = '11111111-2222-4333-8444-555555555555';
const future = () => new Date(Date.now() + 86400000).toISOString();

async function project(t, name = 'moedebooking', files = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'komplai-preview-')); t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, name);
  for (const [file, data] of Object.entries({ 'public/index.html': '<!doctype html><script src="/_komplai/run/v1.js"></script>', ...files })) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), data); }
  return root;
}
function memoryStore({ connected = true, expiresAt = future() } = {}) {
  const state = { hosting: connected ? { komplai: { secret: 'krypteret', expiresAt } } : {}, projects: {} };
  return { state, read: async () => structuredClone(state), project: async root => structuredClone(state.projects[root] || {}), saveProject: async (root, values) => { state.projects[root] = { ...state.projects[root], ...values }; } };
}
function fakeProvider({ expireOnce = false } = {}) {
  const calls = []; let sessions = 0, expired = !expireOnce;
  return {
    calls,
    createApp: async name => { calls.push(['create', name]); return { id: APP, name }; },
    sdkScript: async () => { calls.push(['sdk']); return 'window.komplai = {};'; },
    preview: async (appId, manifest) => { calls.push(['preview', appId, manifest]); sessions++; return { session: 'session-' + sessions, expiresAt: future(), app: { protocol: 1, app: { id: appId, name: 'Mødebooking', visibility: 'private', version: null }, declared: ['identity'], session: { expiresAt: future() } } }; },
    previewCall: async (appId, request) => {
      calls.push(['call', appId, request]);
      if (!expired) { expired = true; return { status: 401, body: { error: 'session_expired' } }; }
      return { status: 200, body: { memberId: 'm1', name: 'Rigtig Person' } };
    }
  };
}

test('uden integrationen svarer forhåndsvisningen ikke og kontakter ikke komplai', async t => {
  const root = await project(t), provider = fakeProvider(), store = memoryStore();
  store.state.projects[root] = { komplaiApp: { appId: APP, name: 'Mødebooking' } };
  const preview = new KomplaiPreview(store, { provider, enabled: async () => false });
  assert.deepEqual(await preview.state(root), { active: false });
  assert.equal(await preview.script(root, '/_komplai/run/v1.js'), null);
  assert.deepEqual(await preview.call(root, { method: 'GET', path: '/_komplai/api/v1/identity/me' }), { status: 503, body: { error: 'unavailable' } });
  await assert.rejects(preview.create(root), /slået fra/);
  assert.deepEqual(provider.calls, []);
});

test('uden login eller app tilbydes login og oprettelse; appen oprettes først efter valg og kun for organisationen', async t => {
  const root = await project(t), provider = fakeProvider();
  const signedOut = new KomplaiPreview(memoryStore({ connected: false }), { provider });
  assert.equal((await signedOut.state(root)).connected, false);
  assert.deepEqual(await signedOut.call(root, { method: 'GET', path: '/_komplai/api/v1/app' }), { status: 503, body: { error: 'unavailable' } });
  await assert.rejects(signedOut.create(root), /Log ind/);
  const store = memoryStore(), preview = new KomplaiPreview(store, { provider });
  assert.deepEqual(await preview.state(root), { active: true, connected: true, link: null, name: 'Moedebooking', problem: null });
  assert.deepEqual(provider.calls, [], 'status kontakter ikke komplai');
  const created = await preview.create(root);
  assert.deepEqual(created.link, { appId: APP, name: 'Moedebooking' });
  assert.deepEqual(provider.calls, [['create', 'Moedebooking']]);
  await preview.create(root);
  assert.equal(provider.calls.filter(c => c[0] === 'create').length, 1, 'appen oprettes kun én gang');
});

test('Udgiv og forhåndsvisning bruger samme app: projektets seneste komplai-udgivelse', async t => {
  const root = await project(t), store = memoryStore(), preview = new KomplaiPreview(store, { provider: fakeProvider() });
  store.state.projects[root] = { deploymentLast: { config: { provider: 'komplai', appId: APP }, appId: APP, target: { name: 'Budget' } } };
  assert.deepEqual(await preview.link(root), { appId: APP, name: 'Budget' });
  store.state.projects[root].komplaiApp = { appId: '22222222-2222-4222-8222-222222222222', name: 'Tidligere app' };
  assert.deepEqual(await preview.link(root), { appId: APP, name: 'Budget' }, 'en senere udgivelse erstatter forbindelsen oprettet i forhåndsvisningen');
  store.state.projects[root] = { deploymentLast: { config: { provider: 'vercel' } } };
  assert.equal(await preview.link(root), null);
});

test('SDK-kald går til Hubs forhåndsvisning med det lokale manifest; app-svaret kommer fra sessionen', async t => {
  const manifest = { sdk: 1, uses: { identity: { fields: ['name'], reason: 'Viser hvem der booker.' } } };
  const root = await project(t, 'moedebooking', { 'public/komplai.json': JSON.stringify(manifest) }), provider = fakeProvider(), store = memoryStore();
  store.state.projects[root] = { komplaiApp: { appId: APP, name: 'Mødebooking' } };
  const preview = new KomplaiPreview(store, { provider });
  const app = await preview.call(root, { method: 'GET', path: '/_komplai/api/v1/app' });
  assert.equal(app.status, 200); assert.equal(app.body.app.id, APP);
  assert.deepEqual(provider.calls[0], ['preview', APP, manifest]);
  const me = await preview.call(root, { method: 'GET', path: '/_komplai/api/v1/identity/me', body: { ignoreres: true } });
  assert.deepEqual(me, { status: 200, body: { memberId: 'm1', name: 'Rigtig Person' } });
  assert.deepEqual(provider.calls.at(-1), ['call', APP, { capability: 'identity', operation: 'me', method: 'GET', query: '', input: null, session: 'session-1' }]);
  await preview.call(root, { method: 'POST', path: '/_komplai/api/v1/data/list?limit=5', body: { collection: 'bookings' } });
  assert.deepEqual(provider.calls.at(-1)[2], { capability: 'data', operation: 'list', method: 'POST', query: 'limit=5', input: { collection: 'bookings' }, session: 'session-1' });
  assert.equal(provider.calls.filter(c => c[0] === 'preview').length, 1, 'sessionen genbruges');
  // Et ændret manifest giver en ny session, så Hub kender de aktuelle brug.
  await fs.writeFile(path.join(root, 'public/komplai.json'), JSON.stringify({ sdk: 1, uses: {} }));
  await preview.call(root, { method: 'GET', path: '/_komplai/api/v1/capabilities' });
  assert.deepEqual(provider.calls.filter(c => c[0] === 'preview').map(c => c[2]), [manifest, { sdk: 1, uses: {} }]);
});

test('en udløbet session startes forfra én gang; ugyldige kald og manifester afvises lokalt', async t => {
  const root = await project(t, 'app', { 'public/index.html': '<head><script type="application/komplai+json">{"sdk":1,"uses":{}}</script></head>' }), provider = fakeProvider({ expireOnce: true }), store = memoryStore();
  store.state.projects[root] = { komplaiApp: { appId: APP, name: 'App' } };
  const preview = new KomplaiPreview(store, { provider });
  assert.equal((await preview.call(root, { method: 'GET', path: '/_komplai/api/v1/identity/me' })).status, 200);
  assert.deepEqual(provider.calls.filter(c => c[0] === 'call').map(c => c[2].session), ['session-1', 'session-2']);
  for (const [request, status, error] of [
    [{ method: 'GET', path: '/_komplai/api/v1/../hub' }, 404, 'not_found'],
    [{ method: 'GET', path: 'https://hub.komplai.dk/api' }, 404, 'not_found'],
    [{ method: 'TRACE', path: '/_komplai/api/v1/identity/me' }, 405, 'method_not_allowed'],
    [{ method: 'POST', path: '/_komplai/api/v1/data/add', body: { data: 'x'.repeat(500 * 1024) } }, 413, 'invalid_input'],
    [{ method: 'POST', path: '/_komplai/api/v1/app' }, 405, 'method_not_allowed']
  ]) assert.deepEqual(await preview.call(root, request), { status, body: { error } }, request.path);
  await fs.writeFile(path.join(root, 'komplai.json'), '{ikke json');
  assert.deepEqual(await localManifest(root), { invalid: true });
  const fresh = new KomplaiPreview(store, { provider });
  const before = provider.calls.length;
  assert.deepEqual(await fresh.call(root, { method: 'GET', path: '/_komplai/api/v1/app' }), { status: 400, body: { error: 'invalid_manifest' } });
  assert.equal(provider.calls.length, before, 'et ugyldigt manifest sendes ikke');
});

test('Hubs afvisning af forhåndsvisningen går til appen med koden og vises i status', async t => {
  const root = await project(t), store = memoryStore();
  store.state.projects[root] = { komplaiApp: { appId: APP, name: 'App' } };
  const provider = { ...fakeProvider(), preview: async () => { const e = Error('Du kan kun udgive til apps, du selv har oprettet.'); e.code = 'forbidden'; e.status = 403; throw e; } };
  const preview = new KomplaiPreview(store, { provider });
  assert.deepEqual(await preview.call(root, { method: 'GET', path: '/_komplai/api/v1/app' }), { status: 403, body: { error: 'forbidden' } });
  assert.match((await preview.state(root)).problem, /selv har oprettet/);
});

test('SDK-filen er broen foran komplais SDK, og den statiske forhåndsvisning serverer den på /_komplai/run/', async t => {
  const root = await project(t), provider = fakeProvider();
  const preview = new KomplaiPreview(memoryStore(), { provider });
  const script = await preview.script(root, '/_komplai/run/v1.js');
  assert.ok(script.startsWith(BRIDGE)); assert.ok(script.endsWith('window.komplai = {};'));
  await preview.script(root, '/_komplai/run/v1.js');
  assert.equal(provider.calls.filter(c => c[0] === 'sdk').length, 1, 'SDK-filen genbruges');
  assert.match(await preview.script(root, '/_komplai/run/v1.mjs'), /export default komplai/);
  assert.equal(await preview.script(root, '/_komplai/run/andet.js'), null);
  const server = await startPreview(root, { sdk: route => preview.script(root, route) }); t.after(() => server.close());
  const origin = new URL(server.url).origin;
  const sdk = await fetch(origin + '/_komplai/run/v1.js');
  assert.equal(sdk.status, 200); assert.match(sdk.headers.get('content-type'), /javascript/); assert.ok((await sdk.text()).startsWith(BRIDGE));
  assert.equal((await fetch(origin + '/_komplai/run/andet.js')).status, 404);
  assert.equal((await fetch(origin + '/index.html')).status, 404, 'projektfiler kræver fortsat forhåndsvisningens hemmelige sti');
  const without = await startPreview(root); t.after(() => without.close());
  assert.equal((await fetch(new URL(without.url).origin + '/_komplai/run/v1.js')).status, 404);
});
