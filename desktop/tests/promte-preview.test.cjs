const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PromtePreview, isPromteProject, appName } = require('../core/promte-preview.cjs');
const { PromteSetup } = require('../core/provider-promte.cjs');
const lookup = async () => [{ address: '93.184.215.14', family: 4 }];
const HOST = 'https://kodning.promte.dk';

async function project(name = 'moedereferat-hjaelper', pkg = { devDependencies: { '@promte/app-library': '^0.1.6' } }) {
  const root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'promte-preview-')), name);
  await fs.mkdir(root); if (pkg) await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg));
  return root;
}
function memoryStore(hosting = {}) {
  const projects = {};
  return { projects, read: async () => ({ hosting }), project: async root => structuredClone(projects[root] || {}), saveProject: async (root, values) => { projects[root] = { ...projects[root], ...values }; } };
}
function fakeSetup({ connected = true, loginSource = 'aura' } = {}) {
  const calls = [];
  return {
    calls,
    state: async ({ host }) => ({ host, connected, loginSource: connected ? loginSource : null, email: 'dev@kommune.dk' }),
    login: async ({ host }) => { calls.push(['login', host]); connected = true; },
    createWorkspace: async ({ host, name }) => { calls.push(['create', host, name]); return { id: 'ws-new', name, activeAppVersion: null }; },
    client: { token: async () => connected ? 'syntetisk-login-token' : null, call: async (host, route, { body }) => { calls.push(['token', host, route, body.workspaceId, body.version]); return { token: 'app-token-' + calls.filter(c => c[0] === 'token').length }; } }
  };
}

test('Promte-projekter genkendes på app-biblioteket, og projektets navn bliver appens navn', async () => {
  assert.equal(await isPromteProject(await project()), true);
  assert.equal(await isPromteProject(await project('andet', { dependencies: { react: '19.2.8' } })), false);
  assert.equal(await isPromteProject(await project('uden', null)), false);
  assert.equal(appName('/x/moedereferat-hjaelper'), 'Moedereferat hjaelper');
});

test('en isoleret kopis bibliotek genkendes, mens valg og forbindelse bliver hos projektet', async t => {
  const root = await project('oprindeligt', { dependencies: {} }), copy = await project('kopi'), store = memoryStore(), setup = fakeSetup(), enabledRoots = [];
  t.after(() => Promise.all([root, copy].map(folder => fs.rm(path.dirname(folder), { recursive: true, force: true }))));
  const preview = new PromtePreview(store, { setup, enabled: async owner => { enabledRoots.push(owner); return true; } });
  assert.equal((await preview.connect(root)).active, false);
  const state = await preview.connect(root, { workspaceRoot: copy }); assert.equal(state.active, true); assert.equal(state.linked, false);
  await preview.create(root, copy);
  assert.equal(store.projects[root].promteApp.workspaceId, 'ws-new'); assert.equal(store.projects[copy], undefined); assert.ok(enabledRoots.every(owner => owner === root));
});

test('forhåndsvisningen opretter først Promte-appen, når brugeren vælger det, og genbruger den derefter', async () => {
  const root = await project(), store = memoryStore(), setup = fakeSetup();
  const preview = new PromtePreview(store, { setup, lookup });
  assert.deepEqual(await preview.connect(root), { active: true, connected: true, linked: false, host: HOST, name: 'Moedereferat hjaelper' });
  assert.deepEqual(setup.calls, [], 'Aura opretter intet i Promte uden brugerens valg');
  assert.equal(store.projects[root], undefined);
  const first = await preview.create(root);
  assert.deepEqual({ ...first, settings: undefined }, { active: true, connected: true, created: true, host: HOST, workspaceId: 'ws-new', name: 'Moedereferat hjaelper', settings: undefined });
  assert.deepEqual(first.settings, { workspaceId: 'ws-new', version: 0, backendUrl: HOST + '/api', fetchProxy: true, user: { email: 'dev@kommune.dk' } });
  assert.deepEqual(store.projects[root].promteApp, { host: HOST, workspaceId: 'ws-new', name: 'Moedereferat hjaelper' });
  const second = await preview.connect(root);
  assert.equal(second.created, false); assert.equal(second.workspaceId, 'ws-new');
  await preview.create(root);
  assert.equal(setup.calls.filter(c => c[0] === 'create').length, 1, 'appen oprettes kun én gang');
});

test('med Promte-integrationen slået fra svarer Aura ikke appen og kontakter ikke Promte', async () => {
  const root = await project(), store = memoryStore(), setup = fakeSetup(), roots = [];
  const preview = new PromtePreview(store, { setup, lookup, enabled: async value => { roots.push(value); return false; }, fetcher: async () => { throw Error('må ikke kaldes'); } });
  assert.deepEqual(await preview.connect(root), { active: false });
  assert.deepEqual(await preview.create(root), { active: false });
  store.projects[root] = { promteApp: { host: HOST, workspaceId: 'ws-old', name: 'Gammel' } };
  await assert.rejects(preview.fetch(root, { path: 'app-api/models', method: 'GET' }), /slået fra/);
  assert.deepEqual(setup.calls, []); assert.ok(roots.every(value => value === root), 'valget gælder det åbne projekt');
});

test('uden koblet app bruger forhåndsvisningen den Promte, brugeren er logget ind på i Aura', async () => {
  const future = new Date(Date.now() + 86400000).toISOString(), past = new Date(Date.now() - 1000).toISOString();
  const store = memoryStore({ promte: { 'https://staging.promte.dk': { secret: 'x', expiresAt: past }, 'https://kommune.applai.dk': { secret: 'y', expiresAt: future } } });
  const preview = new PromtePreview(store, { setup: fakeSetup(), lookup });
  assert.equal((await preview.connect(await project())).host, 'https://kommune.applai.dk');
  assert.equal((await new PromtePreview(memoryStore({ promte: { 'https://staging.promte.dk': { secret: 'x', expiresAt: past } } }), { setup: fakeSetup(), lookup }).connect(await project())).host, HOST);
});

test('uden login svarer Aura ikke appen, og andre projekter berøres ikke', async () => {
  const store = memoryStore();
  assert.deepEqual(await new PromtePreview(store, { setup: fakeSetup(), lookup }).connect(await project('web', { dependencies: {} })), { active: false });
  const signedOut = fakeSetup({ connected: false }), root = await project();
  assert.deepEqual(await new PromtePreview(store, { setup: signedOut, lookup }).connect(root), { active: true, connected: false, host: HOST });
  const afterLogin = await new PromtePreview(store, { setup: signedOut, lookup }).login(root);
  assert.equal(afterLogin.connected, true); assert.deepEqual(signedOut.calls.find(c => c[0] === 'login'), ['login', HOST]);
  assert.equal(afterLogin.settings, undefined); assert.equal(signedOut.calls.some(c => c[0] === 'create'), false, 'login opretter ingen app');
  // Et login fra Promtes CLI kan bruge en koblet app, men opretter ingen ny.
  const cli = fakeSetup({ loginSource: 'cli' }), other = await project('ny');
  assert.equal((await new PromtePreview(memoryStore(), { setup: cli, lookup }).connect(other)).connected, false);
  assert.equal(cli.calls.length, 0);
});

test('appens kald sendes kun til Promtes app-API med et app-token, der bliver i Aura', async () => {
  const root = await project(), store = memoryStore(), setup = fakeSetup(), requests = [];
  let status = 401;
  const preview = new PromtePreview(store, { setup, lookup, fetcher: async (url, options) => { requests.push({ url, options }); const response = new Response(JSON.stringify({ models: [] }), { status, headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' } }); status = 200; return response; } });
  await preview.create(root);
  const result = await preview.fetch(root, { path: 'app-api/models?type=llm', method: 'GET', headers: [['accept', 'application/json'], ['authorization', 'Bearer fra-appen'], ['cookie', 'x']] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.headers, [['content-type', 'application/json']]);
  assert.deepEqual(JSON.parse(Buffer.from(result.body).toString()), { models: [] });
  assert.equal(requests.length, 2, 'et udløbet token fornyes én gang');
  assert.equal(requests[0].url, HOST + '/api/app-api/models?type=llm');
  assert.deepEqual(requests.map(r => r.options.headers.Authorization), ['Bearer app-token-1', 'Bearer app-token-2']);
  assert.equal(requests[1].options.headers.cookie, undefined); assert.equal(requests[1].options.headers.accept, 'application/json');
  assert.deepEqual(setup.calls.filter(c => c[0] === 'token').map(c => c.slice(2)), [['/api/functions/generateToken', 'ws-new', 0], ['/api/functions/generateToken', 'ws-new', 0]]);
  await preview.fetch(root, { path: 'openai/chat/completions', method: 'POST', headers: [['content-type', 'application/json']], body: '{"model":"m"}' });
  assert.equal(setup.calls.filter(c => c[0] === 'token').length, 2, 'tokenet genbruges');
  assert.equal(requests.at(-1).options.body, '{"model":"m"}');
  for (const bad of ['https://andet.dk/app-api/x', 'functions/generateToken', 'app-api/../functions/x', 'api/app-api/x', 'extension-auth/start']) await assert.rejects(preview.fetch(root, { path: bad, method: 'GET' }), /app-API/, bad);
  await assert.rejects(preview.fetch(root, { path: 'app-api/data', method: 'TRACE' }), /metode/);
});

test('filer i en formular sendes videre som rigtige filer', async () => {
  const root = await project(), store = memoryStore(); let sent;
  const preview = new PromtePreview(store, { setup: fakeSetup(), lookup, fetcher: async (url, options) => { sent = options; return new Response('{}', { status: 200 }); } });
  await preview.create(root);
  await preview.fetch(root, { path: 'app-api/audio/stt', method: 'POST', headers: [['content-type', 'multipart/form-data; boundary=x']], body: { form: [['model', 'stt-1'], ['file', { data: new TextEncoder().encode('lyd').buffer, type: 'audio/webm', name: 'optagelse.webm' }]] } });
  assert.ok(sent.body instanceof FormData); assert.equal(sent.headers['content-type'], undefined, 'grænsen sættes af FormData');
  assert.equal(sent.body.get('model'), 'stt-1'); assert.equal(await sent.body.get('file').text(), 'lyd'); assert.equal(sent.body.get('file').name, 'optagelse.webm');
});

test('uden koblet app videresendes intet', async () => {
  const preview = new PromtePreview(memoryStore(), { setup: fakeSetup(), lookup, fetcher: async () => { throw Error('må ikke kaldes'); } });
  await assert.rejects(preview.fetch(await project(), { path: 'app-api/models', method: 'GET' }), /ikke koblet/);
});

function signedInPreview() {
  const state = { hosting: { promte: {} }, projects: { '/projekt': { promteApp: { host: HOST, workspaceId: 'ws-1' } } } };
  const store = { read: async () => structuredClone(state), project: async root => state.projects[root], decrypt: value => value.secret, update: async change => change(state) };
  const login = token => { state.hosting.promte[HOST] = { secret: token, expiresAt: '2099-01-01T00:00:00.000Z', email: token + '@example.invalid' }; };
  login('konto-a');
  const calls = [];
  const setup = new PromteSetup(store, { readCredentials: async () => null, lookup, fetcher: async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization });
    return new Response(JSON.stringify({ token: 'app-' + options.headers.Authorization }), { status: 200 });
  } });
  const sent = [];
  const preview = new PromtePreview(store, { setup, lookup, fetcher: async (url, options) => { sent.push(options.headers.Authorization); return new Response('{}'); } });
  return { preview, setup, calls, sent, login };
}
const modelRequest = { path: 'app-api/models', method: 'GET' };

test('Promte-app-token følger den aktuelle loginidentitet og afvises efter logud', async () => {
  const { preview, setup, calls, sent, login } = signedInPreview();
  await preview.fetch('/projekt', modelRequest); await preview.fetch('/projekt', modelRequest);
  assert.equal(calls.length, 1, 'samme konto genbruger app-tokenet');
  login('konto-b'); await preview.fetch('/projekt', modelRequest);
  assert.deepEqual(calls.map(call => call.authorization), ['Bearer konto-a', 'Bearer konto-b']);
  assert.deepEqual(sent, ['Bearer app-Bearer konto-a', 'Bearer app-Bearer konto-a', 'Bearer app-Bearer konto-b']);
  await setup.logout({ host: HOST });
  await assert.rejects(preview.fetch('/projekt', modelRequest), /Log ind med Promte igen/);
  assert.equal(sent.length, 3, 'intet cached app-token sendes efter logud');
  assert.equal(preview.tokens.size, 0);
});

test('et sent generateToken-svar fra tidligere konto afvises efter kontoskift eller logud', async () => {
  for (const action of ['kontoskift', 'logud']) {
    const { preview, setup, sent, login } = signedInPreview();
    let started, finish;
    const waiting = new Promise(resolve => { started = resolve; });
    setup.client.fetcher = async (_url, options) => { assert.equal(options.headers.Authorization, 'Bearer konto-a'); started(); return new Promise(resolve => { finish = () => resolve(new Response('{"token":"sent-app-token"}')); }); };
    const result = preview.fetch('/projekt', modelRequest);
    const rejected = assert.rejects(result, /kontoen er ændret|Log ind med Promte igen/);
    await waiting;
    if (action === 'kontoskift') login('konto-b'); else await setup.logout({ host: HOST });
    finish(); await rejected;
    assert.equal(sent.length, 0); assert.equal(preview.tokens.size, 0);
  }
});

test('et allerede afsendt app-svar leveres ikke efter kontoskift eller logud', async () => {
  for (const action of ['kontoskift', 'logud']) {
    const { preview, setup, login } = signedInPreview();
    let started, finish;
    const waiting = new Promise(resolve => { started = resolve; });
    preview.fetcher = async () => { started(); return new Promise(resolve => { finish = () => resolve(new Response('{"privat":"fra konto a"}')); }); };
    const result = preview.fetch('/projekt', modelRequest);
    const rejected = assert.rejects(result, /kontoen er ændret|Log ind med Promte igen/);
    await waiting;
    if (action === 'kontoskift') login('konto-b'); else await setup.logout({ host: HOST });
    finish(); await rejected;
  }
});
