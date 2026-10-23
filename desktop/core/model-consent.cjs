const { createHash } = require('node:crypto');

// Samtykket følger modtageren og vilkårene i det enkelte projekt. Arbejdsmåde,
// projektets egne filhenvisninger og løbende samtalehistorik er ikke nye modtagere.
// Motorens fingerprint skal stadig omfatte instruktioner og arbejdsmåde.
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
function keyFor(connection, disclosure) {
  const recipient = { version: 2, connection };
  for (const key of ['endpoint', 'model', 'route', 'recipients', 'region', 'retention', 'training', 'price', 'security']) recipient[key] = disclosure[key];
  recipient.references = [...new Set(disclosure.references || [])].sort();
  return createHash('sha256').update(JSON.stringify(ordered(recipient))).digest('hex');
}
function legacyKey(connection, disclosure, projectRules) {
  const { endpoint, model, route, recipients, region, retention, training, price, security, references = [], historyIncluded, fileReferences = [], previewReference } = disclosure;
  const recipient = { projectRules: projectRules || null, connection, endpoint, model, route, recipients, region, retention, training, price, security, references, historyIncluded, ...(fileReferences.length ? { fileReferences } : {}), ...(previewReference ? { previewReference } : {}) };
  return createHash('sha256').update(JSON.stringify(recipient)).digest('hex');
}
function review(connection, disclosure, settings, projectRules) {
  const consentKey = keyFor(connection, disclosure);
  const accepted = settings.consents || [];
  return { consentKey, accepted: accepted.includes(consentKey) || accepted.includes(legacyKey(connection, disclosure, projectRules)) };
}
// Flere samtaler kan godkende forskellige modeller samtidigt. Saml nøglerne inde
// i lagerets skrivekø, så en anden samtales godkendelse aldrig overskrives.
async function remember(store, root, consentKey) {
  return store.update(state => {
    const id = store.projectKey(root), project = state.projects[id] ||= {};
    project.consents = [consentKey, ...(project.consents || []).filter(key => key !== consentKey)].slice(0, 50);
  });
}
module.exports = { keyFor, review, remember };
