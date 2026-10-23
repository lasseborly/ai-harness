const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs/promises');
const path = require('node:path');

async function bridge(name, api) {
  const listeners = new Map(), calls = [], answers = [], old = { postMessage: message => answers.push(['old', message]) }, source = { postMessage: message => answers.push(['active', message]) };
  const active = { contentWindow: source, src: 'aura-preview://project-a/' }, status = {};
  const context = { current: { root: '/a' }, view: { id: 'chat-a' }, document: { querySelector: selector => selector === '#preview' ? active : status }, window: { addEventListener: (name, callback) => listeners.set(name, callback), harness: api(calls) }, setTimeout, matchMedia: () => ({ matches: false }), Blob, ArrayBuffer };
  context.selectedOwner = () => ({ root: context.current.root, chat: context.view.id });
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../ui', name), 'utf8'), context);
  return { listeners, context, calls, answers, old, source, active };
}

test('gammel Promte-frame kan ikke bruge det valgte projekts proxy; afventende kald beholder sin ejer', async () => {
  let resolveBody; const body = new Blob(['test']); body.arrayBuffer = () => new Promise(resolve => { resolveBody = resolve; });
  const b = await bridge('promte-preview.js', calls => ({ promtePreviewFetch: async (input, owner) => { calls.push({ input, owner }); return { ok: true, value: { status: 200, body: 'privat A' } }; } }));
  const payload = { type: 'promte-fetch-request', id: 'request-1', path: 'app-api/data', method: 'POST', body };
  b.listeners.get('message')({ source: b.old, data: payload }); assert.equal(b.calls.length, 0); assert.equal(resolveBody, undefined);
  b.listeners.get('message')({ source: b.source, data: payload });
  b.context.current.root = '/b'; b.context.view.id = 'chat-b'; resolveBody(new ArrayBuffer(0));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.calls.length, 1); assert.equal(b.calls[0].owner.root, '/a'); assert.equal(b.calls[0].owner.chat, 'chat-a'); assert.equal(b.answers.length, 0);
});

test('gammel Komplai-frame afvises og svaret fra A vises aldrig efter skift til B', async () => {
  let resolveCall;
  const b = await bridge('komplai-preview.js', calls => ({ komplaiPreviewCall: (input, owner) => { calls.push({ input, owner }); return new Promise(resolve => { resolveCall = resolve; }); } }));
  const payload = { komplaiPreview: 1, kind: 'call', id: 1, path: '/_komplai/api/v1/identity/me', method: 'GET' };
  await b.listeners.get('message')({ source: b.old, data: payload }); assert.equal(b.calls.length, 0);
  const pending = b.listeners.get('message')({ source: b.source, data: payload });
  b.context.current.root = '/b'; b.context.view.id = 'chat-b'; resolveCall({ ok: true, value: { status: 200, body: { name: 'Privat A' } } }); await pending;
  assert.equal(b.calls[0].owner.root, '/a'); assert.equal(b.answers.length, 0);
});
