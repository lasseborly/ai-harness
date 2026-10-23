const fs = require('node:fs/promises');
const path = require('node:path');
const { Store } = require('./store.cjs');
const { WorkspaceHistory } = require('./workspace-history.cjs');
const { Workbench } = require('./workbench.cjs');
const { loadLibrary } = require('./library.cjs');

// Et projektskift ændrer kun, hvad der vises. Samtaler, motorer og deres ejere bliver i projektets arbejdsbænk.
class WorkspaceRegistry {
  constructor(options) {
    this.options = options; this.store = options.store || new Store(options.directory, options.safeStorage);
    this.history = new WorkspaceHistory(this.store); this.benches = new Map(); this.aliases = new Map(); this.opening = new Map(); this.selection = 0; this.connectionRemovals = new Set();
    let library = null;
    this.library = options.library || (() => library ??= loadLibrary(options.profiles).catch(error => { library = null; throw error; }));
    this.empty = this.create(); this._selected = this.empty;
  }
  create() {
    const bench = new Workbench({ ...this.options, store: this.store, history: this.history, library: this.library, registry: this });
    this.options.configure?.(bench); return bench;
  }
  get selected() { return this._selected; }
  deselect() { ++this.selection; this._selected = this.empty; return this.empty; }
  async select(project) {
    const selection = ++this.selection;
    if (!project || typeof project.root !== 'string') throw new Error('Vælg et projekt først.');
    const alias = path.resolve(project.root), root = await fs.realpath(alias);
    this.aliases.set(alias, root); this.aliases.set(root, root);
    let bench = this.benches.get(root), ready = this.opening.get(root);
    if (!bench) {
      bench = this.create(); this.benches.set(root, bench);
      ready = bench.activate({ ...project, root }); this.opening.set(root, ready);
      ready.finally(() => { if (this.opening.get(root) === ready) this.opening.delete(root); }).catch(() => {});
    }
    await ready;
    bench.project = { ...bench.project, ...project, root };
    if (selection === this.selection) this._selected = bench;
    return bench;
  }
  get(root) { if (typeof root !== 'string') return null; const resolved = path.resolve(root); return this.benches.get(this.aliases.get(resolved) || resolved) || null; }
  values() { return this.benches.values(); }
  allChats() { return [...this.values()].flatMap(bench => [...bench.chats.values()]); }
  servers() { return [...this.values()].flatMap(bench => bench.servers()); }
  get running() { return [...this.values()].some(bench => bench.running); }
  invalidateConnection(id) { return Promise.all([this.empty, ...this.values()].map(bench => bench.connectionChanged(id))); }
  async close() { ++this.selection; await Promise.all([...this.opening.values()]); await Promise.all([this.empty, ...this.values()].map(bench => bench.close())); await this.store.queue; }
}
module.exports = { WorkspaceRegistry };
