const { app, BrowserWindow, ipcMain, dialog, protocol, session, safeStorage, Menu, shell, webFrameMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { createProject, openProject } = require('./core/projects.cjs');
const { startPreview } = require('./core/preview.cjs');
const { DevServer, inspect: inspectRuntime } = require('./core/dev-server.cjs');
const { Workbench } = require('./core/workbench.cjs');
const { GitHub } = require('./core/github.cjs');
const { Deployments } = require('./core/deployments.cjs');
const { Publishing } = require('./core/publishing.cjs');
const { Preferences } = require('./core/preferences.cjs');
const { Designs } = require('./core/designs.cjs');
const projectFiles = require('./core/project-files.cjs');
const previewEdit = require('./core/preview-edit.cjs');
const { History, PreviewImages, kindOf } = require('./core/history.cjs');
const { fileDetail } = require('./core/change-review.cjs');
const { OwnTools } = require('./core/own-tools.cjs');

// Appen hedder Aura. Datamappen og navnet i nøgleringen bevares fra før navneskiftet; se core/app-identity.cjs.
const { appIdentity, rememberKeychain, projectParent, DISPLAY_NAME } = require('./core/app-identity.cjs');
const identity = appIdentity({ appData: app.getPath('appData'), packaged: app.isPackaged, customUserData: app.commandLine.hasSwitch('user-data-dir'), userData: app.getPath('userData'), sessionData: app.getPath('sessionData') });
const appIcon = path.join(__dirname, 'ui/aura-icon.png');
rememberKeychain(identity);
app.setName(identity.keychainName);
app.setPath('userData', identity.userData);
app.setPath('sessionData', identity.sessionData);

protocol.registerSchemesAsPrivileged([{ scheme: 'harness', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, preview, project, busy = false, chosenParent = null;
let assets = [];
let github, publishing, deployments, deploymentSetup, restoration;
let workbench, externalPreview = null, history, images;
let ownTools, updates, updating = false;
let devServer, detectedRuntime, forceStatic = false;
const spaces = new Map(); let selectedRoot = null;
function workspaceRoot() { return workbench?.chat?.root || project?.root; }
function saveSpace() {
  const ctx = spaces.get(selectedRoot);
  if (ctx) Object.assign(ctx, { preview, externalPreview, detectedRuntime, forceStatic, devServer });
}
function spaceFor(root = selectedRoot) { saveSpace(); return spaces.get(root); }
function makeServer(ctx) {
  return new DevServer({ runner: app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked/core/dev-server-runner.cjs') : undefined,
    emit: state => {
      if (state.state === 'error') recordFailure('forhaandsvisning', 'server');
      if (state.state === 'running') { const old = ctx.preview; ctx.preview = null; void old?.close(); ctx.externalPreview = state.url; }
      else if (['starting', 'stopping', 'stopped', 'error'].includes(state.state)) ctx.externalPreview = null;
      if (selectedRoot === ctx.root) { preview = ctx.preview; externalPreview = ctx.externalPreview; }
      const chat = workbench?.claims.get(ctx.root) || (workbench?.chat?.root === ctx.root ? workbench.chat : [...(workbench?.chats.values() || [])].find(c => c.root === ctx.root));
      const titles = { installing: 'Forhåndsvisning: installerer pakker', installed: 'Forhåndsvisning: pakkerne er installeret', starting: 'Forhåndsvisning: starter serveren', running: 'Forhåndsvisning: serveren kører', stopped: 'Forhåndsvisning: stoppet', error: 'Forhåndsvisning: fejl' };
      if (titles[state.state] && ctx.logged !== state.state && (state.state !== 'stopped' || ctx.logged)) { ctx.logged = state.state; chat?.log({ kind: 'preview', title: titles[state.state], detail: state.message || '', status: state.state === 'error' ? 'error' : ['installing','starting'].includes(state.state) ? 'running' : 'completed' }); }
      sendEvent({ type: 'preview.runtime', ...state, workspaceRoot: ctx.root, root: project?.root, project: ctx.detectedRuntime, chat: chat?.id });
    }
  });
}
async function selectSpace(root) {
  saveSpace();
  if (selectedRoot !== root) await stopPicking('chat');
  let ctx = spaces.get(root);
  if (!ctx) {
    ctx = { root, preview: null, externalPreview: null, forceStatic: false };
    ctx.detectedRuntime = await inspectRuntime(root).catch(error => ({ kind: 'unknown', supported: false, reason: error.message }));
    ctx.devServer = makeServer(ctx); spaces.set(root, ctx); await ctx.devServer.activate(root);
    if (!['vite','astro'].includes(ctx.detectedRuntime.kind) && (await openProject(root)).staticPreview) ctx.preview = await startPreview(root);
  }
  // En kopis opstart kan stadig være i gang, når brugeren allerede har valgt en anden samtale.
  if (workspaceRoot() === root) { selectedRoot = root; ({ preview, externalPreview, forceStatic, detectedRuntime, devServer } = ctx); }
  return { workspaceRoot: root, isolated: root !== project?.root, copy: workbench.chat?.root === root && workbench.chat.copy ? { id: workbench.chat.copy.id, omissions: workbench.chat.copy.omissions } : null, previewURL: ctx.preview?.url || ctx.externalPreview || null, previewExternal: Boolean(ctx.externalPreview), runtime: { ...ctx.devServer.snapshot(), root: project?.root, workspaceRoot: root, project: ctx.detectedRuntime } };
}
async function chatState(state) { return { ...state, preview: await selectSpace(state.workspaceRoot) }; }
async function closeSpaces() { saveSpace(); await Promise.all([...spaces.values()].map(async ctx => { await ctx.devServer.stop(); await ctx.preview?.close(); })); spaces.clear(); selectedRoot = null; preview = null; externalPreview = null; }
let quitReady = false, shuttingDown = null;
const failures = [];
function recordFailure(area, type) { failures.push({ area, type, at: new Date().toISOString() }); if (failures.length > 10) failures.shift(); }
function supportReport() {
  // Hjælp må ikke kontakte nøgleringen. Kontrollen sker først ved brug af en nøgle.
  return require('./core/diagnostics.cjs').diagnostics({ version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, versions: require('./core/runtime.cjs').get()?.versions, project: Boolean(project), running: workbench?.running, preview: devServer?.state, failures });
}
function shutdown() {
  if (!shuttingDown) shuttingDown = (async () => { github?.cancel(); await workbench?.close(); await closeSpaces(); })().finally(() => { shuttingDown = null; });
  return shuttingDown;
}
const uiURL = 'harness://app/index.html';
const profileRoot = app.isPackaged ? path.join(process.resourcesPath, 'profiles') : path.join(__dirname, '..', 'profiles');
if (app.isPackaged) require('./core/runtime.cjs').configure(process.resourcesPath);

async function activate(next) {
  if (workbench.running) throw new Error('Stop den aktive opgave, før du skifter projekt.');
  await stopPicking('project');
  await workbench.activate(next);
  try { const restored = await restoration.previous(next.root); if (restored) await workbench.invalidatePlan(restored.id); }
  catch { await workbench.invalidatePlan(crypto.randomUUID()); workbench.historyWarning = 'Gendannelseskopien kan ikke læses. Projektfilerne er åbne, men den gamle plan er nulstillet. Kopien er bevaret i appens lokale data.'; }
  await closeSpaces();
  project = next; assets = [];
  const context = await selectSpace(workbench.chat?.root || next.root);
  return { ...project, ...context, workbench: { ...await workbench.state(), preview: context } };
}

function handle(channel, action) {
  ipcMain.handle(channel, async (event, value) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== uiURL) throw new Error('Adgang afvist.');
    try {
      if (updating && !channel.startsWith('updates:')) throw new Error('Aura gør klar til genstart.');
      return { ok: true, value: await action(value) };
    }
    catch (error) {
      recordFailure(channel.startsWith('git:') ? 'git' : channel.startsWith('connections:') ? 'forbindelse' : 'app', ['EACCES','EPERM'].includes(error.code) ? 'adgang' : error.code === 'ENOENT' ? 'mangler-fil' : 'handling');
      const messages = { EEXIST: 'Der findes allerede en mappe med det projektnavn. Vælg et andet navn eller en anden placering.', ENOENT: 'En nødvendig fil eller mappe findes ikke. Kontrollér projektmappen.', EACCES: 'Aura har ikke adgang til mappen. Tillad mappeadgang i computerens indstillinger, og prøv igen, eller vælg en anden mappe.', EPERM: 'Computeren blokerer adgang til mappen. Tillad mappeadgang i indstillingerne, og prøv igen, eller vælg en anden mappe.' };
      return { ok: false, error: messages[error.code] || error.message };
    }
  });
}
handle('updates:state', () => updates.snapshot());
handle('updates:check', () => updates.check());
handle('updates:download', () => updates.download());
handle('updates:automatic', value => updates.automatic(value));
handle('updates:restart', () => updates.restart());
handle('updates:website', () => shell.openExternal('https://ai-alliancen-org.github.io/ai-harness/desktop.html'));
handle('updates:notes', () => {
  const version = updates.snapshot().available?.version;
  if (!version || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(version)) throw new Error('Vælg en tilgængelig udgivelse.');
  return shell.openExternal(`https://github.com/ai-alliancen-org/ai-harness/releases/tag/v${version}`);
});
async function exclusive(action) {
  if (busy) throw new Error('Vent på den igangværende handling.');
  busy = true;
  try { return await action(); } finally { busy = false; }
}
// Nye projekter lægges i Dokumenter/Aura, medmindre brugeren selv har valgt en anden placering.
const defaultProjectParent = () => projectParent(app.getPath('documents'));
function projectLocation() {
  const parent = chosenParent || defaultProjectParent();
  return { chosen: Boolean(chosenParent), label: chosenParent ? parent : `Dokumenter › ${path.basename(parent)}`, path: parent };
}
handle('project:location', () => projectLocation());
handle('project:choose-location', () => exclusive(async () => {
  const selection = await dialog.showOpenDialog(window, { title: 'Vælg, hvor dine projekter skal ligge', defaultPath: chosenParent || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
  if (!selection.canceled) chosenParent = await require('./core/projects.cjs').checkProjectAccess(selection.filePaths[0]);
  return projectLocation();
}));
handle('project:create', input => exclusive(async () => {
  if (workbench.running) throw new Error('Stop den aktive opgave først.');
  const startup = await new Preferences(workbench.store).available({ ...input.startup, tests: input.tests });
  const parent = chosenParent || defaultProjectParent();
  if (!chosenParent) await fs.mkdir(parent, { recursive: true });
  // Uden funktionen Design og tilgængelighed bruges hverken designpakke, logo eller inspiration fra startsiden.
  const features = (await workbench.features.get()).effective;
  const created = await createProject(parent, features.design ? input : { ...input, color: null, links: [] }, features.design ? assets : [], profileRoot);
  // Med Versioner og fortryd får nye projekter Git fra start og en version efter hver AI-opgave, så de altid kan fortrydes.
  // Et hostingønske eller en designpakke under en slået fra funktion følger ikke med projektet. Brugerens gemte standarder bevares.
  const projectStartup = { ...startup.values, ...(features.deling ? {} : { hosting: '' }), ...(features.design ? {} : { designID: '' }) };
  await workbench.store.saveProject(created.root, { startup: projectStartup, ...(features.versioner ? { autoCheckpoint: true } : {}) });
  let versionWarning = '';
  if (features.versioner) {
    try { await workbench.git.startProject(created.root); }
    catch (error) { versionWarning = `Versioner kunne ikke slås til: ${error.message} Projektet er oprettet, og du kan gemme versioner senere.`; }
  }
  // De seneste valg er udgangspunktet for næste projekt. Brugeren kan glemme dem under Flere valg.
  await new Preferences(workbench.store).save(startup.values);
  const opened = await openProject(created.root);
  if (versionWarning) opened.warnings.push(versionWarning);
  return activate(opened);
}));
handle('project:open', () => exclusive(async () => {
  const selection = await dialog.showOpenDialog(window, { title: 'Åbn en mappe som arbejdsområde', properties: ['openDirectory'] });
  if (selection.canceled) return null;
  return activate(await openProject(selection.filePaths[0]));
}));
// Seneste projekter med deres samtaler til sidepanelet. Det åbne projekts samtaler har deres status lige nu.
handle('project:recent', async () => Promise.all((await workbench.history.recent()).map(async item => ({ ...item, chats: await workbench.chatList(item.root).catch(() => []) }))));
handle('project:reopen', id => exclusive(async () => {
  const item = (await workbench.history.recent()).find(p => p.id === id);
  if (!item) throw new Error('Projektet findes ikke på listen. Brug Åbn projekt for at vælge mappen.');
  return activate(await openProject(item.root));
}));
// Samtaler i projektet. En ny samtale starter tom; de tidligere står i sidepanelet og kan åbnes igen.
handle('workspace:new-conversation', () => exclusive(async () => { if (!project) throw new Error('Åbn et projekt først.'); return chatState(await workbench.newChat()); }));
handle('chat:open', id => exclusive(async () => { if (!project) throw new Error('Åbn et projekt først.'); return chatState(await workbench.openChat(id)); }));
handle('chat:rename', value => exclusive(() => workbench.renameChat(value)));
// Sletning flytter samtalens fil til papirkurven, så den kan hentes igen uden for Aura.
handle('chat:delete', value => exclusive(async () => {
  if (!project) throw new Error('Åbn et projekt først.');
  const title = (await workbench.chatList()).find(item => item.id === value?.id)?.title || 'Ny samtale';
  const choice = await dialog.showMessageBox(window, { type: 'question', title: 'Slet samtale', message: `Slet samtalen »${title}«?`, detail: (await workbench.history.readChat(project.root, value.id)).copy ? 'Samtalen flyttes til papirkurven. Dens kopi og uflettede ændringer slettes. Projektfilerne og versionerne bevares.' : 'Samtalen flyttes til papirkurven. Projektfilerne og versionerne bevares.', buttons: ['Annuller', 'Slet samtalen'], defaultId: 0, cancelId: 0 });
  if (choice.response !== 1) return null;
  return chatState(await workbench.deleteChat(value, file => shell.trashItem(file)));
}));
let pendingMergeView = null;
handle('chat:merge-review', value => exclusive(async () => {
  pendingMergeView = null;
  const review = await workbench.mergeReview(value), chat = workbench.chatFor(value?.chat);
  const view = { ...(value?.view || { width: 1280, height: 800 }), page: currentPage() };
  review.images = { now: imageURL(await captureView(view, project.root)), target: imageURL(await captureView(view, chat.root)), targetLabel: 'Samtalens kopi' };
  pendingMergeView = { token: review.token, root: project.root, view };
  return review;
}));
handle('chat:merge', value => exclusive(async () => {
  const pending = pendingMergeView?.token === value?.token && pendingMergeView.root === project?.root ? pendingMergeView : null;
  pendingMergeView = null;
  // Tag før-billedet igen umiddelbart før indfletningen. Efter-billedet skal vise det faktisk flettede projekt,
  // også når brugeren valgte projektets linjer ved konflikt, og bindes til en eventuel gemt version.
  const before = pending ? await captureView(pending.view, pending.root) : null;
  const result = await workbench.mergeApply(value);
  const task = workbench.findTask(result.task), chat = workbench.chatFor(value?.chat);
  if (task && pending) {
    task.images = { pair: crypto.randomUUID(), view: pending.view };
    if (result.saved?.head) task.checkpoint = { status: 'saved', head: result.saved.head };
    await images.add(pending.root, before, { role: 'before', pair: task.images.pair, view: pending.view, task: task.id }).catch(() => null);
    if (result.savedFirst?.head) await images.add(pending.root, before, { role: 'after', view: pending.view, commit: result.savedFirst.head }).catch(() => null);
    chat.afterImage(task);
  }
  return { ...result, state: await chatState(result.state) };
}));
handle('workspace:draft', input => {
  if (!project || input.root !== project.root) throw new Error('Projektet er skiftet. Kladden blev ikke gemt i en anden mappe.');
  return workbench.saveDraft({ chat: input.chat, text: input.text, mode: input.mode, dismissPlanOffer: input.dismissPlanOffer === true });
});
handle('project:new', () => exclusive(async () => {
  if (workbench.running) throw new Error('Stop den aktive opgave, før du skifter projekt.');
  await stopPicking('project');
  await closeSpaces();
  await workbench.close(); workbench.project = null; externalPreview = null;
  if (preview) await preview.close();
  preview = null; project = null; assets = [];
  return true;
}));
handle('assets:choose', kind => exclusive(async () => {
  if (!['logo', 'reference'].includes(kind)) throw new Error('Ukendt materialetype.');
  const selection = await dialog.showOpenDialog(window, { title: kind === 'logo' ? 'Vælg et logo' : 'Vælg inspirationsmateriale', properties: ['openFile', ...(kind === 'reference' ? ['multiSelections'] : [])], ...(kind === 'logo' ? { filters: [{ name: 'Billeder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] } : {}) });
  if (!selection.canceled) {
    const next = kind === 'logo' ? assets.filter(item => item.kind !== 'logo') : [...assets];
    if (next.length + selection.filePaths.length > 20) throw new Error('Vælg højst 20 filer.');
    for (const file of selection.filePaths) {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('Vælg almindelige filer på højst 10 MB.');
      next.push({ id: crypto.randomUUID(), kind, path: file });
    }
    assets = next;
  }
  return assets.map(({ id, kind, path: file }) => ({ id, kind, name: assets.find(a => a.id === id)?.name || path.basename(file) }));
}));
handle('assets:remove', id => {
  if (busy) throw new Error('Vent på den igangværende handling.');
  assets = assets.filter(item => item.id !== id);
  return assets.map(({ id, kind, path: file }) => ({ id, kind, name: assets.find(a => a.id === id)?.name || path.basename(file) }));
});
// Den statiske forhåndsvisning starter, når projektet har sin første version. Kun én start ad gangen.
async function startStatic(root) {
  const ctx = spaceFor(root); if (!ctx) return false;
  if (ctx.preview) return true;
  if (!ctx.staticStart) ctx.staticStart = (async () => {
    const updated = await openProject(root);
    if (!spaces.has(root) || !updated.staticPreview || ctx.externalPreview) return false;
    ctx.preview = await startPreview(root);
    if (selectedRoot === root) { preview = ctx.preview; sendEvent({ type: 'preview.ready', root: project?.root, workspaceRoot: root, url: preview.url }); }
    return true;
  })().finally(() => { ctx.staticStart = null; });
  return ctx.staticStart;
}
handle('preview:revision', async () => {
  const rootNow = workspaceRoot(), ctx = spaceFor(rootNow);
  if (!project || !ctx || ctx.externalPreview) return null;
  const nextRuntime = await inspectRuntime(rootNow).catch(error => ({ kind: 'unknown', supported: false, reason: error.message }));
  if (workspaceRoot() !== rootNow) return null;
  if (JSON.stringify(nextRuntime) !== JSON.stringify(ctx.detectedRuntime)) {
    ctx.detectedRuntime = nextRuntime; if (selectedRoot === rootNow) detectedRuntime = nextRuntime;
    sendEvent({ type: 'preview.runtime', ...ctx.devServer.snapshot(), root: project?.root, workspaceRoot: rootNow, project: nextRuntime });
  }
  if (!ctx.forceStatic && ['vite', 'astro'].includes(nextRuntime.kind)) {
    if (ctx.preview) { const old = ctx.preview; ctx.preview = null; if (selectedRoot === rootNow) preview = null; await old.close(); sendEvent({ type: 'preview.ready', workspaceRoot: rootNow, url: null }); }
    return null;
  }
  if (!ctx.preview && !await startStatic(rootNow)) return null;
  if (workspaceRoot() !== rootNow) return null;
  const root = path.join(rootNow, 'public');
  if (!(await fs.lstat(root)).isDirectory()) throw new Error('Den offentlige mappe mangler.');
  const entries = [];
  async function scan(dir, depth = 0) {
    if (depth > 12 || entries.length > 2000) throw new Error('Projektet overstiger forhåndsvisningens grænse.');
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(file, depth + 1);
      else if (entry.isFile()) { const stat = await fs.stat(file); entries.push(`${file}:${stat.mtimeMs}:${stat.size}`); }
    }
  }
  await scan(root);
  await fs.access(path.join(root, 'index.html'));
  return crypto.createHash('sha256').update(entries.sort().join('\n')).digest('hex');
});

handle('preferences:get', () => new Preferences(workbench.store).get());
handle('preferences:save', input => exclusive(() => new Preferences(workbench.store).save(input)));
handle('designs:clear', () => exclusive(() => { assets = []; return []; }));
handle('designs:list', () => new Designs(workbench.store).list());
handle('designs:save', input => exclusive(() => new Designs(workbench.store).save(input, assets)));
handle('designs:apply', id => exclusive(async () => { const design = await new Designs(workbench.store).get(id); assets = design.assets; return { color: design.color, links: design.links, assets: assets.map(({ id, kind, name }) => ({ id, kind, name })) }; }));
// Aura Harness i brugerens eget kodeværktøj. Mappen vælges her i hovedprocessen; brugerfladen sender ingen stier.
const tools = () => ownTools ??= new OwnTools({ profiles: profileRoot, git: workbench.git });
handle('tools:catalog', () => tools().catalog());
handle('tools:folder', () => exclusive(async () => {
  const result = await dialog.showOpenDialog(window, { title: 'Vælg projektmappen', buttonLabel: 'Vælg mappe', properties: ['openDirectory', 'createDirectory'] });
  return result.canceled || !result.filePaths[0] ? null : tools().choose(result.filePaths[0]);
}));
handle('tools:review', input => exclusive(() => {
  if (!Array.isArray(input?.tools) || input.tools.length > 40 || input.tools.some(id => typeof id !== 'string')) throw new Error('Vælg gyldige værktøjer.');
  if (input.skills !== undefined && (!Array.isArray(input.skills) || input.skills.length > 60 || input.skills.some(name => typeof name !== 'string'))) throw new Error('Vælg gyldige skills.');
  return tools().plan(input.tools, input.skills);
}));
handle('tools:install', input => exclusive(() => tools().install({ skipConflicts: input?.skipConflicts === true })));
handle('tools:removal', () => exclusive(() => tools().planRemoval()));
handle('tools:remove', () => exclusive(() => tools().remove()));
handle('tools:reveal', async () => { const error = await shell.openPath(tools().requireTarget()); if (error) throw new Error('Mappen kunne ikke åbnes.'); });

function requireIdleProject() {
  if (!project) throw new Error('Åbn et projekt først.');
  if (workbench.running || workbench.finishing) throw new Error('Vent på agenten og en eventuel versionsgemning.');
  if (['installing', 'starting', 'stopping'].includes(devServer.state)) throw new Error('Vent på opstarten af forhåndsvisningen, eller stop den først.');
  return project.root;
}
handle('support:report', () => supportReport());
handle('support:save', async () => {
  const report = supportReport();
  const chosen = await dialog.showSaveDialog(window, { title: 'Gem fejlrapport', defaultPath: 'Aura-fejlrapport.json', filters: [{ name: 'Fejlrapport', extensions: ['json'] }] });
  if (chosen.canceled || !chosen.filePath) return false;
  await fs.writeFile(chosen.filePath, JSON.stringify(report, null, 2), { mode: 0o600 }); return true;
});
// Feedback går på e-mail til kontakten i package.json. Uden kontakt viser appen kun teksten om at skrive til den, der inviterede.
handle('support:contact', () => require('./core/feedback.cjs').contact());
handle('support:feedback', async () => {
  const feedback = require('./core/feedback.cjs'), person = feedback.contact();
  if (!person) return false;
  await shell.openExternal(feedback.mail(person, { version: app.getVersion(), system: `${{ darwin: 'macOS', win32: 'Windows' }[process.platform] || process.platform} ${process.arch}` }));
  return true;
});
handle('git:status', async () => {
  if (!project) throw new Error('Åbn et projekt først.');
  const root = project.root, status = await workbench.git.status(root);
  status.busy = Boolean(workbench.running || workbench.finishing);
  status.history = await history.describe(root, status.history);
  const { images: all } = await images.index(root);
  for (const item of status.history) item.image = [...all].reverse().find(entry => entry.commit === item.commit && entry.role === 'after')?.id || null;
  return { ...status, restoration: await restoration.status(root), autoCheckpoint: (await workbench.store.project(root)).autoCheckpoint === true };
});
// Visuel historik: én version med filer og billeder, navne og billederne selv.
handle('history:version', async commit => {
  if (!project) throw new Error('Åbn et projekt først.');
  const root = project.root, version = await history.version(root, commit);
  return { ...version, images: await images.pairFor(root, { commit }) };
});
handle('history:rename', value => exclusive(async () => ({ name: await history.rename(requireIdleProject(), value?.commit, value?.name) })));
handle('history:image', async id => {
  if (!project) throw new Error('Åbn et projekt først.');
  for (const root of new Set([workspaceRoot(), project.root, ...(workbench.chat?.changes.tasks.map(task => task.root) || [])])) {
    try { return await images.read(root, id); } catch { /* Billedet kan høre til en tidligere kopi i samtalen. */ }
  }
  throw new Error('Billedet findes ikke længere.');
});
// Gennemgang før en gendannelse eller fortrydelse: filerne, hvad der sker med dem, dine ugemte ændringer og et billede
// af forhåndsvisningen nu og af det, den går tilbage til. Billedet "nu" gemmes som før-billede, når handlingen udføres.
let pendingRestore = null;
const imageURL = data => data ? `data:image/jpeg;base64,${data.toString('base64')}` : null;
handle('git:restore-review', input => exclusive(async () => {
  const taskRoot = input?.task ? workbench.findTask(input.task)?.root : null;
  const root = taskRoot && taskRoot !== project?.root ? taskRoot : requireIdleProject();
  if (root !== workspaceRoot() || workbench.busyRoot(root)) throw new Error('Åbn den ledige samtale, hvis filer skal fortrydes.');
  if (input?.undo && input.expected && (await restoration.previous(root))?.id !== input.expected) throw new Error('En senere gendannelse har afløst indfletningen. Brug Versioner til at gennemgå den seneste handling.');
  let request = { ...(input?.commit ? { commit: input.commit } : {}), ...(input?.undo ? { undo: true } : {}), ...(input?.revert ? { revert: input.revert } : {}) };
  if (input?.task) {
    const task = workbench.findTask(input.task);
    if (!task || !task.files.length) throw new Error('Opgaven findes ikke længere i denne samtale. Brug Versioner for at gå længere tilbage.');
    request = { task: { files: task.files } };
  }
  const review = await restoration.review(root, request);
  const auto = (await workbench.store.project(root)).autoCheckpoint === true;
  let unsaved = [];
  if (review.git) { const repo = await workbench.git.repository(root); const changed = new Set(repo.files.map(file => file.file)); unsaved = review.files.map(file => file.file).filter(file => changed.has(file)); }
  Object.assign(review, { unsaved, saveFirst: auto && review.git && unsaved.length > 0, saveAfter: auto && review.git, framework: Boolean(externalPreview) });
  const view = input?.view && Number.isFinite(input.view.width) ? { page: currentPage(), width: input.view.width, height: input.view.height } : null;
  const now = view ? await captureView(view) : null;
  let target = null;
  if (request.commit) target = (await images.pairFor(root, { commit: request.commit }))?.after;
  else if (request.revert) target = (await images.pairFor(root, { commit: request.revert }))?.before;
  else if (input?.task) target = (await images.pairFor(root, { task: input.task }))?.before;
  review.images = { now: imageURL(now), target: target ? await images.read(root, target.id).catch(() => null) : null, targetLabel: request.commit ? 'Versionen' : 'Før opgaven' };
  pendingRestore = { token: review.token, root, view, now, request, kind: review.kind, task: input?.task || null, files: review.files.map(file => file.file), unsaved, signature: JSON.stringify(review.files) };
  return review;
}));
handle('git:restore', input => exclusive(async () => {
  const root = pendingRestore?.root || requireIdleProject();
  if (root !== workspaceRoot() || workbench.busyRoot(root)) throw new Error('Åbn den ledige samtale, hvis filer skal fortrydes.');
  const inCopy = root !== project.root;
  const { token, label = '', choices = {} } = typeof input === 'string' ? { token: input } : input || {};
  if (typeof label !== 'string' || label.length > 300 || /[\r\n\0]/.test(label)) throw new Error('Ugyldig beskrivelse af gendannelsen.');
  if (!choices || typeof choices !== 'object' || Object.keys(choices).length > 200 || Object.values(choices).some(value => !['ours', 'theirs'].includes(value))) throw new Error('Ugyldigt valg i gendannelsen.');
  const pending = pendingRestore?.token === token && pendingRestore.root === root ? pendingRestore : null; pendingRestore = null;
  const auto = (await workbench.store.project(root)).autoCheckpoint === true;
  let applyToken = token, savedFirst = null;
  // Dine ugemte ændringer i de filer, der sættes tilbage, gemmes først som en version, så de kan hentes igen.
  if (auto && pending?.unsaved.length) {
    const review = await workbench.git.review(root);
    const files = review.files.filter(file => !file.blocked && pending.unsaved.includes(file.file)).map(file => file.file);
    if (files.length) savedFirst = await workbench.git.commit(root, { token: review.token, files, message: pending.kind === 'restore' ? 'Dine ændringer før gendannelsen' : 'Dine ændringer før fortrydelsen' });
    const again = await restoration.review(root, pending.request);
    if (JSON.stringify(again.files) !== pending.signature) throw new Error('Filerne har ændret sig. Gennemgå gendannelsen igen.');
    applyToken = again.token;
  }
  await workbench.ensureBaseline().catch(() => {});
  await devServer.stop(); if (inCopy) await workbench.chat.close(false); else await workbench.close();
  let restored, error, saved = null;
  try { restored = await restoration.apply(root, applyToken, choices); } catch (failure) { error = failure.message; }
  // Med automatiske versioner gemmes gendannelsen som en ny version. Historikken bevares, og næste opgave kan gemmes for sig.
  if (restored && (await workbench.store.project(root)).autoCheckpoint === true) {
    try {
      const review = await workbench.git.review(root);
      const files = review.files.filter(f => !f.blocked && restored.paths.includes(f.file)).map(f => f.file);
      if (files.length) saved = await workbench.git.commit(root, { token: review.token, files, message: label.trim() || 'Gendannet version' });
    } catch (failure) { error = `Filerne er gendannet, men den nye version blev ikke gemt: ${failure.message}`; }
  }
  if (restored) workbench.log({ kind: 'restore', title: 'Filerne er sat tilbage', detail: `${label.trim() || 'Gendannet version'} · ${restored.paths.length === 1 ? '1 fil' : `${restored.paths.length} filer`}${saved ? ' · gemt som ny version' : ''}`, status: 'completed' }, root);
  if (error) workbench.log({ kind: 'error', title: 'Gendannelsen gik ikke helt igennem', detail: error, status: 'error' }, root);
  // activate kontrollerer journalen, også efter genstart eller en delvis gendannelse.
  const reopened = inCopy ? null : await activate(await openProject(root));
  // Ændringen står under Ændringer som din. Billedet efter tages i baggrunden af samme side i samme størrelse.
  // En opgave i denne samtale, der er fortrudt, kan ikke fortrydes igen fra kortet.
  if (restored?.files && pending?.task) { const done = workbench.findTask(pending.task); if (done) done.undone = true; }
  if (restored?.files) {
    const files = restored.changes.filter(change => change.binary || (change.before !== undefined && change.after !== undefined)).map(change => ({ ...change }));
    const task = workbench.recordEdit({ kind: 'undo', label: label.trim() || (pending?.kind === 'undo' ? 'Fortrudt gendannelse' : 'Gendannet version'), files, title: '', log: false });
    if (pending?.view) void (async () => {
      const pair = crypto.randomUUID();
      if (pending.now) await images.add(root, pending.now, { role: 'before', pair, view: pending.view, task: task.id });
      if (!externalPreview) await startStatic(root).catch(() => {});
      const after = await captureView(pending.view);
      if (after && project?.root === root) await images.add(root, after, { role: 'after', pair, view: pending.view, task: task.id, commit: saved?.head || null });
      if (saved?.head) await images.bind(root, pair, saved.head);
      sendEvent({ type: 'history.images', root, task: task.id, commit: saved?.head || null });
    })().catch(() => {});
  }
  return { restored, error, saved, savedFirst, project: reopened, state: inCopy ? await chatState(await workbench.state()) : null };
}));
handle('git:save', value => exclusive(async () => {
  const { note = '', view } = typeof value === 'string' || value === undefined ? { note: value || '' } : value;
  const root = requireIdleProject(), result = await workbench.git.saveAll(root, note || '');
  if (result.saved) workbench.log({ kind: 'checkpoint', title: 'Du gemte en version', detail: note || 'Uden beskrivelse', status: 'completed' }, root);
  // Et billede af forhåndsvisningen hører til den nye version. Før-billedet er det seneste af samme side og størrelse.
  if (result.head && view && Number.isFinite(view.width)) void (async () => {
    const shot = { page: currentPage(), width: view.width, height: view.height }, data = await captureView(shot);
    if (data && spaces.has(root)) await images.add(root, data, { role: 'after', view: shot, commit: result.head });
    sendEvent({ type: 'history.images', root, commit: result.head });
  })().catch(() => {});
  return result;
}));
handle('git:identity', value => exclusive(() => workbench.git.setIdentity(requireIdleProject(), value)));
handle('git:init', () => exclusive(() => workbench.git.initialize(requireIdleProject())));
handle('git:review', () => exclusive(() => workbench.git.review(requireIdleProject())));
handle('git:commit', input => exclusive(async () => {
  const root = requireIdleProject(), result = await workbench.git.commit(root, input);
  workbench.log({ kind: 'checkpoint', title: 'Du gemte en version med valgte filer', detail: String(input?.message || ''), status: 'completed' }, root);
  return result;
}));
handle('git:automatic', value => exclusive(async () => {
  const root = requireIdleProject();
  if (typeof value !== 'boolean') throw new Error('Ugyldigt valg af automatisk checkpoint.');
  if (value) {
    const repo = await workbench.git.repository(root);
    const block = await require('./core/checkpoints.cjs').automaticBlock(repo);
    if (block) throw new Error(block);
  }
  await workbench.store.saveProject(root, { autoCheckpoint: value });
  return value;
}));

function hostingIdle() { if (workbench.running || workbench.finishing) throw new Error('Vent på den igangværende AI-opgave.'); }
async function sharingContext() { return { projectName: project?.name || '', viewingCopy: Boolean(workbench.chat?.copy), copyCount: project ? (await workbench.chatList()).filter(chat => chat.isolated).length : 0 }; }
handle('hosting:state', async () => ({ context: await sharingContext(), ...await github.state(), project: Boolean(project), publication: project ? await publishing.status(project.root).catch(error => ({ message: error.message, selected: null })) : null }));
handle('hosting:token', token => exclusive(async () => { hostingIdle(); publishing.reviews.clear(); return github.connectToken(token); }));
handle('hosting:login', () => exclusive(async () => { hostingIdle(); return github.startLogin(); }));
handle('hosting:poll', id => exclusive(async () => { hostingIdle(); publishing.reviews.clear(); return github.poll(id); }));
handle('hosting:cancel', () => { github.cancel(); return true; });
handle('hosting:browser', () => { if (!github.pending) throw new Error('Start login først.'); return shell.openExternal('https://github.com/login/device'); });
handle('hosting:disconnect', () => exclusive(async () => { hostingIdle(); publishing.reviews.clear(); return github.disconnect(); }));
handle('hosting:catalog', () => exclusive(async () => { hostingIdle(); return { owners: await github.owners(), repositories: await github.repositories() }; }));
handle('hosting:create', input => exclusive(async () => { hostingIdle(); return github.create(input); }));
handle('hosting:attach', fullName => exclusive(() => publishing.attach(requireIdleProject(), fullName)));
handle('hosting:review', () => exclusive(async () => ({ ...await publishing.review(requireIdleProject()), context: await sharingContext() })));
handle('hosting:push', token => exclusive(() => publishing.push(requireIdleProject(), token)));
handle('hosting:open', async () => { const root = requireIdleProject(); const selected = (await workbench.store.project(root)).publication; if (!selected) throw new Error('Vælg repository først.'); return shell.openExternal('https://github.com/' + require('./core/github.cjs').repository(selected.fullName)); });

handle('deployment:guides', () => require('./core/hosting-guidance.cjs').catalog());
handle('deployment:guide-open', input => shell.openExternal(require('./core/hosting-guidance.cjs').link(input?.id, input?.kind)));
handle('deployment:state', async () => ({ ...await deployments.state(requireIdleProject()), context: await sharingContext() }));
handle('deployment:setup', input => exclusive(() => deploymentSetup.act(requireIdleProject(), input)));
handle('deployment:setup-open', async input => shell.openExternal(await deploymentSetup.open(requireIdleProject(), input)));
handle('deployment:tracking', async input => {
  if (!project) return null;
  const root = project.root;
  return { root, ...await deploymentSetup.tracking(root, input?.refresh === true) };
});
handle('deployment:review', input => exclusive(async () => ({ ...await deployments.review(requireIdleProject(), input), context: await sharingContext() })));
handle('deployment:send', token => exclusive(() => deployments.deploy(requireIdleProject(), token)));
handle('deployment:check', () => exclusive(() => deployments.check(requireIdleProject())));
handle('deployment:open', async kind => {
  if (kind?.komplaiApp) {
    const app = (await deployments.providers.komplai.overview()).apps.find(app => app.id === kind.komplaiApp);
    if (!app) throw new Error('Vælg en af dine apps hos komplai.');
    return shell.openExternal(`${require('./core/komplai-publish.cjs').HUB}/publish?app=${encodeURIComponent(app.id)}`);
  }
  const state = await deployments.state(requireIdleProject());
  if(kind==='settings') return shell.openExternal(await deployments.settings(requireIdleProject()));
  if (!state.last) throw new Error('Ingen udgivelse registreret.');
  const url = kind === 'portal' ? state.last.target.portal : state.last.url;
  if (!url || !/^https:\/\//.test(url)) throw new Error('Intet link tilgængeligt.');
  return shell.openExternal(url);
});

// Faste sider hos udbyderne til nøglevejledningen. Kontrolleret 29. september 2026. Andre adresser åbnes aldrig herfra.
const accountPages = {
  openai: { start: 'https://platform.openai.com/', keys: 'https://platform.openai.com/api-keys' },
  azure: { start: 'https://ai.azure.com/' },
  anthropic: { start: 'https://platform.claude.com/', billing: 'https://platform.claude.com/settings/billing', keys: 'https://platform.claude.com/settings/keys' },
  mistral: { start: 'https://console.mistral.ai/', billing: 'https://admin.mistral.ai/organization/billing', privacy: 'https://admin.mistral.ai/plateforme/privacy', keys: 'https://console.mistral.ai/api-keys' },
  corti: { start: 'https://console.corti.app/signup', console: 'https://console.corti.app/', keys: 'https://console.corti.app/corti-models' },
  alexandra: { start: 'https://platform.alexandra.dk/platform-ui/', console: 'https://platform.alexandra.dk/platform-ui/', keys: 'https://platform.alexandra.dk/platform-ui/' },
  openrouter: { start: 'https://openrouter.ai/settings/keys' }, zen: { start: 'https://opencode.ai/auth' }
};
handle('connections:account', value => {
  const kind = typeof value === 'string' ? value : value?.kind, page = typeof value === 'string' ? 'start' : value?.page || 'start';
  if (!Object.hasOwn(accountPages, kind) || !Object.hasOwn(accountPages[kind], page)) throw new Error('Denne forbindelse opsættes hos din organisation eller på din egen server.');
  return shell.openExternal(accountPages[kind][page]);
});

handle('setup:status', async () => {
  try {
    if (project) { const status = await workbench.git.status(project.root); return { git: status.block || `Git er klar · branch ${status.branch}`, project: true }; }
    const version = (await require('./core/git.cjs').run(app.getPath('userData'), ['--version'])).toString().trim();
    return { git: `${version} · projektets historik og identitet kontrolleres, når du åbner et projekt.`, project: false };
  } catch (error) { return { git: error.message, project: Boolean(project) }; }
});
handle('connections:discover', () => require('./core/local-discovery.cjs').discoverLocalModels());
const komplaiLogin = new (require('./core/komplai.cjs').KomplaiLogin)();
handle('komplai:login', () => komplaiLogin.start(url => shell.openExternal(url)));
handle('komplai:cancel', () => komplaiLogin.cancel());
// Login giver kun en særskilt udgivelsesadgang. Tidligere AI-handlinger accepteres ikke.
handle('komplai:connect', value => exclusive(async () => {
  if (workbench.running) throw new Error('Stop opgaverne først.');
  if (!value || typeof value.organisationId !== 'string' || value.publishing !== true || value.coding) throw new Error('Vælg komplai Run til udgivelse.');
  await komplaiLogin.connectPublishing(value.organisationId, workbench.store);
  komplaiLogin.cancel();
  return workbench.state();
}));
handle('komplai:publish-state', () => require('./core/komplai.cjs').publishingState(workbench.store));
handle('komplai:publish-overview', () => deployments.providers.komplai.overview());
handle('komplai:publish-address', value => deployments.providers.komplai.address(value?.slug, value?.appId));
handle('komplai:publish-disconnect', () => exclusive(() => require('./core/komplai.cjs').disconnectPublishing(workbench.store)));
handle('connections:state', () => workbench.state());
handle('connections:save', value => exclusive(() => workbench.saveConnection(value)));
handle('connections:remove', value => exclusive(() => workbench.removeConnection(value)));
handle('connections:models', value => workbench.models(value));
handle('connections:routes', value => workbench.routes(value.connectionID, value.modelID));
handle('agent:prepare', value => exclusive(() => workbench.prepare(value)));
handle('agent:send', value => {
  if (busy) throw new Error('Vent på den igangværende handling.');
  if (!project) throw new Error('Åbn et projekt først.');
  const server = spaceFor(workbench.chatFor(value?.chat).root)?.devServer;
  if (server && ['installing', 'starting', 'stopping'].includes(server.state)) throw new Error('Vent på opstarten af forhåndsvisningen, eller stop den først.');
  return workbench.send(value);
});
handle('agent:stop', value => workbench.stop(value));
handle('agent:reply', value => workbench.reply(value));
handle('agent:question', value => workbench.question(value));
// Afklaring og plan: briefen er brugerens egne ord, og planen kan rettes af brugeren. Intet sendes, før næste besked.
handle('plan:brief', value => exclusive(() => workbench.saveBrief(value)));
handle('plan:wishes', value => exclusive(() => workbench.addWishes(value)));
handle('plan:edit', value => exclusive(() => workbench.editPlan(value)));
handle('plan:restore', value => exclusive(() => workbench.restorePlan(value)));
// Arbejdsfladens faner: Ændringer, Kode og Aktivitet. Alt er skrivebeskyttet; stier valideres her i hovedprocessen.
// Ændringer: opgaverne i denne samtale med deres før/efter-billeder, når Aura har taget dem.
handle('changes:overview', async value => {
  if (!project) return { running: false, tasks: [], session: null };
  const root = workbench.chatFor(value?.chat).root, overview = await workbench.changeOverview(value);
  for (const task of overview.tasks) task.images = await images.pairFor(workbench.findTask(task.id)?.root || root, { task: task.id }).catch(() => null);
  return overview;
});
handle('changes:file', async value => {
  if (!project) throw new Error('Åbn et projekt først.');
  // En fil i en gemt version: før og efter læses fra Git. Ellers fra Auras øjebliksbilleder i denne samtale.
  if (typeof value?.source === 'string' && value.source.startsWith('version:')) {
    const root = project.root, commit = value.source.slice(8), file = await history.file(root, commit, value.file);
    const kind = kindOf((await require('./core/git.cjs').run(root, ['log', '-1', '--format=%s', commit])).toString().trim());
    return file.hidden ? { file: value.file, change: 'ændret', by: ['ai', 'stopped'].includes(kind) ? 'ai' : 'dig', secret: true, added: 0, removed: 0, hunks: [] } : fileDetail(value.file, file.before, file.after, ['ai', 'stopped'].includes(kind) ? 'ai' : 'dig');
  }
  return workbench.changeFile(value);
});
handle('code:list', async value => {
  if (!project) throw new Error('Åbn et projekt først.');
  const root = workbench.chatFor(value?.chat).root, result = await projectFiles.listFiles(root), changed = workbench.changedFiles(value);
  return { root, truncated: result.truncated, files: result.files.map(file => ({ ...file, changed: changed.get(file.path) || null })), deleted: [...changed].filter(([, kind]) => kind === 'slettet').map(([file]) => file) };
});
handle('code:read', file => { if (!project) throw new Error('Åbn et projekt først.'); return projectFiles.readFile(workspaceRoot(), file); });
handle('activity:list', value => project ? workbench.activityList(value?.chat) : []);
handle('skills:list', () => { if (!project) throw new Error('Åbn et projekt først.'); return workbench.skills.list(project.root); });
handle('skills:save', value => exclusive(async () => {
  if (!project || workbench.running) throw new Error('Åbn et projekt, og stop en eventuel opgave før skill-ændringer.');
  await workbench.close(); return workbench.skills.save(project.root, value);
}));
// Funktioner: standarden for alle projekter og undtagelser for det åbne projekt. Ændringer gælder fra næste opgave.
handle('features:get', () => workbench.features.get(project?.root));
handle('features:save', value => exclusive(async () => {
  if (workbench.running || workbench.finishing) throw new Error('Stop opgaven, før du ændrer funktioner.');
  const result = await workbench.features.save(project?.root, value);
  for (const chat of workbench.chats.values()) chat.prepared = null;
  return result;
}));
handle('preview:attach', value => exclusive(async () => {
  if (!project) throw new Error('Åbn et projekt først.');
  if (!value) { await devServer.stop(); forceStatic = true; externalPreview = null; if (preview) await preview.close(); const next = await openProject(workspaceRoot()); preview = next.staticPreview ? await startPreview(workspaceRoot()) : null; return preview?.url || null; }
  let url; try { url = new URL(value); } catch { throw new Error('Angiv en lokal serveradresse.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Brug en lokal http- eller https-adresse uden login eller parametre.');
  if (workbench.servers().some(server => server === url.origin || server.startsWith(url.origin + '/'))) throw new Error('Agentens interne server kan ikke bruges som forhåndsvisning.');
  if ([...spaces.values()].some(ctx => ctx.root !== selectedRoot && (ctx.preview?.url?.startsWith(url.origin + '/') || ctx.externalPreview?.startsWith(url.origin + '/')))) throw new Error('Vælg samtalen i sidepanelet for at se dens forhåndsvisning.');
  try { const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) }); await response.body?.cancel(); if (!response.ok) throw new Error(); }
  catch { throw new Error('Den lokale udviklingsserver svarer ikke. Start den separat; appen kører ingen kommando automatisk.'); }
  await devServer.stop();
  if (preview) await preview.close(); preview = null; externalPreview = url.href;
  return externalPreview;
}));
handle('preview:runtime', async () => ({ ...await devServer.status(), root: project?.root, workspaceRoot: selectedRoot }));
// Kontrol af forhåndsvisningen efter en opgave: blev siden vist, og skrev den fejl i konsollen? Aura klikker ikke i siden.
const previewLog = { documents: [], errors: [] };
const previewOrigin = () => preview?.url || (externalPreview ? new URL(externalPreview).origin + '/' : null);
function fromPreview(url) { const origin = previewOrigin(); return Boolean(origin && typeof url === 'string' && url.startsWith(origin)); }
function remember(list, entry) { list.push(entry); while (list.length > 50) list.shift(); }
handle('preview:check', input => {
  if (!project) throw new Error('Åbn et projekt først.');
  const since = Number(input?.since) || 0, origin = previewOrigin();
  if (!origin) return { preview: false };
  const documents = previewLog.documents.filter(item => item.at >= since && item.url?.startsWith(origin)), errors = previewLog.errors.filter(item => item.at >= since && item.url?.startsWith(origin));
  const last = documents.at(-1) || null;
  const result = { preview: true, loaded: Boolean(last), status: last?.status || null, errors: errors.slice(0, 5).map(({ message, source, line }) => ({ message, source, line })), errorCount: errors.length };
  const shown = !last ? 'siden svarede ikke' : last.status >= 400 ? `siden svarede med fejl ${last.status}` : 'siden blev vist';
  workbench.log({ kind: 'check', title: 'Kontrol af forhåndsvisningen', detail: `${shown[0].toUpperCase()}${shown.slice(1)} · ${errors.length ? `${errors.length} ${errors.length === 1 ? 'fejl' : 'fejl'} i siden: ${errors[0].message}` : 'ingen fejl i konsollen'}. Aura har ikke klikket eller afprøvet funktioner.`, status: !last || last.status >= 400 || errors.length ? 'error' : 'completed' });
  return result;
});
// Billeder af forhåndsvisningen til historikken. De tages i et skjult vindue med sin egen session uden lagring. Det
// må kun hente fra forhåndsvisningens egen adresse og får hverken preload, Node, tilladelser eller downloads.
let imageSessionReady = null, captureQueue = Promise.resolve();
function previewAllowed(url) {
  saveSpace();
  return [...spaces.values()].some(ctx => {
    if (ctx.preview && url.startsWith(ctx.preview.url)) return true;
    if (!ctx.externalPreview) return false;
    try { const requested = new URL(url), target = new URL(ctx.externalPreview); return requested.host === target.host && [target.protocol, target.protocol === 'https:' ? 'wss:' : 'ws:'].includes(requested.protocol); } catch { return false; }
  });
}
function previewHeaders(details) {
  const headers = { ...details.responseHeaders };
  if ([...spaces.values()].some(ctx => ctx.externalPreview && details.url.startsWith(new URL(ctx.externalPreview).origin + '/'))) {
    const origin = new URL(details.url), socket = `${origin.protocol === 'https:' ? 'wss:' : 'ws:'}//${origin.host}`;
    const existing = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-security-policy');
    if (existing) delete headers[existing[0]];
    headers['Content-Security-Policy'] = [...(existing?.[1] || []), `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${socket}; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'`];
  }
  return headers;
}
function imageSession() {
  if (imageSessionReady) return;
  const ses = session.fromPartition('aura-billeder');
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !previewAllowed(details.url) }));
  ses.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: previewHeaders(details) }));
  imageSessionReady = true;
}
// Siden, brugeren ser i forhåndsvisningen, i forhold til dens egen adresse. Den statiske servers nøgle er ikke med.
function currentPage() {
  const base = preview?.url || externalPreview, frame = previewFrame();
  if (!base || !frame) return '';
  return frame.url.startsWith(base) ? frame.url.slice(base.length).split('#')[0].slice(0, 300) : '';
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function captureView(view, root = selectedRoot) {
  const ctx = spaceFor(root), base = ctx?.preview?.url || ctx?.externalPreview;
  if (!base || !view || !Number.isFinite(view.width) || !Number.isFinite(view.height)) return Promise.resolve(null);
  const width = Math.round(Math.min(1920, Math.max(320, view.width))), height = Math.round(Math.min(1600, Math.max(320, view.height)));
  const page = typeof view.page === 'string' && !/^[a-z][a-z0-9+.-]*:|^\/\/|\.\./i.test(view.page) ? view.page.replace(/^\/+/, '') : '';
  const shoot = async () => {
    imageSession();
    const shot = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { partition: 'aura-billeder', offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, devTools: false, backgroundThrottling: false, spellcheck: false } });
    shot.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    shot.webContents.on('will-navigate', event => event.preventDefault());
    try {
      await Promise.race([shot.loadURL(base + page), wait(10000).then(() => { throw new Error('Siden svarede ikke.'); })]);
      await wait(700);
      const image = await shot.webContents.capturePage();
      if (image.isEmpty()) return null;
      return (image.getSize().width > 1200 ? image.resize({ width: 1200, quality: 'good' }) : image).toJPEG(78);
    } catch { return null; }
    finally { if (!shot.isDestroyed()) shot.destroy(); }
  };
  const result = captureQueue.then(shoot, shoot); captureQueue = result.catch(() => {});
  return result;
}
// Ændringstilstand i forhåndsvisningen. Brugeren slår den selv til; først da indsættes valgscriptet i previewets
// ramme. Sandbox, indholdspolitik og netværksregler er de samme, og siden kan ikke kalde Aura. Hvert valg hentes som
// data og renses her, før det vises eller bruges.
const picking = { active: false, key: '', generation: 0, selected: '' };
const sendEvent = event => { if (window && !window.isDestroyed()) window.webContents.send('harness:event', event); };
function previewFrame() {
  const main = window?.webContents.mainFrame;
  if (!main || !previewOrigin()) return null;
  return main.frames.find(frame => { try { return !frame.detached && fromPreview(frame.url); } catch { return false; } }) || null;
}
async function injectPicker() {
  const frame = previewFrame();
  if (!frame) throw new Error('Forhåndsvisningen er ikke klar. Vent, til siden er vist, og prøv igen.');
  const generation = ++picking.generation;
  await frame.executeJavaScript(previewEdit.pickerSource({ key: picking.key, selected: picking.selected }));
  void pickLoop(frame, generation);
}
async function pickLoop(frame, generation) {
  const key = JSON.stringify(picking.key);
  while (picking.active && generation === picking.generation) {
    let value;
    try { value = await frame.executeJavaScript(`window[${key}] ? window[${key}].next() : null`); } catch { return; }
    if (!picking.active || generation !== picking.generation || !value || typeof value !== 'object') return;
    if (value.type === 'exit') { await stopPicking('esc'); return; }
    if (value.type === 'pick') await pickedElement(value.element, frame.url).catch(error => sendEvent({ type: 'preview.pick', state: 'error', message: error.message }));
  }
}
async function stopPicking(reason) {
  if (!picking.active) return;
  picking.active = false; picking.generation++;
  const frame = previewFrame(), key = JSON.stringify(picking.key);
  try { await frame?.executeJavaScript(`window[${key}] && window[${key}].stop()`); } catch { /* Rammen er måske allerede væk. */ }
  sendEvent({ type: 'preview.pick', state: 'off', reason });
}
// Et valgt element: hvor teksten står i koden, og om Aura kan rette den direkte.
async function pickedElement(raw, frameURL) {
  const root = workspaceRoot(), origin = previewOrigin();
  if (!root || !origin) return;
  const selection = previewEdit.sanitizeSelection(raw);
  // Siden i forhold til forhåndsvisningens egen adresse, fx med Astros base-sti. Den statiske servers nøgle i stien sendes aldrig videre.
  const base = preview?.url || externalPreview || origin, url = String(frameURL || '');
  const relative = url.startsWith(base) ? url.slice(base.length) : url.startsWith(origin) ? url.slice(origin.length) : '';
  selection.page = '/' + relative.split(/[?#]/)[0];
  selection.pageFile = previewEdit.pageFileFor(relative, preview ? 'static' : detectedRuntime?.kind);
  const found = selection.leaf && selection.raw && !selection.secret ? await previewEdit.findText(root, selection.raw, { tag: selection.tag, pageFile: selection.pageFile }) : { matches: [] };
  if (workspaceRoot() !== root || !picking.active) return;
  const choice = previewEdit.chooseSource(found.matches, { pageFile: selection.pageFile });
  selection.source = choice.match ? { file: choice.match.file, line: choice.match.line } : null;
  selection.places = choice.match ? [] : found.matches.slice(0, 5).map(match => `${match.file}:${match.line}`);
  selection.sourceNote = choice.reason === 'many' ? `teksten står flere steder: ${selection.places.join(', ')}` : '';
  selection.edit = previewEdit.editability(selection, choice);
  selection.id = crypto.randomUUID();
  picking.selected = selection.selector;
  workbench.rememberSelection(selection);
  sendEvent({ type: 'preview.selected', root: project.root, workspaceRoot: root, selection: { id: selection.id, name: selection.name, tag: selection.tag, text: selection.text, raw: selection.edit.possible ? selection.raw : '', label: selection.label, page: selection.page, source: selection.source, places: selection.places, edit: selection.edit, secret: selection.secret } });
}
handle('preview:pick', async value => {
  if (!value?.on) { await stopPicking('user'); return { active: false }; }
  if (!project) throw new Error('Åbn et projekt først.');
  if (workbench.busyRoot(workspaceRoot())) throw new Error('Vent, til AI’en er færdig i denne mappe, før du retter i siden.');
  if (!previewOrigin()) throw new Error('Forhåndsvisningen kører ikke. Start den først.');
  if (picking.active) await stopPicking('restart');
  Object.assign(picking, { active: true, key: previewEdit.newKey(), selected: '' });
  try { await injectPicker(); } catch (error) { picking.active = false; picking.generation++; throw error; }
  return { active: true };
});
handle('preview:edit-text', value => { if (!project) throw new Error('Åbn et projekt først.'); return workbench.textEdit(value); });
handle('changes:undo', value => exclusive(() => { if (!project) throw new Error('Åbn et projekt først.'); return workbench.undoTask(value); }));
// Viser forhåndsvisningen teksten nu? Bruges efter en rettelse; svaret kommer fra siden og er kun en kontrol.
handle('preview:contains', async value => {
  const text = String(value?.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000), frame = previewFrame();
  if (!text || !frame) return false;
  try { return (await frame.executeJavaScript(`String(document.body ? document.body.textContent : '').replace(/\\s+/g, ' ').includes(${JSON.stringify(text)})`)) === true; } catch { return false; }
});
handle('preview:prepare', value => exclusive(async () => {
  if (workbench.busyRoot(workspaceRoot())) throw new Error('Vent på opgaven i denne samtale.');
  return devServer.prepare(value?.action, value?.scripts === true);
}));
handle('preview:execute', token => exclusive(async () => {
  if (workbench.busyRoot(workspaceRoot())) throw new Error('Vent på opgaven i denne samtale.');
  forceStatic = false;
  return devServer.execute(token);
}));
handle('preview:stop', () => devServer.stop().then(() => devServer.snapshot()));

app.whenReady().then(async () => {
  app.setAboutPanelOptions({ applicationName: DISPLAY_NAME, applicationVersion: app.getVersion() });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: DISPLAY_NAME, submenu: [
      { label: `Om ${DISPLAY_NAME}`, role: 'about' },
      { label: 'Opdateringer …', click: () => sendEvent({ type: 'updates.open' }) },
      ...(process.platform === 'darwin' ? [
        { type: 'separator' }, { label: 'Tjenester', role: 'services' },
        { type: 'separator' }, { label: `Skjul ${DISPLAY_NAME}`, role: 'hide' },
        { label: 'Skjul andre', role: 'hideOthers' }, { label: 'Vis alle', role: 'unhide' }
      ] : []),
      { type: 'separator' }, { label: `Afslut ${DISPLAY_NAME}`, role: 'quit' }
    ] },
    { label: 'Rediger', submenu: [
      { label: 'Fortryd', role: 'undo' }, { label: 'Gentag', role: 'redo' },
      { type: 'separator' }, { label: 'Klip', role: 'cut' }, { label: 'Kopiér', role: 'copy' },
      { label: 'Sæt ind', role: 'paste' }, { label: 'Vælg alt', role: 'selectAll' }
    ] },
    { label: 'Vis', submenu: [
      { label: 'Faktisk størrelse', role: 'resetZoom' }, { label: 'Zoom ind', role: 'zoomIn' },
      { label: 'Zoom ud', role: 'zoomOut' }, { type: 'separator' }, { label: 'Fuld skærm', role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ type: 'separator' }, { label: 'Udviklerværktøjer', role: 'toggleDevTools' }] : [])
    ] },
    { label: 'Vindue', submenu: [
      { label: 'Minimér', role: 'minimize' }, { label: 'Zoom vindue', role: 'zoom' },
      { label: 'Luk vindue', role: 'close' },
      ...(process.platform === 'darwin' ? [{ type: 'separator' }, { label: 'Vis alle forrest', role: 'front' }] : [])
    ] }
  ]));
  workbench = new Workbench({ directory: path.join(app.getPath('userData'), 'harness'), safeStorage, profiles: profileRoot, emit: event => { if (['session.error','engine.error'].includes(event.type)) recordFailure('agent', 'model'); if (window && !window.isDestroyed()) window.webContents.send('harness:event', event); } });
  restoration = new (require('./core/restoration.cjs').Restoration)(workbench.git, workbench.store); workbench.restoration = restoration;
  history = new History(workbench.store); images = new PreviewImages(workbench.store);
  // Før- og efterbillede af en AI-opgave: samme side i samme størrelse. Efterbilledet bindes til versionen, når den gemmes.
  workbench.imageHook = async (role, task, extra = {}) => {
    const root = task.root;
    if (!task.images || !spaces.has(root)) return;
    if (role === 'before') task.images.view = { ...task.images.view, page: selectedRoot === root ? currentPage() : '' };
    else if (!spaceFor(root)?.externalPreview) await startStatic(root).catch(() => false);
    const data = await captureView(task.images.view, root);
    if (data && spaces.has(root)) await images.add(root, data, { role, pair: task.images.pair, view: task.images.view, task: task.id, commit: role === 'after' ? extra.commit || null : null });
    if (role === 'after') { if (extra.commit) await images.bind(root, task.images.pair, extra.commit); sendEvent({ type: 'history.images', root, task: task.id, commit: extra.commit || null }); }
  };
  // Serverne oprettes pr. arbejdsmappe, først når en samtale åbnes.
  workbench.workspaceHook = async chat => {
    if (chat.id === workbench.chatID) { const value = await selectSpace(chat.root); sendEvent({ type: 'chat.preview', chat: chat.id, ...value }); }
  };
  workbench.releaseWorkspace = async root => { const ctx = spaceFor(root); if (!ctx) return; await ctx.devServer.stop(); await ctx.preview?.close(); spaces.delete(root); sendEvent({ type: 'chat.copy-removed', workspaceRoot: root }); if (selectedRoot === root) selectedRoot = null; };
  await workbench.copies.cleanup();
  github = new GitHub(workbench.store); publishing = new Publishing({ store: workbench.store, git: workbench.git, provider: github });
  deployments = new Deployments(workbench.store, { github });
  deploymentSetup = new (require('./core/deployment-setup.cjs').DeploymentSetup)(workbench.store, github, deployments);
  updates = new (require('./core/updates.cjs').Updates)({
    updater: app.isPackaged && ['darwin', 'win32'].includes(process.platform) ? require('electron-updater').autoUpdater : null,
    store: workbench.store, version: app.getVersion(), enabled: app.isPackaged,
    emit: event => { if (['error', 'ready'].includes(event.value.phase) && updating) { updating = false; quitReady = false; } sendEvent(event); },
    busy: () => busy || updating || [...workbench.chats.values()].some(c => c.running || c.sending || c.starting || c.finishing)
      || [...spaces.values()].some(ctx => ['installing', 'starting', 'stopping'].includes(ctx.devServer.state)),
    prepare: async () => {
      updating = true;
      try { await workbench.store.queue; await workbench.history.queue; await shutdown(); quitReady = true; }
      catch (error) { updating = false; quitReady = false; throw error; }
    }
  });
  await updates.start();
  protocol.handle('harness', async request => {
    const url = new URL(request.url);
    const name = url.pathname.slice(1);
    const providerAsset = /^provider-(alexandra|anthropic|azure|compatible|corti|komplai|mistral|ollama|openai|openrouter|zen|promte|github-pages|cloudflare|vercel)\.svg$/.test(name);
    if (url.host !== 'app' || (!providerAsset && name !== 'provider-cloudflare.png' && !['index.html', 'aura-icon.png', 'app.js', 'updates.js', 'workspace.js', 'plan-view.js', 'planning.js', 'approval-view.js', 'approvals.js', 'preview-edit.js', 'history.js', 'chats.js', 'palette.js', 'model-advice.js', 'connection-overview.js', 'chat-display.js', 'conversation-mode.js', 'live-work.js', 'server.js', 'viewport.js', 'share-view.js', 'hosting.js', 'deployment-setup.js', 'deployment.js', 'styles.css', 'demo.css'].includes(name))) return new Response('Ikke fundet', { status: 404 });
    return new Response(await fs.readFile(path.join(__dirname, 'ui', name)), { headers: { 'Content-Type': name === 'aura-icon.png' ? 'image/png' : providerAsset ? 'image/svg+xml' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' } });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !(details.url.startsWith('harness://app/') || previewAllowed(details.url)) }));
  session.defaultSession.webRequest.onCompleted(details => {
    if (details.resourceType === 'subFrame' && previewAllowed(details.url)) remember(previewLog.documents, { at: Date.now(), status: details.statusCode, url: details.url });
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: previewHeaders(details) }));
  function createWindow() {
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 980, minHeight: 720, backgroundColor: '#F8FAFC', title: DISPLAY_NAME, icon: appIcon, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Fejl, som forhåndsvisningens side selv skriver i konsollen. Kun previewets ramme; appens egne meddelelser tælles ikke.
    window.webContents.on('console-message', event => {
      if (event.level !== 'error' || !previewAllowed(event.frame?.url || '')) return;
      const clean = require('./core/dev-server.cjs').cleanOutput;
      remember(previewLog.errors, { at: Date.now(), url: event.frame.url, message: clean(String(event.message || '')).slice(0, 300), source: String(event.sourceId || '').replace(previewOrigin() || '', ''), line: event.lineNumber || null });
    });
    // Genindlæses forhåndsvisningen i ændringstilstand, indsættes valgscriptet igen i den nye side.
    window.webContents.on('did-frame-finish-load', (_event, isMainFrame, processId, routingId) => {
      if (isMainFrame || !picking.active) return;
      let frame = null; try { frame = webFrameMain.fromId(processId, routingId); } catch { return; }
      if (frame && fromPreview(frame.url)) injectPicker().catch(() => {});
    });
    // ⌘K (Ctrl+K på Windows og Linux) åbner kommandopaletten, også når fokus står i forhåndsvisningen.
    window.webContents.on('before-input-event', (event, input) => {
      const modifier = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
      if (input.type !== 'keyDown' || input.isAutoRepeat || String(input.key).toLowerCase() !== 'k' || !modifier || input.alt || input.shift) return;
      event.preventDefault(); sendEvent({ type: 'palette.toggle' });
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    const created = window;
    created.on('close', event => { if (quitReady) return; event.preventDefault(); shutdown().finally(() => { if (!created.isDestroyed()) created.destroy(); }); });
    created.on('closed', () => { externalPreview = null; window = null; assets = []; project = null; });
    window.loadURL(uiURL);
  }
  if (process.platform === 'darwin') app.dock.setIcon(appIcon);
  createWindow();
  app.on('activate', () => { if (!window) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => { komplaiLogin.cancel(); if (quitReady) return; event.preventDefault(); shutdown().finally(() => { quitReady = true; app.quit(); }); });
