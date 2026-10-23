// Funktioner, som brugeren selv slår til og fra. Standarden gælder alle projekter, og et projekt kan have undtagelser.
// Hver funktion har sine skills i det fælles bibliotek. Uden et valg gælder appens anbefalede pakke fra kataloget:
// alle funktioner undtagen dem med "default": false. Udgivelse kræver ellers udviklerværktøjer og er
// derfor kun med i pakken, når en komplai Run-adgang er forbundet: så kan Udgiv udgive uden ekstra værktøjer.
const CHOICES = ['alle', 'valgt'];

// En funktion, der bygger på en anden, er kun slået til sammen med den, fx Udgivelse med Versioner og fortryd.
function resolve(definitions, defaults = {}, exceptions = {}) {
  const on = Object.fromEntries(definitions.map(feature => [feature.id, exceptions[feature.id] ?? defaults[feature.id] ?? feature.default !== false]));
  for (const feature of definitions) if ((feature.requires || []).some(id => !on[id])) on[feature.id] = false;
  return on;
}
// Et valg slår det til, funktionen bygger på, og et fravalg slår det fra, der bygger på funktionen.
function couple(definitions, values) {
  const result = { ...values };
  for (const [id, value] of Object.entries(values)) {
    if (value === true) for (const required of definitions.find(feature => feature.id === id).requires || []) result[required] = true;
    if (value === false) for (const feature of definitions) if ((feature.requires || []).includes(id)) result[feature.id] = false;
  }
  return result;
}

function recommended(definitions, state) {
  // Et login til udgivelse hos komplai eller Promte gør Udgiv til en anbefalet funktion.
  const publishing = Boolean(state.hosting?.komplai?.secret) || Object.values(state.hosting?.promte || {}).some(login => login?.secret);
  return publishing ? definitions.map(feature => feature.id === 'deling' ? { ...feature, default: true } : feature) : definitions;
}
class Features {
  constructor(store, library) { this.store = store; this.library = library; }
  async definitions() { return (await this.library()).features; }
  async get(root) {
    const library = await this.library(), state = await this.store.read();
    const definitions = recommended(library.features, state);
    const defaults = state.features?.on || {};
    const saved = root ? state.projects[this.store.projectKey(root)]?.features || {} : {};
    const exceptions = Object.fromEntries(Object.entries(saved).filter(([id, value]) => definitions.some(feature => feature.id === id) && typeof value === 'boolean'));
    const skill = name => { const item = library.skills.find(entry => entry.name === name); return { name, title: item.title, summary: item.summary, ...(item.integration ? { integration: item.integration } : {}) }; };
    return {
      chosen: CHOICES.includes(state.features?.chosen) ? state.features.chosen : '',
      list: definitions.map(({ id, title, summary, requires = [], group = '', skills }) => ({ id, title, summary, requires, group, skills: skills.map(skill) })),
      defaults: resolve(definitions, defaults),
      exceptions,
      effective: resolve(definitions, defaults, exceptions)
    };
  }
  // scope "alle" ændrer standarden for alle projekter. scope "projekt" gemmer undtagelser; null fjerner en undtagelse.
  async save(root, input) {
    const definitions = recommended(await this.definitions(), await this.store.read());
    if (!input || !['alle', 'projekt'].includes(input.scope) || !input.values || typeof input.values !== 'object' || Array.isArray(input.values)) throw new Error('Ugyldigt valg af funktioner.');
    const nullable = input.scope === 'projekt';
    for (const [id, value] of Object.entries(input.values)) {
      if (!definitions.some(feature => feature.id === id)) throw new Error('Ukendt funktion.');
      if (typeof value !== 'boolean' && !(nullable && value === null)) throw new Error('Ugyldigt valg af funktioner.');
    }
    if (input.chosen !== undefined && (input.scope !== 'alle' || !CHOICES.includes(input.chosen))) throw new Error('Ugyldigt valg af funktioner.');
    if (input.scope === 'projekt' && !root) throw new Error('Åbn et projekt først.');
    const values = couple(definitions, Object.fromEntries(Object.entries(input.values).filter(([, value]) => value !== null)));
    if (input.scope === 'alle') {
      await this.store.update(state => {
        // Hele pakken følger appens anbefaling i kataloget, også når den ændres i en senere version.
        const base = input.chosen === 'alle' ? {} : resolve(definitions, state.features?.on), chosen = input.chosen || state.features?.chosen;
        state.features = { ...(chosen ? { chosen } : {}), on: { ...base, ...values } };
      });
    } else {
      // En undtagelse gemmes kun, når den afviger fra standarden, så markeringen i panelet betyder noget.
      const current = await this.get(root);
      const next = { ...current.exceptions, ...values };
      for (const [id, value] of Object.entries(input.values)) if (value === null) delete next[id];
      for (const [id, value] of Object.entries(next)) if (value === current.defaults[id]) delete next[id];
      await this.store.saveProject(root, { features: next });
    }
    return this.get(root);
  }
}
module.exports = { Features, resolve, couple, recommended };
