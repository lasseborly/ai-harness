const fs = require('node:fs/promises');
const path = require('node:path');
const dns = require('node:dns/promises');
const { createHash } = require('node:crypto');
const { PromteSetup, promteHost, addressFor } = require('./provider-promte.cjs');

// En Promte-app venter på, at siden omkring den svarer på dens init. Inde i Promte gør Promte det.
// I Auras forhåndsvisning svarer Aura, når Promte-integrationen er slået til: projektet kobles til en Promte-app,
// som brugeren opretter med ét klik første gang, og appens kald sendes videre til Promte med et app-token,
// der bliver i hovedprocessen.
// Promtes eget forslag til hackathonens installation (PR 12); Udgiv bruger samme adresse som udgangspunkt.
const PREVIEW_HOST = 'https://kodning.promte.dk';
const TOKEN_LIFETIME = 10 * 60 * 1000;
const MAX_BODY = 20 * 1024 * 1024;
const ALLOWED_PATH = /^(?:app-api\/[A-Za-z0-9/_.-]*|openai\/chat\/completions)(?:\?[^#\s]*)?$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const REQUEST_HEADERS = new Set(['content-type', 'accept']);
const RESPONSE_HEADERS = new Set(['content-type', 'x-promte-governance-warning']);

async function isPromteProject(root) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    return ['dependencies', 'devDependencies', 'peerDependencies'].some(field => pkg?.[field] && Object.hasOwn(pkg[field], '@promte/app-library'));
  } catch { return false; }
}
// Projektmappens navn bliver appens navn i Promte, fx "moedereferat" → "Moedereferat".
function appName(root) {
  const base = path.basename(root).replace(/[-_]+/g, ' ').replace(/[\x00-\x1f]/g, '').trim().slice(0, 100) || 'Ny app';
  return base.charAt(0).toUpperCase() + base.slice(1);
}
function body(input) {
  if (input == null) return undefined;
  if (typeof input === 'string') return input;
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) return Buffer.from(input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  if (Array.isArray(input?.form)) {
    const form = new FormData();
    for (const [name, value] of input.form) {
      if (typeof name !== 'string') throw Error('Ugyldig formular fra appen.');
      if (typeof value === 'string') form.append(name, value);
      else if (value && (value.data instanceof ArrayBuffer || ArrayBuffer.isView(value.data))) form.append(name, new Blob([value.data], { type: typeof value.type === 'string' ? value.type : '' }), typeof value.name === 'string' ? value.name : 'fil');
      else throw Error('Ugyldig formular fra appen.');
    }
    return form;
  }
  throw Error('Appen sendte et kald, Aura ikke kan videresende.');
}

class PromtePreview {
  constructor(store, { setup, enabled = async () => true, fetcher = (...args) => fetch(...args), lookup = dns.lookup, now = Date.now } = {}) {
    this.store = store; this.setup = setup || new PromteSetup(store); this.enabled = enabled; this.fetcher = fetcher; this.lookup = lookup; this.now = now; this.tokens = new Map();
  }
  async link(root) { return (await this.store.project(root)).promteApp || null; }
  // Uden koblet app bruges den Promte, brugeren er logget ind på i Aura, ellers Promtes standardadresse.
  async host(link) {
    if (link?.host) return promteHost(link.host);
    const logins = Object.entries((await this.store.read?.())?.hosting?.promte || {}).filter(([, login]) => Date.parse(login?.expiresAt) > this.now());
    logins.sort((a, b) => Date.parse(b[1].expiresAt) - Date.parse(a[1].expiresAt));
    return promteHost(logins[0]?.[0] || PREVIEW_HOST);
  }
  /** Svar på appens init. En ny Promte-app oprettes kun, når brugeren har valgt det (create). */
  async connect(root, { create = false, workspaceRoot = root } = {}) {
    if (!await isPromteProject(workspaceRoot) || !await this.enabled(root)) return { active: false };
    let link = await this.link(root);
    const host = await this.host(link);
    const state = await this.setup.state({ host });
    // Oprettelse kræver Auras eget login. En koblet app kan også bruge et login fra Promtes CLI.
    if (!state.connected || (!link && state.loginSource !== 'aura')) return { active: true, connected: false, host };
    if (!link && !create) return { active: true, connected: true, linked: false, host, name: appName(root) };
    let created = false;
    if (!link) {
      const app = await this.setup.createWorkspace({ host, name: appName(root) });
      link = { host, workspaceId: app.id, name: app.name };
      await this.store.saveProject(root, { promteApp: link });
      created = true;
    }
    return { active: true, connected: true, created, host, workspaceId: link.workspaceId, name: link.name, settings: { workspaceId: link.workspaceId, version: 0, backendUrl: host + '/api', fetchProxy: true, user: { email: state.email } } };
  }
  async login(root, workspaceRoot = root) {
    const host = await this.host(await this.link(root));
    await this.setup.login({ host, owner: root });
    return this.connect(root, { workspaceRoot });
  }
  async create(root, workspaceRoot = root) { return this.connect(root, { create: true, workspaceRoot }); }
  clearTokens(host) { for (const key of this.tokens.keys()) if (key.startsWith(host + '|')) this.tokens.delete(key); }
  async credential(host, expected) {
    const token = await this.setup.client.token(host);
    if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) {
      this.clearTokens(host);
      throw Error('Log ind med Promte igen for at bruge forhåndsvisningen.');
    }
    const identity = createHash('sha256').update(token).digest('hex');
    if (expected && identity !== expected) {
      this.clearTokens(host);
      throw Error('Promte-kontoen er ændret. Genindlæs forhåndsvisningen.');
    }
    return { token, identity };
  }
  async appToken(link, fresh = false, expected) {
    const credential = await this.credential(link.host, expected);
    const key = link.host + '|' + link.workspaceId, cached = this.tokens.get(key);
    if (!fresh && cached?.identity === credential.identity && this.now() - cached.at < TOKEN_LIFETIME) return cached.token;
    this.tokens.delete(key);
    const value = await this.setup.client.call(link.host, '/api/functions/generateToken', { token: credential.token, body: { workspaceId: link.workspaceId, isPublic: false, version: 0, codingPreview: false } });
    // Et sent svar fra den tidligere konto må hverken gemmes eller bruges efter kontoskift/logud.
    await this.credential(link.host, credential.identity);
    if (typeof value.token !== 'string' || !value.token || /[\r\n]/.test(value.token)) throw Error('Promte gav ikke adgang til appen. Kontrollér, at du har adgang til arbejdsområdet.');
    this.tokens.set(key, { token: value.token, identity: credential.identity, at: this.now() });
    return value.token;
  }
  /** Sender ét kald fra appen videre til Promte. Kun appens egne API-stier og kun til den koblede Promte. */
  async fetch(root, request) {
    if (!await this.enabled(root)) throw Error('Promte-integrationen er slået fra.');
    const link = await this.link(root);
    if (!link) throw Error('Projektet er ikke koblet til en Promte-app endnu.');
    const host = promteHost(link.host);
    const route = typeof request?.path === 'string' ? request.path.replace(/^\/+/, '') : '';
    if (!ALLOWED_PATH.test(route) || route.split(/[?/]/).includes('..')) throw Error('Appen må kun kalde Promtes app-API.');
    const method = String(request.method || 'GET').toUpperCase();
    if (!METHODS.has(method)) throw Error('Ugyldig metode fra appen.');
    const headers = {};
    for (const entry of Array.isArray(request.headers) ? request.headers : []) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && REQUEST_HEADERS.has(entry[0].toLowerCase()) && !/[\r\n]/.test(entry[1])) headers[entry[0].toLowerCase()] = entry[1];
    }
    const payload = ['GET', 'DELETE'].includes(method) && request.body == null ? undefined : body(request.body);
    if (payload instanceof FormData) delete headers['content-type'];
    const { identity } = await this.credential(host);
    await addressFor(host, this.lookup);
    const send = async token => {
      await this.credential(host, identity);
      return this.fetcher(`${host}/api/${route}`, { method, headers: { ...headers, Authorization: `Bearer ${token}` }, body: payload, redirect: 'error', signal: AbortSignal.timeout(120000) });
    };
    let response = await send(await this.appToken({ ...link, host }, false, identity));
    if (response.status === 401) response = await send(await this.appToken({ ...link, host }, true, identity));
    const data = await response.arrayBuffer();
    await this.credential(host, identity);
    if (data.byteLength > MAX_BODY) throw Error('Svaret fra Promte er for stort til forhåndsvisningen.');
    const responseHeaders = [];
    response.headers.forEach((value, name) => { if (RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.push([name, value]); });
    return { status: response.status, statusText: response.statusText || '', headers: responseHeaders, body: data };
  }
  /** Udgiv og forhåndsvisning bruger samme app. */
  async setLink(root, { host, workspaceId, name }) {
    if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(workspaceId)) throw Error('Ugyldig Promte-app.');
    const link = { host: promteHost(host), workspaceId, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : workspaceId };
    await this.store.saveProject(root, { promteApp: link });
    return link;
  }
}
module.exports = { PromtePreview, isPromteProject, appName, PREVIEW_HOST, ALLOWED_PATH };
