const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Et projekt har flere samtaler. Projektfilen har briefen og listen over samtaler; hver samtale har sin egen fil med
// beskeder, kladde, plan og forbrug. Samtalerne er lokale brugerdata, ikke projektfiler eller adgangstilladelser.
//
// workspaces/<projekt>.json            { version: 2, brief, chats: [oversigt], active, restorationID }
// workspaces/<projekt>-chats/<id>.json  { version: 1, id, title, draft, mode, messages, plan, … }
// Ældre projekter havde én samtale i projektfilen og arkiverede samtaler i <projekt>-archives. De flyttes til
// samtalefiler første gang projektet åbnes; arkivfilerne bevares uændret.
const now = () => new Date().toISOString();
const emptyChat = (id, title = '') => ({ version: 1, id, title, renamed: false, archived: false, draft: '', mode: 'chat', messages: [], plan: null, planConversation: [], lastPlan: null, status: 'idle', usage: null, createdAt: now(), updatedAt: now() });
const emptyProject = () => ({ version: 2, brief: null, chats: [], active: null, restorationID: null });
const idPattern = /^[0-9a-f-]{36}$/;
const damaged = 'Oversigten over projektets samtaler kan ikke læses. Projektfilerne er ikke berørt, og filen er bevaret. Start en ny samtale med + for at fortsætte.';
// En samtales navn: brugerens første besked, til første punktum og højst 60 tegn ved et ordskifte.
function titleFrom(messages) {
  const text = String(messages.find(m => m.role === 'user')?.text || '').split('\n\n')[0].replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentence = (text.match(/^.+?[.!?](?=\s|$)/) || [text])[0].replace(/[.!?]$/, '');
  return sentence.length <= 60 ? sentence : sentence.slice(0, 60).replace(/[\s,.;:]+\S*$/, '') + ' …';
}
// Oversigten i projektfilen, så sidepanelet kan vise samtalerne uden at læse dem alle.
// En samtale uden beskeder hedder det, brugeren er begyndt at skrive.
const summary = chat => ({ id: chat.id, title: chat.title || titleFrom(chat.messages) || titleFrom([{ role: 'user', text: chat.draft || '' }]), renamed: Boolean(chat.renamed), archived: Boolean(chat.archived), createdAt: chat.createdAt, updatedAt: chat.updatedAt, status: chat.status, count: chat.messages.length, draft: Boolean(chat.draft), copy: chat.copy || null });
function validChat(data) {
  return data && data.version === 1 && idPattern.test(data.id) && Array.isArray(data.messages) && Array.isArray(data.planConversation) && typeof data.draft === 'string';
}

class WorkspaceHistory {
  constructor(store) { this.store = store; this.queue = Promise.resolve(); }
  file(root) { return path.join(this.store.root, 'workspaces', this.store.projectKey(root) + '.json'); }
  folder(root) { return this.file(root).replace(/\.json$/, '') + '-chats'; }
  chatFile(root, id) { if (!idPattern.test(id || '')) throw new Error('Samtalen findes ikke.'); return path.join(this.folder(root), `${id}.json`); }
  // Alle skrivninger går gennem én kø og skrives atomisk, så projektfil og samtalefil aldrig skrives samtidig.
  serial(work) { const task = this.queue.then(work); this.queue = task.catch(() => {}); return task; }
  async write(target, data) {
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = target + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(temp, target);
  }
  async readJSON(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
  // Projektfilen. En ældre fil med én samtale flyttes til version 2 her, inden for køen.
  async project(root) {
    let data;
    try { data = await this.readJSON(this.file(root)); }
    catch (error) { if (error.code === 'ENOENT') return emptyProject(); throw new Error(damaged); }
    if (data.version === 2 && Array.isArray(data.chats)) return data;
    if (data.version !== 1 || !Array.isArray(data.messages) || !Array.isArray(data.planConversation) || typeof data.draft !== 'string') throw new Error(damaged);
    return this.migrate(root, data);
  }
  // En projektfil, der ikke kan læses, flyttes uændret til arkivet, og oversigten bygges igen ud fra samtalefilerne.
  // Briefen lå i den beskadigede fil og starter forfra; filen kan stadig findes i appens lokale data.
  async recover(root) {
    const file = this.file(root), archive = file.replace(/\.json$/, '') + '-archives';
    await fs.mkdir(archive, { recursive: true, mode: 0o700 });
    await fs.rename(file, path.join(archive, `beskadiget-${now().replace(/[:.]/g, '-')}.json`));
    const chats = [];
    let names = []; try { names = (await fs.readdir(this.folder(root))).filter(name => idPattern.test(name.replace(/\.json$/, ''))); } catch { /* Ingen samtalefiler. */ }
    for (const name of names) { try { const data = await this.readJSON(path.join(this.folder(root), name)); if (validChat(data)) chats.push(summary(data)); } catch { /* Springes over og bevares. */ } }
    const project = { ...emptyProject(), chats, recoveredAt: now() };
    await this.write(file, project);
    return project;
  }
  async migrate(root, old) {
    const chats = [];
    const archive = this.file(root).replace(/\.json$/, '') + '-archives';
    let names = []; try { names = (await fs.readdir(archive)).filter(name => name.endsWith('.json')); } catch { /* Ingen arkiverede samtaler. */ }
    for (const name of names) {
      try {
        const data = await this.readJSON(path.join(archive, name));
        if (data.version !== 1 || !Array.isArray(data.messages) || !data.messages.length) continue;
        chats.push({ ...emptyChat(randomUUID()), ...pick(data), createdAt: data.updatedAt || now(), updatedAt: data.updatedAt || now(), status: data.status === 'working' ? 'interrupted' : data.status || 'idle' });
      } catch { /* En arkivfil, der ikke kan læses, bevares og springes over. */ }
    }
    chats.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const current = { ...emptyChat(randomUUID()), ...pick(old), createdAt: old.updatedAt || now(), updatedAt: old.updatedAt || now() };
    chats.push(current);
    for (const chat of chats) { chat.title = titleFrom(chat.messages); await this.write(this.chatFile(root, chat.id), chat); }
    const project = { version: 2, brief: old.brief || null, chats: chats.map(summary), active: current.id, restorationID: old.restorationID || null, migratedAt: now() };
    await this.write(this.file(root), project);
    return project;
  }
  async readChat(root, id) {
    try { const data = await this.readJSON(this.chatFile(root, id)); if (!validChat(data)) throw new Error(); return data; }
    catch (error) { if (error.code === 'ENOENT') throw new Error('Samtalen findes ikke længere.'); throw new Error('Samtalen kan ikke læses. Filen er bevaret, og projektfilerne er ikke berørt. Start en ny samtale med + for at fortsætte.'); }
  }
  updateProject(root, change) {
    return this.serial(async () => { const data = await this.project(root); await change(data); data.updatedAt = now(); await this.write(this.file(root), data); return data; });
  }
  // Ændrer én samtale og dens linje i projektets oversigt.
  updateChat(root, id, change) {
    return this.serial(async () => {
      const project = await this.project(root), chat = await this.readChat(root, id);
      await change(chat);
      chat.updatedAt = now(); if (!chat.renamed) chat.title = titleFrom(chat.messages);
      await this.write(this.chatFile(root, id), chat);
      project.chats = [...project.chats.filter(item => item.id !== id), summary(chat)];
      project.updatedAt = chat.updatedAt; await this.write(this.file(root), project);
      return chat;
    });
  }
  // Åbner projektet: briefen, samtalerne og den aktive samtale. Findes ingen, oprettes en tom.
  async open(project) {
    const data = await this.serial(async () => {
      const value = await this.project(project.root);
      const visible = value.chats.filter(item => !item.archived);
      if (!visible.some(item => item.id === value.active)) {
        const chat = visible.length ? null : emptyChat(randomUUID());
        if (chat) { await this.write(this.chatFile(project.root, chat.id), chat); value.chats.push(summary(chat)); }
        value.active = chat?.id || visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].id;
        value.updatedAt = now(); await this.write(this.file(project.root), value);
      }
      return value;
    });
    await this.store.saveProject(project.root, { recent: { root: project.root, name: project.name, at: now() } });
    return data;
  }
  // Én samtale. En opgave, der var i gang, da appen lukkede, står som afbrudt, og dens plan kan kun læses.
  openChat(root, id) {
    return this.updateChat(root, id, data => {
      if (['working', 'interrupted'].includes(data.status)) {
        data.status = 'interrupted'; if (data.plan) data.lastPlan = { ...data.plan, reason: 'afbrudt', retiredAt: Date.now() }; data.plan = null;
        if (!data.draft) data.draft = [...data.messages].reverse().find(m => m.role === 'user')?.text || '';
      }
    }).then(async chat => { await this.updateProject(root, project => { project.active = id; }); return chat; });
  }
  // En ny samtale. En tom samtale genbruges, så der ikke opstår mange tomme samtaler. Kan projektfilen ikke læses,
  // er en ny samtale vejen videre: filen gemmes til side, og samtalerne findes igen.
  createChat(root) {
    return this.serial(async () => {
      let project;
      try { project = await this.project(root); } catch (error) { if (error.message !== damaged) throw error; project = await this.recover(root); }
      const empty = project.chats.find(item => !item.archived && !item.count && !item.draft);
      const chat = empty ? await this.readChat(root, empty.id) : emptyChat(randomUUID());
      if (!empty) await this.write(this.chatFile(root, chat.id), chat);
      project.chats = [...project.chats.filter(item => item.id !== chat.id), summary(chat)]; project.active = chat.id;
      project.updatedAt = now(); await this.write(this.file(root), project);
      return chat;
    });
  }
  renameChat(root, id, title) {
    if (typeof title !== 'string' || /[\r\n\0]/.test(title) || title.trim().length > 80) throw new Error('Skriv et navn på én linje og højst 80 tegn.');
    return this.updateChat(root, id, chat => { chat.title = title.trim(); chat.renamed = Boolean(title.trim()); });
  }
  archiveChat(root, id, archived = true) {
    return this.serial(async () => {
      const project = await this.project(root), chat = await this.readChat(root, id);
      if (chat.status === 'working') throw new Error('Vent, til opgaven er færdig, før du arkiverer samtalen.');
      chat.archived = archived; chat.updatedAt = now();
      await this.write(this.chatFile(root, id), chat);
      project.chats = [...project.chats.filter(item => item.id !== id), summary(chat)];
      if (archived && project.active === id) project.active = project.chats.filter(item => !item.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id || null;
      project.updatedAt = chat.updatedAt; await this.write(this.file(root), project); return chat;
    });
  }
  // Sletning flytter filen med remove, fx til papirkurven; samtalen fjernes fra projektets oversigt.
  removeChat(root, id, remove = file => fs.rm(file, { force: true })) {
    return this.serial(async () => {
      const project = await this.project(root);
      if (!project.chats.some(item => item.id === id)) throw new Error('Samtalen findes ikke længere.');
      await remove(this.chatFile(root, id));
      project.chats = project.chats.filter(item => item.id !== id);
      if (project.active === id) project.active = project.chats.filter(item => !item.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id || null;
      project.updatedAt = now(); await this.write(this.file(root), project);
      return project;
    });
  }
  // Samtalerne i et projekt, nyeste først. Tomme samtaler vises ikke, medmindre de er den aktive.
  async chats(root) {
    const project = await this.project(root);
    return [...project.chats].filter(item => item.archived || item.count || item.draft || item.id === project.active).map(item => ({ ...item, archived: Boolean(item.archived) })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  // Alle projekter, appen har åbnet, senest åbnet først. Sidepanelet viser de første og resten bag "Vis alle".
  async recent() {
    return Object.entries((await this.store.read()).projects).filter(([, p]) => p.recent).map(([id, p]) => ({ id, ...p.recent })).sort((a,b) => b.at.localeCompare(a.at));
  }
  draft(root, id, input) {
    if (typeof input.text !== 'string' || input.text.length > 30000 || !['chat','plan','build','free'].includes(input.mode)) throw new Error('Ugyldig kladde.');
    return this.updateChat(root, id, data => { data.draft = input.text; data.mode = input.mode; if (input.dismissPlanOffer === true) { data.planOffersDismissed = true; data.planOffer = false; } if (input.mode === 'plan') data.planOffer = false; });
  }
  saveBrief(root, brief) { return this.updateProject(root, data => { data.brief = brief; }); }
  savePlan(root, id, plan, planConversation, lastPlan) { return this.updateChat(root, id, data => { data.plan = plan; data.planConversation = planConversation; data.lastPlan = lastPlan || null; }); }
  saveRun(root, id, run) {
    return this.updateChat(root, id, data => {
      for (const message of run.messages) {
        if (!['user','assistant','system'].includes(message.role) || typeof message.text !== 'string') continue;
        const existing = data.messages.findIndex(m => m.id === message.id);
        if (message.text.length > 30000) data.trimmed = true;
        const safe = { id: message.id, role: message.role, text: message.text.slice(0, 30000) };
        if (existing < 0) data.messages.push(safe); else data.messages[existing] = safe;
      }
      let size = data.messages.reduce((n,m) => n + m.text.length, 0);
      while (data.messages.length > 200 || size > 200000) { size -= data.messages.shift().text.length; data.trimmed = true; }
      data.plan = run.plan; data.planConversation = run.planConversation;
      if (run.lastPlan !== undefined) data.lastPlan = run.lastPlan;
      data.status = run.status; data.mode = run.mode; data.lastRunMode = run.mode;
      if (run.usage && typeof run.usage === 'object') data.usage = run.usage;
      if (run.clearDraft) data.draft = '';
    });
  }
}
// Samtalens felter fra en ældre fil.
function pick(data) {
  const keys = ['draft', 'mode', 'messages', 'plan', 'planConversation', 'lastPlan', 'status', 'usage', 'trimmed', 'restorationID'];
  return Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
}
module.exports = { WorkspaceHistory, titleFrom };
