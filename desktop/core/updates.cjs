// Opdateringer bruger en særskilt netforbindelse. Projektfiler og AI-nøgler sendes ikke med.
const semver = require('semver');
const FEED = 'https://ai-alliancen-org.github.io/ai-harness/updates/';
const RELEASES = 'https://github.com/ai-alliancen-org/ai-harness/releases/';
const interval = 6 * 60 * 60 * 1000;
function channelFor(version) { return semver.prerelease(version)?.[0] === 'beta' ? 'beta' : 'latest'; }
function validateInfo(info, { version, platform, arch }) {
  if (!semver.valid(info?.version) || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(info.version) || !semver.gt(info.version, version)) throw new Error('Udgivelsens version er ugyldig.');
  if (channelFor(version) === 'latest' && semver.prerelease(info.version)) throw new Error('En stabil version må ikke hente en beta.');
  const ext = platform === 'darwin' ? 'zip' : platform === 'linux' ? 'AppImage' : 'exe';
  const name = `Aura-${info.version}-${platform === 'darwin' ? 'mac' : platform === 'linux' ? 'linux' : 'win'}-${arch}.${ext}`;
  const expected = `${RELEASES}download/v${info.version}/${name}`;
  if (info.files?.length !== 1 || info.files[0].url !== expected || !/^[A-Za-z0-9+/]{86}==$/.test(info.files[0].sha512 || '') || !Number.isSafeInteger(info.files[0].size) || info.files[0].size <= 0 || info.packages || info.path && info.path !== expected) throw new Error('Opdateringsfilen matcher ikke Auras udgivelse.');
  if (info.critical !== undefined && typeof info.critical !== 'boolean') throw new Error('Ugyldig sikkerhedsmeddelelse.');
  if (info.critical && (typeof info.message !== 'string' || !info.message.trim() || info.message.length > 500)) throw new Error('Sikkerhedsopdateringen mangler en kort forklaring.');
  return { version: info.version, bytes: info.files[0].size, critical: info.critical === true, message: info.critical ? info.message.trim() : '' };
}
class Updates {
  constructor({ updater, store, version, platform = process.platform, arch = process.arch, enabled = true, emit = () => {}, busy = () => false, prepare = async () => {}, install = () => updater.quitAndInstall(false, true) }) {
    Object.assign(this, { updater, store, version, platform, arch, emit, busy, prepare, install });
    this.enabled = Boolean(enabled && updater && (['darwin', 'win32'].includes(platform) && ['arm64', 'x64'].includes(arch) || (platform === 'linux' && arch === 'x64')));
    this.state = { phase: this.enabled ? 'idle' : 'unavailable', current: version, channel: channelFor(version), automatic: true, available: null, warning: null, checkedAt: null, error: '', percent: 0 };
    if (!this.enabled) return;
    this.connect(updater);
  }
  connect(updater) {
    this.updater = updater;
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = this.state.channel === 'beta'; updater.channel = this.state.channel; updater.allowDowngrade = false;
    updater.disableDifferentialDownload = true; updater.disableWebInstaller = true; updater.logger = null;
    updater.setFeedURL({ provider: 'generic', url: `${FEED}${this.state.channel}/${this.platform}-${this.arch}/`, channel: this.state.channel, useMultipleRangeRequest: false });
    updater.on('download-progress', progress => {
      if (this.state.phase === 'downloading') this.set({ percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))), transferred: progress.transferred, bytes: progress.total });
    });
    // Fejl kommer både som hændelse og som afvist promise. Ingen tekniske URL'er eller lokale stier vises i UI.
    updater.on('error', () => { if (this.state.phase === 'installing') this.fail('Installationen kunne ikke starte. Prøv igen, eller hent installationsfilen fra downloadsiden.'); });
  }
  snapshot() { return structuredClone(this.state); }
  set(change) { Object.assign(this.state, change); this.emit({ type: 'updates.state', value: this.snapshot() }); return this.snapshot(); }
  async start() {
    const saved = (await this.store.read()).updates || {};
    const warning = saved.warning && semver.valid(saved.warning.version) && semver.gt(saved.warning.version, this.version) && typeof saved.warning.message === 'string' ? saved.warning : null;
    this.set({ automatic: saved.automatic !== false, warning });
    if (this.enabled && this.state.automatic) this.schedule();
    return this.snapshot();
  }
  schedule() {
    clearTimeout(this.startTimer); clearInterval(this.timer);
    this.startTimer = setTimeout(() => this.check().catch(() => {}), 15000); this.startTimer.unref?.();
    this.timer = setInterval(() => this.check().catch(() => {}), interval); this.timer.unref?.();
  }
  async automatic(value) {
    if (typeof value !== 'boolean') throw new Error('Vælg automatisk eller manuel kontrol.');
    await this.store.update(s => { s.updates = { ...s.updates, automatic: value }; });
    this.set({ automatic: value }); this.close();
    if (value && this.enabled) this.schedule();
    return this.snapshot();
  }
  fail(message) { return this.set({ phase: 'error', error: message }); }
  async check() {
    if (!this.enabled || ['checking', 'downloading', 'ready', 'installing'].includes(this.state.phase)) return this.snapshot();
    this.set({ phase: 'checking', error: '' });
    try {
      const result = await this.updater.checkForUpdates();
      if (!result) throw new Error('Intet svar');
      const info = result.updateInfo;
      if (semver.valid(info?.version) && semver.lte(info.version, this.version)) return this.set({ phase: 'current', available: null, checkedAt: new Date().toISOString() });
      const available = validateInfo(info, this);
      if (result.isUpdateAvailable === false) return this.fail('Denne opdatering kan ikke installeres på dit styresystem. Se udgivelsesnoterne på downloadsiden.');
      if (available.critical) {
        const warning = { version: available.version, message: available.message };
        await this.store.update(s => { s.updates = { ...s.updates, warning }; }); this.set({ warning });
      }
      this.info = structuredClone(info);
      return this.set({ phase: 'available', available, checkedAt: new Date().toISOString() });
    } catch { this.info = null; return this.fail('Opdateringer kunne ikke kontrolleres. Tjek forbindelsen, og prøv igen.'); }
  }
  async download() {
    if (!this.enabled || !this.state.available || !['available', 'error'].includes(this.state.phase)) throw new Error('Kontrollér først, om der er en opdatering.');
    // Hent kun det svar, som denne instans har gennemgået; en ny kontrol kan ikke løbe samtidig.
    validateInfo(this.info, this);
    this.set({ phase: 'downloading', error: '', percent: 0 });
    try { await this.updater.downloadUpdate(); return this.set({ phase: 'ready', percent: 100 }); }
    catch { return this.fail('Opdateringen kunne ikke hentes eller godkendes. Prøv igen. Den installerede version er bevaret.'); }
  }
  async restart() {
    if (this.state.phase !== 'ready') throw new Error('Hent først opdateringen.');
    if (this.busy()) throw new Error('Vent, til de igangværende opgaver er afsluttet, før du genstarter.');
    this.set({ phase: 'installing', error: '' });
    try { await this.prepare(); this.install(); }
    catch { this.set({ phase: 'ready', error: 'Aura kunne ikke gøre klar til genstart. Dit arbejde er stadig åbent.' }); }
    return this.snapshot();
  }
  close() { clearTimeout(this.startTimer); clearInterval(this.timer); }
}
module.exports = { Updates, validateInfo, channelFor, FEED, RELEASES };
