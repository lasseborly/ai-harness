const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { KomplaiDeployment, zip, crc32, refusedFiles, suggestLabel, validLabel, appURL } = require('../core/komplai-publish.cjs');
const { Deployments, configuration } = require('../core/deployments.cjs');
const { Store } = require('../core/store.cjs');
const { recommended } = require('../core/features.cjs');

const safe = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('k:' + Buffer.from(value).toString('base64')), decryptString: buffer => Buffer.from(buffer.toString().slice(2), 'base64').toString() };
const grant = 'komp_publish_grant_' + 'a'.repeat(64);
const appId = '11111111-2222-4333-8444-555555555555';
async function connectedStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-publish-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Store(directory, safe);
  await store.update(state => { state.hosting = { komplai: { secret: store.encrypt(grant), grantId: 'g', organisationId: 'o', organisationName: 'Gentofte Kommune', address: 'komplai.run', expiresAt: new Date(Date.now() + 86400000).toISOString() } }; });
  return store;
}

test('komplai Run: adresser, filregler og en ZIP med korrekte kontrolsummer', () => {
  assert.equal(crc32(Buffer.from('123456789')).toString(16), 'cbf43926');
  assert.equal(suggestLabel('Mødelokaler på Rådhuset'), 'moedelokaler-paa-raadhuset');
  assert.equal(suggestLabel('ab'), '');
  assert.equal(suggestLabel('Admin'), '');
  for (const ok of ['budget', 'budget-2027', 'a1b']) assert.equal(validLabel(ok), true, ok);
  for (const bad of ['ab', 'www', 'xn--bcher', 'Budget', '-budget', appId]) assert.equal(validLabel(bad), false, bad);
  assert.deepEqual(refusedFiles(['index.html', 'css/app.css', '.nojekyll', 'README', 'app.js.map', 'æøå.html', '_komplai/x.js', 'manifest.webmanifest'].map(file => ({ file }))), ['.nojekyll', 'README', 'app.js.map', 'æøå.html', '_komplai/x.js', 'manifest.webmanifest']);
  const archive = zip([{ file: 'index.html', data: Buffer.from('<h1>' + 'x'.repeat(2000) + '</h1>') }, { file: 'tom.txt', data: Buffer.alloc(0) }]);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.equal(archive.readUInt16LE(archive.length - 12), 2);
  assert.throws(() => appURL('https://komplai.run.angriber.invalid/'), /ukendt adresse/);
  assert.throws(() => appURL('http://budget.komplai.run/'), /ukendt adresse/);
  assert.equal(appURL('https://budget.komplai.run/'), 'https://budget.komplai.run');
});

test('komplai Run: synlighed vælges altid, og adresse og app kontrolleres før gennemgang', () => {
  assert.throws(() => configuration({ provider: 'komplai', name: 'Budget' }), /hvem der kan åbne/);
  assert.throws(() => configuration({ provider: 'komplai', name: 'Budget', visibility: 'private', slug: 'admin' }), /Adressen kan ikke bruges/);
  assert.throws(() => configuration({ provider: 'komplai', appId: 'ikke-et-id', visibility: 'public' }), /Vælg en af dine apps/);
  assert.throws(() => configuration({ provider: 'komplai', name: '', visibility: 'public' }), /navn/);
  // En ny offentlig app bekræftes med appens navn, som Hub kræver.
  assert.throws(() => configuration({ provider: 'komplai', name: 'Budget', slug: '', visibility: 'public' }), /bekræfte/);
  assert.throws(() => configuration({ provider: 'komplai', name: 'Budget', slug: '', visibility: 'public', confirmPublic: 'budget' }), /bekræfte/);
  assert.deepEqual(configuration({ provider: 'komplai', name: ' Budget ', slug: '', visibility: 'public', confirmPublic: 'Budget ' }), { provider: 'komplai', mode: 'static', directory: 'public', visibility: 'public', frontend: '.', api: '', name: 'Budget', confirmPublic: 'Budget', slug: '' });
  assert.equal(configuration({ provider: 'komplai', name: 'Budget', visibility: 'private', confirmPublic: 'Andet' }).confirmPublic, undefined, 'en privat app sender ingen bekræftelse');
  assert.deepEqual(configuration({ provider: 'komplai', appId, visibility: 'private', directory: 'dist' }), { provider: 'komplai', mode: 'static', directory: 'dist', visibility: 'private', frontend: '.', api: '', appId });
});

test('komplai Run: ny app gemmes før upload, ZIP eller HTML, bevaret deling og status', async t => {
  const store = await connectedStore(t), calls = [];
  let active = null;
  const app = { id: appId, name: 'Budget', slug: 'budget', url: 'https://budget.komplai.run', visibility: 'private', releases: [] };
  const fetcher = async (url, options) => {
    const route = url.replace('https://hub.komplai.dk', '');
    calls.push({ route, method: options.method, type: options.headers['Content-Type'], auth: options.headers.Authorization, origin: options.headers.Origin, body: options.body });
    if (route === '/api/publish/native') return Response.json({ address: 'komplai.run', slugs: true, apps: active === undefined ? [] : [{ ...app, activeRelease: active }] });
    if (route.startsWith('/api/publish/native/address')) return Response.json({ available: !route.includes('slug=taget'), reason: route.includes('slug=taget') ? 'slug_taken' : null });
    if (route === '/api/publish/native/apps') { active = null; return Response.json({ ...app, activeRelease: null }); }
    if (route === `/api/publish/native/apps/${appId}`) { app.visibility = JSON.parse(options.body).visibility; return Response.json(app); }
    if (route === `/api/publish/${appId}/releases`) { active = 'release-' + calls.length; return Response.json({ ...app, activeRelease: active }); }
    throw Error('Uventet ' + route);
  };
  active = undefined;
  const provider = new KomplaiDeployment(store, { fetcher });
  await assert.rejects(provider.inspect({ provider: 'komplai', name: 'Budget', slug: 'taget', visibility: 'private' }), /allerede i brug/);
  const target = await provider.inspect({ provider: 'komplai', name: 'Budget', slug: 'budget', visibility: 'private' });
  assert.equal(target.host, 'budget.komplai.run'); assert.equal(target.created, true); assert.match(target.access, /medlemmer af organisationen/);
  const created = [];
  const files = [{ file: 'index.html', data: Buffer.from('<h1>Budget</h1>') }, { file: 'app.js', data: Buffer.from('1') }];
  await assert.rejects(provider.deploy({ name: 'Budget', visibility: 'private' }, { files: [...files, { file: '.env.local', data: Buffer.from('x') }] }, target), /kan ikke modtage/);
  const result = await provider.deploy({ name: 'Budget', slug: 'budget', visibility: 'private' }, { files }, target, { onCreated: async id => created.push(id) });
  assert.deepEqual(created, [appId]);
  assert.deepEqual(result, { id: active, state: 'READY', url: 'https://budget.komplai.run', appId });
  const upload = calls.find(c => c.route.endsWith('/releases'));
  assert.equal(upload.type, 'application/zip'); assert.equal(upload.auth, 'Bearer ' + grant); assert.equal(upload.origin, undefined);
  const create = calls.findIndex(c => c.route === '/api/publish/native/apps'), send = calls.indexOf(upload);
  assert.ok(create >= 0 && create < send, 'Appen oprettes før uploaden');
  assert.deepEqual(JSON.parse(calls[create].body), { name: 'Budget', visibility: 'private', slug: 'budget' });
  // Eksisterende app: kun én HTML-fil; eksisterende adgang bevares.
  calls.length = 0;
  const existing = await provider.inspect({ provider: 'komplai', appId, visibility: 'private' });
  assert.equal(existing.currentVisibility, 'private');
  await provider.deploy({ appId, visibility: 'private' }, { files: [files[0]] }, existing);
  assert.deepEqual(calls.filter(c => c.method !== 'GET').map(c => [c.method, c.route, c.type]), [['POST', `/api/publish/${appId}/releases`, 'text/html']]);
  assert.deepEqual(await provider.status({ appId }, { id: active, appId }), { state: 'READY', url: 'https://budget.komplai.run', visibility: 'private' });
  assert.equal((await provider.status({ appId }, { id: 'gammel', appId })).state, 'REPLACED');
  await store.update(state => { state.hosting.komplai.expiresAt = new Date(Date.now() - 1000).toISOString(); });
  await assert.rejects(provider.inspect({ appId, visibility: 'public' }), /udløbet/);
});

test('komplai Run: kontrollen genkender en privat app bag login', async t => {
  const store = await connectedStore(t);
  const receipt = { id: 'r1', appId, url: 'https://budget.komplai.run', config: { provider: 'komplai', visibility: 'private', appId }, target: { owner: 'Gentofte Kommune' }, state: 'READY' };
  await store.saveProject('/projekt', { deploymentLast: receipt });
  const deployments = new Deployments(store, { providers: { komplai: { status: async () => ({ state: 'READY', url: receipt.url, visibility: 'private' }) } }, fetcher: async url => { assert.equal(url, receipt.url); return new Response('<h1>Denne app deles i organisationen</h1>', { status: 401 }); } });
  const checked = await deployments.check('/projekt');
  assert.equal(checked.checks.site.http, 401);
  assert.match(checked.verification, /kræver login med komplai/);
});

test('komplai Run: en upload ændrer aldrig eksisterende adgang, og en afvigelse stopper før upload', async t => {
  const store = await connectedStore(t);
  for (const outcome of ['afvist', 'ukendt', 'godkendt']) {
    const calls = [], app = { id: appId, visibility: 'private', activeRelease: 'gammel', name: 'Budget', slug: 'budget', url: 'https://budget.komplai.run', releases: [] };
    const provider = new KomplaiDeployment(store, { fetcher: async (url, options) => {
      const route = new URL(url).pathname; calls.push({ route, method: options.method, visibility: app.visibility, release: app.activeRelease });
      if (route.endsWith('/releases')) {
        if (outcome === 'afvist') return Response.json({ error: 'storage_limit' }, { status: 507 });
        if (outcome === 'ukendt') throw Error('Forbindelsen brød sammen.');
        app.activeRelease = 'ny'; return Response.json(app);
      }
      if (options.method === 'PATCH') { app.visibility = JSON.parse(options.body).visibility; return Response.json(app); }
      if (route === '/api/publish/native') return Response.json({ address: 'komplai.run', apps: [app] });
      throw Error('Uventet kald: ' + route);
    } });
    await assert.rejects(provider.inspect({ appId, visibility: 'public' }), /adgang er ændret/);
    await assert.rejects(provider.deploy({ appId, visibility: 'public' }, { files: [] }, { id: appId, currentVisibility: 'private' }), /adgang er ændret/);
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
    const publish = () => provider.deploy({ appId, visibility: 'private' }, { files: [{ file: 'index.html', data: Buffer.from('<h1>Ny version</h1>') }] }, { id: appId, currentVisibility: 'private' });
    if (outcome === 'godkendt') {
      await publish(); assert.equal(app.visibility, 'private'); assert.equal(app.activeRelease, 'ny');
    } else {
      await assert.rejects(publish()); assert.equal(app.visibility, 'private', outcome);
      assert.equal(app.activeRelease, 'gammel'); assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
    }
    assert.equal(calls.filter(call => call.route.endsWith('/releases')).length, 1);
    assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
  }
});

test('komplai Run: bekræftet release bevares, når den efterfølgende oversigt fejler', async t => {
  const store = await connectedStore(t); let fail = false, uploads = 0;
  const app = { id: appId, name: 'Budget', slug: 'budget', url: 'https://budget.komplai.run', visibility: 'private', activeRelease: 'gammel', releases: [] };
  const provider = new KomplaiDeployment(store, { fetcher: async (url, options) => {
    if (url.endsWith('/releases')) { uploads++; fail = true; app.activeRelease = 'bekræftet'; return Response.json(app); }
    if (fail) throw Error('Forbindelsen brød sammen efter upload.');
    return Response.json({ address: 'komplai.run', apps: [app] });
  } });
  const data = Buffer.from('<h1>Budget</h1>');
  const deployments = new Deployments(store, { providers: { komplai: provider }, artifact: async () => ({ head: 'version', hash: 'fingeraftryk', files: [{ file: 'index.html', data }] }), fetcher: async () => new Response('Login', { status: 401 }) });
  const r = await deployments.review('/projekt', { provider: 'komplai', appId, visibility: 'private' });
  const receipt = await deployments.deploy('/projekt', r.token);
  assert.equal(receipt.id, 'bekræftet'); assert.equal(receipt.appId, appId); assert.equal(receipt.state, 'UPLOADED');
  assert.match(receipt.verification, /Filerne er modtaget/); assert.equal((await deployments.state('/projekt')).last.id, 'bekræftet');
  fail = false; const checked = await deployments.check('/projekt'); assert.equal(checked.state, 'READY'); assert.equal(uploads, 1);
});

test('komplai Run: frisk adgang i Hub erstatter godkendelsens gamle adgang i kontrollen', async t => {
  const store = await connectedStore(t), data = Buffer.from('<h1>Budget</h1>');
  const app = { id: appId, name: 'Budget', slug: 'budget', url: 'https://budget.komplai.run', visibility: 'public', activeRelease: 'r1', releases: [] };
  const provider = new KomplaiDeployment(store, { fetcher: async () => Response.json({ address: 'komplai.run', apps: [app] }) });
  await store.saveProject('/projekt', { deploymentLast: { id: 'r1', appId, state: 'READY', config: { provider: 'komplai', appId, visibility: 'private' }, target: {}, indexHash: require('node:crypto').createHash('sha256').update(data).digest('hex') } });
  const deployments = new Deployments(store, { providers: { komplai: provider }, fetcher: async () => new Response(data) });
  const checked = await deployments.check('/projekt');
  assert.equal(checked.checks.provider.visibility, 'public'); assert.equal(checked.config.visibility, 'private');
  const rows = Object.fromEntries(require('../ui/share-view.js').checks(checked));
  assert.match(rows['Aktuel adgang'], /Alle med linket.*afviger/); assert.doesNotMatch(rows['Testerens adgang'], /Kræver login/);
  provider.status = async () => { throw Error('Ny kontrol fejler.'); };
  const failed = await deployments.check('/projekt'); assert.equal(failed.checks.provider.visibility, undefined);
  assert.match(Object.fromEntries(require('../ui/share-view.js').checks(failed))['Aktuel adgang'], /Ikke kontrolleret/);
});

test('Hele pakken: Udgivelse er med, når komplai Run er forbundet', () => {
  const definitions = [{ id: 'versioner' }, { id: 'deling', requires: ['versioner'], default: false }];
  assert.equal(recommended(definitions, {}).find(f => f.id === 'deling').default, false);
  assert.equal(recommended(definitions, { hosting: { komplai: { secret: 'x' } } }).find(f => f.id === 'deling').default, true);
  assert.equal(recommended(definitions, { hosting: { github: { secret: 'x' } } }).find(f => f.id === 'deling').default, false);
});

test('komplai Run: en ny offentlig app oprettes for organisationen og gøres offentlig med bekræftelsen før upload', async t => {
  const store = await connectedStore(t), calls = [];
  let refuse = null;
  const app = { id: appId, name: 'Budget', slug: 'budget', url: 'https://budget.komplai.run', visibility: 'private', releases: [] };
  const fetcher = async (url, options) => {
    const route = url.replace('https://hub.komplai.dk', '');
    calls.push({ route, method: options.method, body: options.headers['Content-Type'] === 'application/json' ? JSON.parse(options.body) : null });
    if (route === '/api/publish/native/apps') return refuse ? Response.json({ error: refuse }, { status: 403 }) : Response.json({ ...app, activeRelease: null });
    if (route === `/api/publish/native/apps/${appId}`) { if (calls.at(-1).body.confirmPublic !== 'Budget') return Response.json({ error: 'public_confirmation' }, { status: 403 }); app.visibility = 'public'; return Response.json(app); }
    if (route === `/api/publish/${appId}/releases`) return Response.json({ ...app, activeRelease: 'r1' });
    if (route === '/api/publish/native') return Response.json({ address: 'komplai.run', slugs: true, apps: [{ ...app, activeRelease: 'r1' }] });
    throw Error('Uventet ' + route);
  };
  const provider = new KomplaiDeployment(store, { fetcher });
  const files = [{ file: 'index.html', data: Buffer.from('<h1>Budget</h1>') }];
  const created = [];
  await provider.deploy({ name: 'Budget', visibility: 'public', confirmPublic: 'Budget' }, { files }, { id: null }, { onCreated: async id => created.push(id) });
  assert.deepEqual(calls.map(c => [c.method, c.route]), [['POST', '/api/publish/native/apps'], ['PATCH', `/api/publish/native/apps/${appId}`], ['POST', `/api/publish/${appId}/releases`], ['GET', '/api/publish/native']]);
  assert.deepEqual(calls[0].body, { name: 'Budget', visibility: 'private' });
  assert.deepEqual(calls[1].body, { visibility: 'public', confirmPublic: 'Budget' });
  assert.deepEqual(created, [appId], 'appen gemmes, før den gøres offentlig');
  // En forkert bekræftelse stopper før upload; appen er oprettet og gemt for organisationen.
  calls.length = 0; app.visibility = 'private';
  await assert.rejects(provider.deploy({ name: 'Budget', visibility: 'public', confirmPublic: 'budget' }, { files }, { id: null }), /Skriv appens navn præcis/);
  assert.equal(calls.some(c => c.route.endsWith('/releases')), false);
  // En privat app ændrer aldrig adgang, og Hubs afvisninger vises på dansk.
  calls.length = 0; refuse = 'invalid_manifest';
  await assert.rejects(provider.deploy({ name: 'Budget', visibility: 'private' }, { files }, { id: null }), /komplai\.json kan ikke bruges/);
  refuse = 'public_on_create';
  await assert.rejects(provider.deploy({ name: 'Budget', visibility: 'private' }, { files }, { id: null }), /opretter nye apps for organisationen/);
  assert.equal(calls.some(c => c.method === 'PATCH'), false);
});
