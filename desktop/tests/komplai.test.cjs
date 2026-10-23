const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { KomplaiLogin, organisation: organisationOf, publishingState, disconnectPublishing } = require('../core/komplai.cjs');
const { Store } = require('../core/store.cjs');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('krypteret:' + Buffer.from(value).toString('base64')), decryptString: buffer => Buffer.from(buffer.toString().slice(10), 'base64').toString() };

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-komplai-run-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, store: new Store(directory, safeStorage) };
}

test('Komplai Run: PKCE og forkert state; kun organisationer med Run og ingen AI-vilkår', async t => {
  const { directory, store } = await fixture(t);
  let authURL; const requests = [];
  const organisation = { id: 'organisation-1', name: 'Prøvekommune', coding: { contract: 'må-ikke-vises', balance: { availableMicros: 123 } }, publishing: { address: 'komplai.run', tier: 'shared_free' } };
  const grant = 'komp_publish_grant_' + 'a'.repeat(64);
  const login = new KomplaiLogin({ fetcher: async (url, options) => {
    requests.push(url);
    if (url.endsWith('/config')) return Response.json({ issuer: 'https://auth.komplai.dk', clientId: 'test-client', scopes: ['openid'], authorizationEndpoint: 'https://auth.komplai.dk/oauth/v2/authorize', tokenEndpoint: 'https://auth.komplai.dk/oauth/v2/token' });
    if (url.endsWith('/token')) { const values = options.body; assert.equal(values.get('client_secret'), null); assert.equal(createHash('sha256').update(values.get('code_verifier')).digest('base64url'), authURL.searchParams.get('code_challenge')); return Response.json({ access_token: 'hemmeligt-login', token_type: 'Bearer' }); }
    if (url.endsWith('/organisations?include=publishing')) { assert.equal(options.headers.Authorization, 'Bearer hemmeligt-login'); return Response.json({ organisations: [organisation, { id: 'kun-ai', name: 'Kun AI', coding: { contract: '1' }, publishing: null }, { id: 'gammelt-api', name: 'Ældre AI-svar', contract: '1' }] }); }
    assert.equal(url.endsWith('/publishing/connect'), true);
    assert.deepEqual(JSON.parse(options.body), { organisationId: organisation.id, acceptPublishing: true });
    return Response.json({ id: 'grant-id', secret: grant, expiresAt: new Date(Date.now() + 60000).toISOString(), address: 'komplai.run' });
  } });
  t.after(() => login.cancel());
  const result = await login.start(async address => {
    authURL = new URL(address); const callback = new URL(authURL.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', 'forkert'); callback.searchParams.set('code', 'testcode');
    const refused = await fetch(callback);
    assert.equal(refused.status, 400); assert.match(await refused.text(), /<h1>Login kunne ikke bekræftes<\/h1>/);
    callback.searchParams.set('state', authURL.searchParams.get('state'));
    const page = await fetch(callback), html = await page.text();
    assert.equal(page.status, 200);
    // Callback-siden har Auras udseende uden scripts eller eksterne filer; stilen er kun tilladt med sin hash.
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(html, /<h1>Du er logget ind<\/h1>/); assert.doesNotMatch(html, /<script|src=|href=|testcode/);
    const style = /<style>(.*?)<\/style>/s.exec(html)[1];
    assert.equal(page.headers.get('content-security-policy'), `default-src 'none'; style-src 'sha256-${require('node:crypto').createHash('sha256').update(style).digest('base64')}'; frame-ancestors 'none'`);
  });
  assert.deepEqual(result, { organisations: [{ id: organisation.id, name: organisation.name, publishing: organisation.publishing }] });
  await assert.rejects(login.connectPublishing('kun-ai', store), /vælg din organisation/);
  await assert.rejects(login.connectPublishing('anden-organisation', store), /vælg din organisation/);
  assert.equal(typeof login.connect, 'undefined', 'Det gamle AI-login må ikke kunne kaldes.');
  const publicData = await login.connectPublishing(organisation.id, store);
  assert.equal(publicData.organisationId, organisation.id); assert.equal(publicData.connected, true);
  const raw = await fs.readFile(path.join(directory, 'settings.json'), 'utf8');
  assert.equal(raw.includes(grant), false); assert.equal(raw.includes('hemmeligt-login'), false);
  assert.equal(store.decrypt((await store.read()).hosting.komplai), grant);
  assert.equal((await store.read()).connections.length, 0);
  assert.equal(requests.some(url => /\/aura\/(?:connect|account|v1\/models)$/.test(url)), false);
});

test('Komplai Run: manglende opsætning, forkert loginserver og afbrydelse giver ingen adgang', async () => {
  const login = new KomplaiLogin({ fetcher: async () => Response.json({ error: 'aura_not_configured' }, { status: 503 }) });
  await assert.rejects(login.start(() => assert.fail('Browseren må ikke åbnes')), /ikke åbnet/);
  assert.equal(login.pending, null);
  login.fetcher = async () => Response.json({ issuer: 'https://angriber.invalid', clientId: 'c', scopes: ['openid'] });
  await assert.rejects(login.start(() => assert.fail('Browseren må ikke åbnes')), /ikke bekræftes/);
  login.fetcher = async () => Response.json({ issuer: 'https://auth.komplai.dk', clientId: 'c', scopes: ['openid'], authorizationEndpoint: 'https://auth.komplai.dk/oauth/v2/authorize', tokenEndpoint: 'https://auth.komplai.dk/oauth/v2/token' });
  await assert.rejects(login.start(async () => login.cancel()), /afbrudt/);
  assert.equal(login.pending, null);
});

test('Komplai Run: udgivelsesadgang gemmes krypteret, erstattes og tilbagekaldes uden AI-forbindelse', async t => {
  const { directory, store } = await fixture(t);
  const grant = n => 'komp_publish_grant_' + String(n).repeat(64);
  const both = { id: 'org-begge', name: 'Prøvekommune', coding: { contract: 'v1', balance: { availableMicros: 2000000 }, data: {} }, publishing: { address: 'komplai.run', tier: 'shared_free' } };
  const publishOnly = { id: 'org-publish', name: 'Kun Run', coding: null, publishing: { address: 'kun.komplai.run', tier: 'dedicated' } };
  assert.deepEqual(organisationOf(publishOnly), { id: publishOnly.id, name: publishOnly.name, publishing: publishOnly.publishing });
  assert.equal(organisationOf({ ...publishOnly, publishing: { address: 'ugyldig adresse!' } }).publishing, null);
  assert.deepEqual(organisationOf(both), { id: both.id, name: both.name, publishing: both.publishing });
  const calls = []; let issued = 0;
  const login = new KomplaiLogin({ fetcher: async (url, options) => {
    calls.push({ url, method: options.method, auth: options.headers.Authorization, body: options.body && JSON.parse(options.body) });
    if (url.endsWith('/publishing/connect')) { issued++; return Response.json({ id: 'grant-' + issued, secret: grant(issued), expiresAt: new Date(Date.now() + 86400000).toISOString(), address: JSON.parse(options.body).organisationId === both.id ? both.publishing.address : publishOnly.publishing.address }); }
    if (url.endsWith('/publishing/session')) return Response.json({ revoked: true });
    throw Error('Uventet adresse ' + url);
  } });
  t.after(() => login.cancel());
  login.pending = { token: 'hemmeligt-login', controller: new AbortController(), organisations: [both, publishOnly].map(organisationOf) };
  const state = await login.connectPublishing(both.id, store);
  assert.deepEqual({ ...state, expiresAt: undefined }, { connected: true, organisationId: both.id, organisationName: both.name, address: 'komplai.run', expiresAt: undefined, expired: false });
  assert.deepEqual(calls.at(-1).body, { organisationId: both.id, acceptPublishing: true });
  assert.equal(calls.at(-1).auth, 'Bearer hemmeligt-login');
  const raw = await fs.readFile(path.join(directory, 'settings.json'), 'utf8');
  assert.equal(raw.includes(grant(1)), false, 'Udgivelsesadgangen gemmes krypteret');
  assert.equal(store.decrypt((await store.read()).hosting.komplai), grant(1));
  assert.equal((await store.read()).connections.length, 0);
  login.pending = { token: 'hemmeligt-login', controller: new AbortController(), organisations: [both, publishOnly].map(organisationOf) };
  await login.connectPublishing(publishOnly.id, store);
  assert.deepEqual(calls.filter(c => c.url.endsWith('/publishing/session')).map(c => c.auth), ['Bearer ' + grant(1)]);
  assert.equal((await publishingState(store)).address, 'kun.komplai.run');
  login.cancel();
  await assert.rejects(disconnectPublishing(store, undefined, async () => { throw Error('offline'); }), /kunne ikke kontaktes/);
  assert.equal((await publishingState(store)).connected, true, 'Fejlet tilbagekaldelse skal kunne prøves igen.');
  const revoked = [];
  assert.deepEqual(await disconnectPublishing(store, undefined, async (url, options) => { revoked.push(options.headers.Authorization); return Response.json({ revoked: true }); }), { connected: false });
  assert.deepEqual(revoked, ['Bearer ' + grant(2)]);
  assert.equal((await store.read()).connections.length, 0);
});

test('Komplai: loginrespons har en øvre grænse og tilbagekaldelse skjuler ikke netværksfejl', async () => {
  const { readBounded, disconnect } = require('../core/komplai.cjs');
  await assert.rejects(readBounded(new Response('x'.repeat(64001)), 64000), /for stort/);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('hemmelig intern fejl'); };
    await assert.rejects(disconnect({ baseURL: 'https://api.komplai.dk/v1/aura/v1' }, 'syntetisk'), /komplai kunne ikke kontaktes/);
  } finally { globalThis.fetch = original; }
});
