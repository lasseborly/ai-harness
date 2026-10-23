const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { keyFor, review, remember } = require('../core/model-consent.cjs');
const { Store } = require('../core/store.cjs');
const original = () => ({ endpoint: 'https://ai.example/v1', model: 'model-a', route: 'direct', recipients: ['Udbyder A'], region: 'EU', retention: 'Ingen lagring', training: 'Nej', price: { input: 1, output: 2 }, security: 'TLS', references: [], mode: 'chat', historyIncluded: false });

test('samme godkendelse gælder samtale, plan, byg og projektets egne henvisninger', () => {
  const disclosure = original(), consentKey = keyFor('connection-a', disclosure), settings = { consents: [consentKey] };
  for (const mode of ['chat', 'plan', 'build', 'free']) {
    const next = { ...disclosure, mode, historyIncluded: true, conversation: 'Byg planen', effort: 'high', fileReferences: ['src/App.jsx:12'], previewReference: 'Overskrift', planID: 'new-plan' };
    assert.deepEqual(review('connection-a', next, settings, 'changed-instructions'), { consentKey, accepted: true });
  }
});
test('ændret model, modtager, vilkår eller privat reference kræver ny godkendelse', () => {
  const disclosure = original(), settings = { consents: [keyFor('connection-a', disclosure)] };
  for (const [key, value] of Object.entries({ endpoint: 'https://other.example/v1', model: 'model-b', route: 'other', recipients: ['Udbyder B'], region: 'US', retention: '30 dage', training: 'Ja', price: { input: 2, output: 4 }, security: 'HTTP', references: ['references/private.pdf'] })) {
    assert.equal(review('connection-a', { ...disclosure, [key]: value }, settings).accepted, false, key);
  }
  assert.equal(review('connection-b', disclosure, settings).accepted, false);
});
test('rækkefølge i metadata og referencevalg giver ikke ekstra spørgsmål', () => {
  assert.equal(keyFor('a', { ...original(), references: ['b', 'a'] }), keyFor('a', { ...original(), price: { output: 2, input: 1 }, references: ['a', 'b'] }));
});
test('samtidige godkendelser gemmes og tilhører kun deres projekt', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-consent-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Store(directory, {});
  await Promise.all([remember(store, '/project-a', 'model-a'), remember(store, '/project-a', 'model-b'), remember(store, '/project-b', 'model-c')]);
  assert.deepEqual(new Set((await store.project('/project-a')).consents), new Set(['model-a', 'model-b']));
  assert.deepEqual((await store.project('/project-b')).consents, ['model-c']);
});
